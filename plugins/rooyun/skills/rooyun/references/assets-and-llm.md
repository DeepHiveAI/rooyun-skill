# 素材上传 · 人工介入 · LLM 分析

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：要传本地文件、要请用户涂蒙版、要读剧本出结构或改文案时

## 上传本地素材

```sh
dj upload ./ref.png --pretty
# assetId 就是文件内容的 sha256，拿去当首帧 / 参考图 / 图生图源图
ASSET=$(dj upload ./ref.png | jq -r '.data.assetId')
```

需要 `assets:write` scope。`dj upload` 默认**直传**：文件直接进对象存储、不经 API 服务器，
已经传过的内容秒回（不传一个字节、不占上传额度）；直传不可用时自动回落普通上传，用法不变。
几条硬规矩：

- **幂等**：`assetId` = 内容 sha256，同一份字节传多少次都只有一个 id、只占一份存储。
  重传不是错误，会正常返回并把 `deduplicated` 标成 `true`。断点重试可以放心重传。
  反过来说，**改一个字节就是另一个资产**，没有「覆盖已有 assetId」这回事。
- 单文件 ≤ **50MB**（超了 413），每令牌每天 **1 GiB**（超了 429）。
  回执 `meta.uploadQuotaRemainingBytes` 给剩余额度。
- 类型**按文件魔数判定，不看扩展名也不看你声明的 Content-Type**：图片 png/jpeg/webp/gif，
  视频 mp4/webm/quicktime，音频 mpeg/wav/mp4/ogg。**SVG 一律不受理**。
- **服务端不保留你的文件名**，所以传完就把 `assetId` 记到卡片标题或你的任务清单里，
  否则回头分不清哪个 id 是哪张图。

## 人工介入编辑：让用户涂出重绘区域（`canvas:write`）

**有些事只有人能指。**「把她的头发改成卷发」——你说不清要重画画面的哪一块，
猜一个区域去生成是在赌用户的钱。签一条免登录链接让他自己涂（纪律 9）：

```sh
# ① 签发。nodeId 必须是一张**已经出过图**的图片卡：源图由服务端从卡上读，
#    你既不能也不需要指定（响应里的 sourceAssetId 就是它读出来的那张，用来复核）
SESSION=$(dj edit-session create "$CANVAS" "$NODE" --hint "把头发改成卷发")
SID=$(printf '%s' "$SESSION" | jq -r '.data.sessionId')
URL=$(printf '%s' "$SESSION" | jq -r '.data.url')
EXP=$(printf '%s' "$SESSION" | jq -r '.data.expiresAt')
SRC=$(printf '%s' "$SESSION" | jq -r '.data.sourceAssetId')
#   → 把 $URL 和 $EXP **一起**转述给用户，然后去做别的事

# ② 下一轮查状态（几十秒一次足够，别写阻塞循环）
STATUS=$(dj edit-session status "$SID")
printf '%s' "$STATUS" | jq -r '.data.status'      # pending / submitted / expired / revoked

# ③ submitted 之后取蒙版与用户写的要求
MASK=$(printf '%s' "$STATUS" | jq -r '.data.result.maskAssetId')
WANT=$(printf '%s' "$STATUS" | jq -r '.data.result.instruction')

# ④ 报价（新的花钱决策，纪律 1）→ ⑤ 发起局部重绘
dj precheck --model <图片模型id> --capability t2i --params size=2k --pretty
dj generate --request-id "$(dj uuid)" --model <图片模型id> --capability t2i \
  --reference "$SRC" \
  --params-json "{\"prompt\":\"$WANT\",\"mask\":\"$MASK\"}" \
  --canvas "$CANVAS" --node "$NODE" --pretty

# 用户改主意了 / 流程变了：收回还没被用的链接（幂等）
dj edit-session revoke "$SID"
```

几条硬规矩：

- **链接等同凭据**：免登录，谁拿到谁能编辑那张卡。明文只在签发响应的 `url` 里出现一次
  （查状态与撤销都不回显），**只转述给用户本人，不写进文件、日志与 commit**。
- **有效期 15 分钟，提交即焚**。`--ttl <分钟>` 只能把它**调短**（1–15），超上限返回 400
  而不是静默夹取。转述链接时必须一并说明有效期。
- **四态**：`pending` 还没交 · `submitted` 已交（`result` 就是你要的）·
  `expired` / `revoked` 这条废了（重签一条，并告诉用户上一条已失效）。
  已提交的会话**撤销不掉**（409 `session_consumed`）——撤销不能盖掉用户已交上来的成果；
  收到这个码就改为 `status` 取走 `result`。
- 没出过图的卡、文本/视频/音频卡签发一律 **400**（签了也只是让用户打开一块空白画板）。

**局部重绘的蒙版参数 `params.mask`**（不占能力词，就是 `t2i` + 源图 + 蒙版）三条硬约束：

1. **只有 `t2i` 消费它**。挂在 `i2i` 上会被静默丢弃（那条通道没有 mask 字段）＝
   付了局部重绘的钱、拿回一张与蒙版无关的新图，所以显式 400；
2. **必须与 `--reference`（`referenceAssetIds`）同时给出**，蒙版作用于**第一张**（＝源图）；
3. **必须是 PNG，透明像素 = 要重绘的区域**，其余像素锁定不变。

另有两条**服务端不校验、由你保证**的（校验要把两个对象的字节都拉下来，代价不值）：
蒙版与源图**尺寸一致**（用 `dj upload` 回执里的 `width`/`height` 核对；走编辑会话拿到的
蒙版天然同尺寸），以及蒙版**确实含透明像素**（全不透明＝什么都不重绘，照样扣钱）。

三个额外错误面：蒙版 assetId 不存在或不属于你 → `404 not_found`；
模型不吃蒙版 → `400 model_unsupported`（换一个支持局部重绘的图片模型）；
模型所在渠道承载不了蒙版 → **`422 mask_unsupported`**（`message` 会直说）。

⚠️ **能不能做局部重绘取决于渠道，不是模型名气**：只有 OpenAI 兼容渠道
（`images/edits` 那条通道）的协议里有蒙版字段；其余图片渠道都**没有**。选错会在**计费之前**被 `mask_unsupported` 挡下
（此前是静默丢掉蒙版按整图出——用户白涂一遍还照付钱）。
它与 `asset_unresolved` 分码是因为处置相反：**这一条换个图片模型就好**，
那一条是素材本身有问题，换模型没用。别按模型名猜，试一次最快。

## LLM 分析：读剧本、读素材、改文案（`llm` scope）

五条命令。**产物默认不落卡**——你要的是「拿到 → 判断 → 修改 → 再决定落不落」，
落卡是下一步的 ops（纪律 8）。

```sh
# 剧本 → 角色 / 场景 / 道具（一次一类）
dj extract characters --script ./ep1.txt --pretty
dj extract scenes     --script ./ep1.txt --pretty
# 画布上已经有的名字传进去，服务端会剔除，省一轮白跑
dj extract characters --script ./ep1.txt --existing "林小满,陈默" --pretty

# 剧本 → 分镜（整集一次拆完，别逐场反复重拆——每次都在付钱）
dj storyboard --script ./ep1.txt --pretty
dj storyboard --script ./ep1.txt --cast "林小满,陈默" --scenes "深夜便利店,老城区天台" \
  --bible ./bible.md --pretty

# 文案加工（edit 必须给 --instruction；translate 不接受 --instruction）
dj rewrite edit      --text "他走进店里。" --instruction "扩写成有画面感的一段，40 字以内" --pretty
dj rewrite optimize  --text "雨夜便利店，女主回头" --pretty
dj rewrite translate --text "雨夜便利店，霓虹反射在积水里" --pretty
dj rewrite lyrics    --script ./logline.txt --pretty

# 素材 → 提示词（素材一律先 upload 换 assetId；视频要你自己抽帧）
REF=$(dj upload ./ref.png | jq -r '.data.assetId')
dj caption image "$REF" --pretty
dj caption video --frames "$F1,$F2,$F3" --duration 6.3 --pretty

# 分镜图质检
dj inspect "$SHOT_ASSET" --prompt "雨夜便利店门口，霓虹反射在积水里" --pretty
```

#### 计费分叉（读 `meta.billingUnit`，别按命令猜）

`extract` / `storyboard` / `rewrite` 是 `per_round`——**扣积分**，一次调用算一轮，
与输出长度无关（拆分镜输出上万 token 也是一轮）。`caption` 也**扣积分**（与网页端同价）：
图片 `per_call` 0.1 积分/次，视频 `per_second` 0.1 积分/秒（按时长向上取整秒，上限 600 秒），
失败自动退款，余额 / 令牌限额不足回 402，未配价回 503。`inspect` 是 `free`——**不扣积分**，
但照样受 `llm` scope 与限流约束（`caption` / `inspect` 共用视觉桶，90 次/分/令牌）。

扣积分的几条都带 `meta.credits`（文本三条另有 `meta.usage`），收尾汇报时算进总账。

#### 三条专属错误码（都是 502）

| code | 退款 | 处置 |
|---|---|---|
| `llm_upstream_failed` | **已退款** | 上游挂了，可直接重试 |
| `llm_empty_output` | **已退款** | 上游没吐字，可直接重试 |
| `llm_unparsable_output` | **不退款** | 有输出但结构不对，token 真烧了。通常重试即可，但要知道这一次已经付过钱 |
| `llm_output_truncated` | **不退款** | 产物撞输出上限被截断。**别重试**——同样的输入必然截在同一处、再计一次费。把剧本按场次拆短分批，或换输出上限更高的模型 |

#### 完整工作流：从提取到回写（本域的核心价值，照着做）

```sh
dj() { node "$SKILL/scripts/dj.mjs" "$@"; }

# ① 建项目
CREATED=$(dj projects create "深夜便利店")
CANVAS=$(printf '%s' "$CREATED" | jq -r '.data.canvasId')

# ①b 剧本先落成文本卡（纪律 10 第一步）：它是后续一切的真相源，第 ⑥ 步的 scriptNodeId 也取它
SCRIPT_NODE=$(jq -n --rawfile s ./ep1.txt \
  '{ops:[{op:"createCard",params:{kind:"text",title:"《深夜便利店》第1集",content:$s}}]}' \
  | dj ops "$CANVAS" | jq -r '.data.results[0].nodeIds[0]')

# ② 从剧本提角色（只返数据，此刻画布上还什么都没有）
CHARS=$(dj extract characters --script ./ep1.txt)
printf '%s' "$CHARS" | jq -r '.data.characters[] | "\(.name)｜\(.identity)"'
#   ← 把这份清单给用户看，让他说「这个删掉」「那个年龄改一下」

# ③ 结构 → ops 批次（这一步是「改」：过滤、改名、补设定都在这里做）
printf '%s' "$CHARS" | jq '{ops: [.data.characters[]
  | select(.name != "路人甲")                      # 用户说不要的删掉
  | {op: "createCharacterBoard", params: {
      name: .name, description: .look,
      age: .age, identity: .identity, bio: .bio,
      props: .props, styleKeywords: .styleKeywords, expressions: .expressions
    }}]}' > /tmp/batch1.json
OPS=$(dj ops "$CANVAS" -f /tmp/batch1.json)

# ④ 设定板出图（第一次报价，纪律 1）：分镜视频引用的是设定板的**产物**，板没出图 = 参考为空。
#    先整批报价、把「合计 X 积分 / 余额 Y」给用户、等一个明确的「继续」，再逐板生成
N=$(printf '%s' "$OPS" | jq '.data.createdNodeIds | length')
jq -n --argjson n "$N" '{items: [range($n) | {model: "<图片模型id>", capability: "t2i", params: {size: "2k"}}]}' \
  | dj precheck -f - --pretty
#    提示词用卡上编译好的那份（纪律 11）：dj node 读回 → generate → --watch
for NODE in $(printf '%s' "$OPS" | jq -r '.data.createdNodeIds[]'); do
  PROMPT=$(dj node "$CANVAS" "$NODE" | jq -r '.data.body')
  RID=$(dj uuid)                                   # 存进你的任务表（纪律 4）
  TASK=$(dj generate --request-id "$RID" --model <图片模型id> --capability t2i \
    --params-json "$(jq -n --arg p "$PROMPT" '{prompt:$p,size:"2k"}')" \
    --canvas "$CANVAS" --node "$NODE" | jq -r '.data.taskId')
  dj task "$TASK" --watch
done
#    场景全景（createSceneSet）与道具板（createPropBoard）同样先落卡、再读回提示词出图

# ⑤ 拆分镜（整集一次拆完，别逐场重拆）：把已落板的名字与外观锚传回去
CAST=$(printf '%s' "$CHARS" | jq -r '[.data.characters[].name] | join(",")')
printf '%s' "$CHARS" | jq '[.data.characters[] | {name, anchor: .shotInjection}]' > /tmp/anchors.json
SB=$(dj storyboard --script ./ep1.txt --cast "$CAST" --scenes "<场景名,…>" --anchors /tmp/anchors.json)

# ⑥ 落分镜视频卡：一条命令搞定（按场次自动切批、kind:"video" + grouped、超 30 段自动拆批）
printf '%s' "$SB" > /tmp/sb.json
dj storyboard-fall "$CANVAS" -f /tmp/sb.json --script "$SCRIPT_NODE" --pretty
#    --script 传纪律 10 第①步落的剧本文本卡 id：视频卡才带站内同款 shotOf 溯源锚与
#    「场景N·视频｜<剧本标题>（<场景名>）」组名；不传站内会判「本剧本没拆过分镜」而重复落一整套卡
#    落出来就是站内「提取分镜」同款（本场引用坞 + 视频网格 + 编组）
#    unmatchedNames 里点名的名字 = 声明了却没有设定板：回到 ③ 补建、出图，再补一次 connectCards
#    等价的手写 jq 见「ops 词表速查」的 createStoryboard 条目（自己写 jq 出错的表现是**静默断链**）
#    ✗ 不要 createCard kind:"video"（不连参考、不进坞、不成组）  ✗ 不要逐镜落卡  ✗ 不要自拼 prompt

# ⑦ 出片前的门禁（纪律 10 第六步）：报价之前先体检（只读、不扣积分），errors 归零才往下走
dj canvas lint "$CANVAS" --pretty || {
  echo "有 error 级 finding：先补连线 / 补建设定板 / 把设定板生成出来，再回到这一步"; exit 1;
}
#    再核参考：每张视频卡上游必须是本场引用坞，坞成员的产物就是参考图
dj canvas structure "$CANVAS" | jq '.data.nodes[] | select(.kind=="hub") | {id, title, members}'
#    生成走 ref2v（第二次报价）：**不给 --reference**，服务端按画布边自动解析参考，
#    回执 meta.resolvedReferences 回显每一张的来源——逐条核对，对不上就先改边再生成
dj generate --request-id "$(dj uuid)" --model <视频模型id> --capability ref2v \
  --params-json "$(jq -n --arg p "$PROMPT" '{prompt:$p,durationSec:5}')" \
  --canvas "$CANVAS" --node "$SHOT" --pretty
#    prompt 用 dj node 读回卡上原文（分镜落的卡里台词已在「音轨：」行，不要再补一遍）。
#    要自己写 <Picture i> 声明就照 canvas lint 的 references 预演抄编号——那是确定答案，
#    别按回执猜（完整规范见「视频提示词书写规范」章）；有台词的角色先定嗓。
#    没有任何参考连线的视频卡不要生成（解析为空时服务端照常报「缺参考」）。

# ⑧ 之后要改某一段，**读回那张卡改字段**，不要重跑 storyboard（那会再付一次钱且冲掉改动）
FIRST=$(dj canvas structure "$CANVAS" | jq -r '.data.nodes[] | select(.kind=="video") | .id' | head -1)
dj node "$CANVAS" "$FIRST" --pretty          # 看正文全文与可写参数
echo '{"ops":[{"op":"updateCard","params":{
  "nodeId":"'"$FIRST"'","prompt":"…改好的整段提示词…","durationSec":6}}]}' \
  | dj ops "$CANVAS"

# ⑨ 加一段 = 再来一次 createStoryboard kind:"video"（同 sceneName 复用同一引用坞）；删一段 = deleteCard
```

第 ⑧ 步是整段的重点：**结构一旦落卡，真相就在画布上了**，后续修改必须
「读回那张卡改字段」，而不是重跑分析端点。第 ⑥ 步是整段最容易走错的地方：
分镜视频卡只有 `createStoryboard kind:"video"` 这一条路。

---

