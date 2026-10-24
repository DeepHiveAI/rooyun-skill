# 选题情报：雷达 · 简报 · 文案库

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：用户问「今天做什么选题」「帮我盯着这几个对标博主」「别人这条是怎么写的」；
> 或者你要在写稿之前先找依据，而不是凭空想一个开头。

## 这一章和这个技能的其余部分是两件事

主文件那套（建画布 → 拆剧本 → 生成）解决的是「**怎么把一个想法做出来**」。
这一章解决的是它上游的问题：「**今天该做哪个想法**」。

两者**互不依赖**：只想要选题情报可以一张画布都不建，只勾 `radar:read` /
`copy:read` / `brief:read` 三个权限就够；只搭画布则完全不用碰这一章。

## 三条铁一样的前提

1. **全部不扣积分**。这些端点读的是平台后台 cron 早就采好的数据，不调模型、不花钱。
   所以**不需要 precheck、不需要向用户报价**（纪律 1 管的是 `generate`，不管这里）。
2. **三个域共用一个账号权益**，不是三个开关。被拒时码面是 `radar_not_enabled`——
   这**不是 scope 不够**，重建令牌没有任何用，要管理员给账号开通「选题雷达」。
   认错这条会让你带着用户反复重建令牌，越试越挫败。
3. **简报读与雷达读吃同一个限流预算**（简报域直接复用雷达的限流实例）。
   别在循环里先刷一遍 `radar items` 再刷一遍 `brief`——它们花的是同一份配额。

## 从哪儿开始：直接读简报

九成情况下你**只需要这一条命令**：

```bash
dj.mjs brief --md
```

它返回一份当天的 markdown 全文，含每条选题的相关性依据、可执行性判断、
以及「别人同题材怎么写的」结构化拆解。可以直接贴给用户看。

要机器读就去掉 `--md` 拿 JSON：

```bash
dj.mjs brief --pretty            # 最近一份（不保证是今天，看 data.date）
dj.mjs brief 2026-09-21          # 指定某天（{id} 端点同时收 uuid 与 YYYY-MM-DD）
dj.mjs brief list                # 历史简报
```

### 简报里每条选题有什么

| 字段 | 是什么 | 怎么用 |
|---|---|---|
| `title` | 选题标题 | — |
| `relevance` | 与本频道的相关性判定 + 依据 | 低分的别硬做 |
| `feasibility` | **「AI 数字人做不做得了」** | 见下表，这是选/弃的主判据 |
| `references[]` | 别人同题材作品的**结构拆解 + 转写全文** | 写稿前必看；借结构，勿照搬 |
| `news[]` | 相关新闻 | 补事实、补时效 |
| `heat` / `boards` / `onBoardHours` | 热度与在榜时长 | 判时效窗口 |
| `evidence[]` | 这条为什么被选进来 | 向用户解释时用 |

`feasibility.materialNeed` 的四个取值，**直接决定这条选题值不值得接**：

| 值 | 含义 | 处置 |
|---|---|---|
| `pure_oral` | 纯口播能做完 | ✅ 数字人链路可以全自动 |
| `needs_broll` | 要配 B-roll 素材 | ⚠️ 可做，但要先解决素材从哪来 |
| `needs_shooting` | 要实拍 | ❌ 这条 AI 做不了，如实告诉用户 |
| `unknown` | 还没推断出来 | 当作「待人工判断」，**别当成能做** |

还有个 `feasibility.source`：`heuristic` = 规则判的（置信较低），
模型判的则没有这个标记。规则判的结论在向用户汇报时值得加一句「这条是规则推断」。

### 重建当日简报

```bash
dj.mjs brief rebuild              # 今天
dj.mjs brief rebuild --date 2026-09-20   # 昨天
```

三条约束，撞上再查就晚了：

- **只能今天或昨天（UTC）**，更早的日期返回 400。理由是重建用的是**此刻**的数据，
  写进更早的日期等于篡改留痕。
- **统计窗口恒为「此刻往前 24 小时」**，与 `date` 无关。指定昨天只是把结果落到
  昨天那一行，**不是时光机**——它不会去捞昨天那个时间点的数据。
- **幂等**：同一天重建覆盖同一行（一账号一天一份）。不会越建越多。

不扣积分、也不调任何大模型（只走关键词闸），所以重建很便宜，
但别在循环里反复调——它吃雷达的限流预算。

## 雷达：谁在涨

```bash
dj.mjs radar sources                      # 我订阅了谁
dj.mjs radar watch <博主主页链接>          # 加一位对标博主
dj.mjs radar items --window 7d --limit 20 # 作品按增量排序
dj.mjs radar item <itemId>                # 单条详情
dj.mjs radar hot                          # 热榜
dj.mjs radar daily                        # 每日选题报告（自带成稿 markdown）
```

### 排序排的是增量，不是绝对值

`radar items` 默认 `sort=likes_velocity`，即**窗口内的增量**。
这不是实现细节而是产品判断：按绝对值排，大号永远霸榜，而雷达要回答的是
「**谁正在起来**」。向用户解释排名时别说成「最火的」，那是两回事。

窗口会**按条目年龄收窄**：一条只发了 6 小时的片，它的「24h 增量」按 6 小时算。
此时 `delta.full` 为 `false`，**数值只是下界**——拿它跟满窗口的条目直接比大小是错的。

### 订阅收的是链接，不是 id

```bash
dj.mjs radar watch "https://www.douyin.com/user/MS4wLjABAAAA..."
```

夹着链接的整段分享文本也行（服务端摘第一个 http(s) URL）。支持：

- 抖音 `douyin.com/user/<secUid>`，或任意抖音路径带 `sec_uid` / `sec_user_id` 参数
- B 站 `space.bilibili.com/<UID>`
- YouTube `youtube.com/channel/UC...`

**不支持**：B 站 `b23.tv` 短链、YouTube `@handle` 形式。认不出来返回 400 并附提示。

订阅**幂等**（重复调不会建第二条，回 `meta.idempotent: true`）；
退订**不幂等**（重复删返回 404）。退订只删你的订阅行，全局源与历史快照序列都保留——
重新订阅能接上之前的曲线。

### 读数字时必须知道的三条

- **抖音的播放量恒为 `null`**，不是 0。平台不下发这个数，我们也**不估算**。
  任何地方看到 `views: null` 都照实说「拿不到」，别填 0、别按点赞乘系数推。
- **`radar metrics` 是原始快照**：不插值、不补零、不平滑，采样间隔还不均匀
  （48 小时内每小时 / 14 天内每 6 小时 / 之后每日）。两点之间的空档是「没采到」，
  画曲线时别把它连成直线当作真实轨迹。
- **`followerDelta7d: null`** = 序列长度不足以推断，**不是「没涨」**。

### 热榜的名次不能跨榜比

`rank` 只在**热度榜**上有意义；时序榜（按最新排的那些）的「第 1」只代表最新。
`hotValue` 更是各榜自己的口径，跨榜比大小没有意义。
掉榜表现为序列断点，不是 `rank: null`。

## 文案库：别人这条是怎么写的

```bash
dj.mjs copy search --keyword "提示词" --language zh --limit 10
dj.mjs copy get <entryId>
```

### 给的是全文 + 拆解，但**别照搬**

平台语料下发 `body`（转写全文），连同结构化拆解：钩子行、段落节奏
（每段的功能 + 时长占比）、金句摘录、CTA 类型、标题公式。

**拿结构去写用户自己的稿，不要把原文复述给他当成稿。** 这条不是技术限制而是本分——
照搬别人的稿子既不会有流量，也不是用户找你来做的事。

两个仍然成立的约束：

- **检索只匹配钩子行**，正文不参与任何检索。想按内容找只能先按钩子筛出候选再逐条看。
- **别人的用户私有条目不给正文**（`scope: "user"` 且不属于当前令牌）。
  那种情况 `body` 为 `null`——这是唯一还会返回 null 的成因，别当成 bug 重试。

### 单条详情里最值钱的是段落节奏

```
段落　hook(4%) → conflict(17%) → evidence(17%) → context(15%) → payoff(20%) → turn(4%)
```

括号里是**时长占比**。照着仿写时，它比 `role` 本身有用得多——
它告诉你该在哪一段花多少时间。一条 3 分钟的片子，`hook` 占 4% 就是**前 7 秒**。

### 检索参数

| 参数 | 取值 |
|---|---|
| `--language` | `zh` / `en` / `other` |
| `--tier` | `S` / `A` / `B` / `C`，逗号分隔（集内分位：S 前 20%、A 次 30%、B 次 30%、C 末 20%） |
| `--topic-type` | `tutorial` `story` `review` `listicle` `opinion` `explainer` `news` `case_study` `promo` `qna` `behind_scenes` `reaction` `other` |
| `--hook-type` | `question` `contrarian` `number_list` `curiosity_gap` `pain_point` `result_first` `authority` `story_open` `challenge` `other` |
| `--sort` | `composite_score`（默认） / `engagement` / `created_at` / `published_at` |
| `--vertical` | 垂类名；写错会返回 400 **并列出当前可用值**（不是返回空列表） |

⚠️ **分档是「集内分位」不是绝对质量**：某个集里的 S 档，换个集可能只是 B。
跨集比 tier 没有意义。

### 导入自己的文案

```bash
dj.mjs copy import --body ./my-script.txt --title "标题" --language zh
```

幂等键是**全库唯一的内容哈希**：同一段正文重复导入会收敛到同一行
（`meta.deduplicated: true`），不会产生重复。如果这段正文已经属于平台语料或别人，
返回 **409 `copy_duplicate`**。

质检标记（`meta.qualityFlags`）**只提示不拦截**：`lengthOut`（长度超区间）、
`hookTooLong`（钩子行太长）、`traditional`（繁体）。看到了如实转述给用户，别当成失败。

### 提取队列

```bash
dj.mjs copy jobs --stage failed
dj.mjs copy retry <jobId>
```

两个容易误判的点：

- **`copy jobs` 只列你自己触发的任务**。平台级自动排队的不出现在这里，
  所以**空列表不代表队列没在跑**。
- **只有 `failed` 能重试**，其余阶段返回 409 `copy_job_not_retryable`
  （`meta.stage` 告诉你当前在哪一阶段）。`failed` 是终态、不会自动重试。

## 一条完整的动线：从「今天做什么」到落画布

```bash
# 1. 看今天有什么值得做的
dj.mjs brief --pretty

# 2. 挑一条 feasibility=pure_oral 的，看别人同题材怎么写
#    （简报里的 references[] 已经带了；要更多就去文案库搜）
dj.mjs copy search --keyword "<选题里的关键词>" --language zh --limit 5
dj.mjs copy get <最像的那条>

# 3. 拿段落节奏当骨架写稿，然后走主文件那套：
#    建画布 → 落剧本卡 → 提取分镜 → 生成
```

第 2 步别跳过。**有对标结构的稿子和凭空写的稿子，差距通常在开头 7 秒**——
而那 7 秒决定完播。

## 端点对照

| 子命令 | 端点 | scope |
|---|---|---|
| `brief` | `GET /v1/briefs/latest` 或 `/briefs/{id}` | `brief:read` |
| `brief --md` | 同上 `?format=markdown` | `brief:read` |
| `brief list` | `GET /v1/briefs` | `brief:read` |
| `brief rebuild` | `POST /v1/briefs/rebuild` | `brief:write` |
| `radar sources` | `GET /v1/radar/sources` | `radar:read` |
| `radar watch` | `POST /v1/radar/sources` | `radar:write` |
| `radar unwatch` | `DELETE /v1/radar/sources/{id}` | `radar:write` |
| `radar followers` | `GET /v1/radar/sources/{id}/followers` | `radar:read` |
| `radar items` | `GET /v1/radar/items` | `radar:read` |
| `radar item` | `GET /v1/radar/items/{id}` | `radar:read` |
| `radar metrics` | `GET /v1/radar/items/{id}/metrics` | `radar:read` |
| `radar hot` | `GET /v1/radar/hot` | `radar:read` |
| `radar daily` | `GET /v1/radar/daily` | `radar:read` |
| `copy search` | `GET /v1/copy/entries` | `copy:read` |
| `copy get` | `GET /v1/copy/entries/{id}` | `copy:read` |
| `copy import` | `POST /v1/copy/entries` | `copy:write` |
| `copy jobs` | `GET /v1/copy/jobs` | `copy:read` |
| `copy retry` | `POST /v1/copy/jobs/{id}/retry` | `copy:write` |

`POST /v1/radar/ingest` 是**海外采集节点**投递快照用的，需要 ingest operator 身份，
不面向普通用户，本技能不提供对应子命令。

## 这一章的错误码

通用码见 [`errors.md`](errors.md)。这三个域**额外**要认的：

| 码 | 含义 | 处置 |
|---|---|---|
| `radar_not_enabled` (403) | 账号没开通「选题雷达」 | **不是权限问题**，重建令牌无用，要管理员开通 |
| `copy_duplicate` (409) | 这段正文已属平台语料或别人 | 不是失败，说明库里已经有了 |
| `copy_job_not_retryable` (409) | 这个任务当前阶段不能重试 | 看 `meta.stage`；只有 `failed` 能重试 |
| `not_found` (404) | 条目/简报不存在，**或不属于你** | 两者不区分。别反复重试 |

分页游标是**十进制偏移串**，自己编一个会返回 400（不会静默回第一页）。
翻页期间数据可能变动，出现重复或漏行是正常的——需要精确快照就带 `--from/--to` 打时间窗。
