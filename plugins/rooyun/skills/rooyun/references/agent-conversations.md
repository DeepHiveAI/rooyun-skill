# 多轮 Agent 会话

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：要跟目录里的 Agent（萌宠文案、剧本医生…）开多轮会话时（纪律 13）

## 多轮 Agent 会话（萌宠文案为例）

上一章那五条分析端点是**无状态单轮**：发什么进去就出什么，服务端不记得你上次说过什么。
本章是另一件东西——**服务端持有历史的多轮会话**：你只拿着一个 `conversationId`，
每轮只发新的一句话，历史 / 系统提示词 / 窗口化 / 逐阶段计费全在服务端。
硬规则见**纪律 13**（会话 id 是状态、一个 Agent 一个会话、每轮先报价、跑不动不换 Agent）。

### 什么时候用会话，什么时候用单轮

| 场景 | 用哪个 |
|---|---|
| 剧本 → 角色/场景/道具、剧本 → 分镜、一次性改写/翻译/写词 | **单轮** `dj extract` / `storyboard` / `rewrite`——一问一答，没有「上一版」可言 |
| 要**基于上一版继续改**（「再活泼一点」「第二稿的开头留着，结尾换掉」） | **会话**：不带历史就等于每轮从零开始，模型看不到上一版 |
| 要用某个**目录里的 Agent**（萌宠文案 `agent.pet-rewrite`、剧本医生…） | **会话**：分析端点的 Agent 由服务端硬编，够不着目录里的其它 Agent |
| 要拿**A/B 双稿**再选一稿继续 | **会话**：一轮回两稿全文，下一轮用 `--ref <artifactId>` 指定「就用这稿」 |
| 只是想省钱 | 都不省。**会话每轮都扣钱**，且产物型一轮是多阶段（萌宠 = 分析 + A 稿 + B 稿 = 3 个计费阶段） |

### 最小可用例子（照抄）

```sh
dj() { node "$SKILL/scripts/dj.mjs" "$@"; }

# ① 挑 Agent：只有 conversational=true 的能开会话（目录不含单价，报价在 ② 的回执里）
dj agents --pretty
dj agents | jq -r '.data.agents[] | select(.conversational) | "\(.id)\t\(.billing.stagesPerTurn)"'

# ② 开一段会话（**不扣钱**）。Agent 建好就定死，中途不可换
CHAT=$(dj chat new --agent agent.pet-rewrite --title "橘猫日常 · 第一批" \
  | jq -r '.data.conversation.conversationId')
#   ↑ 把它存进你的「任务 → conversationId」表：它就是这段创作的全部状态
dj chat show "$CHAT" | jq -r '.meta.estimatedTurnCredits'   # 一轮预计多少积分 → 报给用户

# ③ 发一轮（**扣钱**：先报价、等用户点头，纪律 13 / 纪律 1 同则）
RID=$(dj uuid)                    # 幂等键，存下来；重试原样复用
dj chat send "$CHAT" --request-id "$RID" \
  "这条是我家橘猫抢镜头的视频，写两版短视频文案，别用感叹号堆情绪" \
  --attach-file ./原稿.txt --pretty

# ④ 指定「就用 A 稿」继续改：只给 artifactId，正文由服务端现取——别把稿子贴回来
RID2=$(dj uuid)
dj chat send "$CHAT" --request-id "$RID2" "按 A 稿的口吻，把结尾改成一句反问" \
  --ref art_a1b2c3 --pretty

# ⑤ 上下文丢了：捞回现场，**别新建会话重头说一遍**（那是重付每一轮的钱）
dj chats --agent agent.pet-rewrite --pretty
dj chat show "$CHAT" --pretty                  # 元信息 + 最近一轮全文
dj chat history "$CHAT" --after-seq 4 --pretty # 增量拉历史（游标取上次的 meta.lastSeq）

# ⑥ 这段创作彻底不要了才删：**硬删、连消息一起、不可撤销**，先跟用户确认
dj chat delete "$CHAT" --pretty
```

### 一轮的语义（这几条搞错就是重复扣费或丢稿）

- **`requestId` 必填、重试复用同一个键**（与纪律 4 同则）。同键重放返回**同一轮**的结果，
  回执 `meta.replayed: true` 且**不再扣费**；换个新 uuid 重发 = 又付一轮的钱。
  `dj.mjs` 在客户端就强制它，不会替你生成——生成并**存下来**是调用方的责任。
- **409 `conversation_busy` 是「这个会话正忙」，不是「这轮失败了」**：上一轮还没跑完，
  或用户正在网页端写同一段会话（`meta.lockedBy` = `api` / `web`）。
  按 `meta.retryAfterSeconds` 退避，然后**同一个 `conversationId` + 同一个 `requestId` 原样重发**。
- **两种 Agent，回执形状不同**：
  - **completion 型**（纯文本多轮）：正文在 `data.text`，`data.usage` 与 `data.credits` 有值；
  - **产物型**（`agent.pet-rewrite` 萌宠文案 / 分镜拆解）：`data.text` 只是一行摘要，
    **稿件在 `data.artifacts[]`**——逐稿带 `variantId`（A/B）、`artifactId` 与正文全文。
- **`data.credits` 为 `null` ≠ 免费**。产物型一轮是服务端多阶段编排，每阶段各自扣分记账，
  门面这一层拿不到聚合数字，所以如实回 `null` 而不是编一个 0。精确金额去 `dj ledger` 对账。
- **`--regenerate`** 重出末轮：置末条回答为作废、复用历史里的末条提问重跑。它**是新的一轮，照样扣钱**。
- **`--model` 换模型**：本轮生效，且会话往后沿用（与网页端「选了就记住」同口径）。
  换模型 = 换单价，**换完要重新报价**。
- **`--params-json` 说一次就够**：`chat new` 时传的会话级默认参数**会落库**，
  对之后每一轮都生效；`chat send` 时传的在它之上**逐键覆盖**（只覆盖你给的那几个键）。
  所以「时长 / 平台 / 口吻」这类整段不变的设定在开会话时说一次即可，别每轮重贴。

### 报价怎么算（服务端已经算好了，直接读）

> **报价 = `dj chat new` / `dj chat show` 回执 `meta` 里的 `estimatedTurnCredits`。**

那个数就是 `stagesPerTurn`（一轮几个计费阶段）× 这个会话 `modelId` 的单轮（`per_round`）单价，
**服务端乘好了给你**，两个因子也一并给出（`stagesPerTurn` / `perRoundCredits`），
不必自己乘、不必再拉一次 `dj agents`。`--pretty` 下就是「计费」那一行。

```sh
dj chat show "$CHAT" | jq '.meta'
# { "billingUnit":"per_round", "stagesPerTurn":3,
#   "perRoundCredits":0.1, "estimatedTurnCredits":0.3 }   ← 「这一轮预计 0.3 积分」
```

三条边界：

- **`null` ≠ 免费**：`perRoundCredits` / `estimatedTurnCredits` 为 `null` = 这个模型未配价，
  发轮会被 503 拒。如实说「该模型未配价、提交会被拒」，换模型或请管理员补配价格；
- **换 `modelId` 就是换单价**：`dj chat send --model` 之后会话记住新模型，
  重跑一次 `dj chat show` 拿新报价，**换完必须重新报价**；
- **报价是预计不是实扣**：产物型多阶段编排里若有条件触发的额外阶段，实扣可能略高；
  收尾用 `dj ledger` 逐笔对账。**不要凭印象编一个数字**，也不要因为算不出价就跳过确认
  （纪律 1 没有例外）。

### 附件与引用共用一份预算

| 上行 | 形态 | 上限 |
|---|---|---|
| `--attach-file a.txt,b.md` | 读本地**纯文本**成内联附件 `{name,text}` | 最多 3 个，单个 ≤32 000 字 |
| `--ref <artifactId>,…` | `@成果` 引用，**只给 id，正文服务端现取** | 一轮最多 5 个 |
| 两者合计 | 联合预算（服务端 `planReferenceBudget` 判定） | **≤5 条 / ≤96 000 字** |

超限是**整轮 400、不会替你截断**（`dj.mjs` 在客户端就拦下常见的两种超限，省一次白跑）。
媒体不走这里——会话域只吃文字，图片/视频/音频仍走生成域的 `assetId` 管线。

### 删除会话：硬删，先确认

`dj chat delete <conversationId>` 把这段会话与它的**全部消息**删掉。四条边界：

- **不可撤销、没有回收站**，删完用户在网页端对话工作台里也看不到了（两边同一份数据）。
  会话里的稿件是用户花钱买到的成果——**删之前必须跟用户确认**，别自作主张清场；
- **不退款、不动账本**：已花的钱记在 `dj ledger` 上，与会话行的生死无关。
  删会话省不下钱，只会把上下文丢掉；
- **正在写的会话删不掉**：撞 409 `conversation_busy` 说明上一轮还在跑、或用户正开着
  网页端同一段会话。退避后重发这次删除即可（删除没有幂等键，不涉及重复扣费）；
- **重复删除是 404 不是 200**。想表达「确保它没了」，把 404 与 200 一并当成功。

### 三件容易做错的事

1. **每轮把上一版稿子贴回去**。历史在服务端，贴回去 = 同一段文字在上下文里出现两遍，
   还要按 token 重付一次。要指定用哪一稿就 `--ref <artifactId>`。
2. **遇事新建会话**。撞 409、超时、报错——处置全是「同键重发」，不是重开一段。
   重开等于把上下文扔了：用户重付每一轮的钱，拿回来的稿子还换了个基准。
3. **`conversational: false` 的 Agent 拿去 `chat new`**。编排型 Agent（画布助手一类）
   要在画布里跑，开会话会被 400 `agent_not_conversational` 顶回来——先看目录再开。

---

