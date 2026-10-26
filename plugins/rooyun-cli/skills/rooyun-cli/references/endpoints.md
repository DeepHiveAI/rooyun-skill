# 端点速查

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：要调任何端点前；不确定响应长什么样、该用哪个能力词时

## 端点速查

`dj.mjs` 子命令 ↔ 端点 ↔ 所需 scope：

| 子命令 | 端点 | scope |
|---|---|---|
| `me` | `GET /api/v1/me` | 任何有效令牌 |
| `version` | `HEAD /api/skill/bundle`（读版本头） | **无需令牌** |
| `update` | `GET /api/skill/bundle`（下载并覆盖本地安装） | **无需令牌** |
| `doctor` | `GET /api/v1/me` + `/billing/wallet` + 本地安装扫描 | 任何有效令牌 |
| `models [--capability c]` | `GET /api/v1/models` | 任何有效令牌 |
| `voices [--q 关键词]` | `GET /api/v1/voices` | 任何有效令牌 |
| `digital-humans` | `GET /api/v1/digital-humans` | 任何有效令牌（**仅管理员有内容**，其余恒为空列表） |
| `character-voices <canvasId>` | `GET /api/v1/canvases/{id}/character-voices` | `projects:read` |
| `character-voices <canvasId> --bind/--unbind/-f` | `PUT /api/v1/canvases/{id}/character-voices` | `canvas:write` |
| `projects create <name>` | `POST /api/v1/projects` | `canvas:write` |
| `projects list` | `GET /api/v1/projects` | `projects:read` |
| `canvas list <projectId>` | `GET /api/v1/projects/{id}/canvases` | `projects:read` |
| `canvas create <projectId> <name>` | `POST /api/v1/projects/{id}/canvases` | `canvas:write` |
| `ops <canvasId>` | `POST /api/v1/canvases/{id}/ops` | `canvas:write` |
| `canvas structure <canvasId> [--full]` | `GET /api/v1/canvases/{id}/structure[?detail=full]` | `projects:read` |
| `canvas lint <canvasId>` | `GET /api/v1/canvases/{id}/lint` | `projects:read`（不扣积分） |
| `node <canvasId> <nodeId>` | `GET /api/v1/canvases/{id}/nodes/{nodeId}` | `projects:read` |
| `extract <kind> --script <path>` | `POST /api/v1/analyze/extract` | `llm` ★扣积分 |
| `storyboard --script <path>` | `POST /api/v1/analyze/storyboard` | `llm` ★扣积分 |
| `storyboard-fall <canvasId> -f <响应.json> [--script <剧本卡id>]` | `POST /api/v1/canvases/{id}/ops`（每场一批 createStoryboard） | `canvas:write` |
| `rewrite <mode> --text …` | `POST /api/v1/analyze/rewrite` | `llm` ★扣积分 |
| `caption image\|video …` | `POST /api/v1/analyze/caption` | `llm` ★扣积分（图片 0.1/次、视频 0.1/秒） |
| `inspect <assetId> …` | `POST /api/v1/analyze/inspect` | `llm`（不扣积分） |
| `agents` | `GET /api/v1/agents` | 任何有效令牌 |
| `chat new --agent <id>` | `POST /api/v1/conversations` | `llm`（建会话不扣积分） |
| `chat send <id> --request-id <uuid> "…"` | `POST /api/v1/conversations/{id}/messages` | `llm` ★扣积分（每轮） |
| `chat history <id> [--after-seq N]` | `GET /api/v1/conversations/{id}/messages` | `llm` |
| `chat show <id>` | `GET /api/v1/conversations/{id}` | `llm` |
| `chat delete <id>` | `DELETE /api/v1/conversations/{id}` | `llm`（硬删，不可撤销） |
| `chats [--agent <id>]` | `GET /api/v1/conversations` | `llm` |
| `upload <path>` | `POST /api/v1/assets` | `assets:write` |
| `edit-session create <canvasId> <nodeId>` | `POST /api/v1/edit-sessions` | `canvas:write` |
| `edit-session status <sessionId>` | `GET /api/v1/edit-sessions/{id}` | `canvas:write` |
| `edit-session revoke <sessionId>` | `DELETE /api/v1/edit-sessions/{id}` | `canvas:write` |
| `precheck` | `POST /api/v1/generations/precheck` | `generate` |
| `generate` | `POST /api/v1/generations` | `generate` |
| `task <id> [--watch]` | `GET /api/v1/generations/{id}` | `tasks:read` |
| `tasks [--status active\|all] [--canvas <id>] [--request <id>]` | `GET /api/v1/generations` | `tasks:read` |
| `cancel <id>` | `POST /api/v1/generations/{id}/cancel` | `generate` |
| `assets list [--project p]` | `GET /api/v1/assets`、`/projects/{id}/assets` | `assets:read` |
| `assets get <assetId>` | `GET /api/v1/assets/{id}` | `assets:read` |
| （download.mjs 内部） | `GET /api/v1/assets/{id}/download` → 302 | `assets:read` |
| `wallet` / `ledger` | `GET /api/v1/billing/wallet`、`/ledger` | `billing:read` |
| `creator-resolve <链接或口令>` | `POST /api/v1/creators/resolve` | `creators:read` |
| `video-url <链接或口令>` | `POST /api/v1/creators/resolve`（请求体 `withPlayUrl: true`） | `creators:read` |
| `creator-analyze <secUid> <videoId> <videoId> …` | `POST /api/v1/creator-analyses` | `creators:read`（**videoIds 必须点名**，见纪律 15） |
| `creator-analysis <jobId>` | `GET /api/v1/creator-analyses/{id}` | `creators:read` |
| `reference-analyze (<链接或口令或视频id> \| --asset <assetId>) [--out account.json] [--timeline-md TIMELINE.md]` | `POST /api/v1/reference-decompositions`（提交后默认等到终态）；`--asset` 拆资产库里的视频（自己的成片） | `creators:read` ★扣积分（0.1/秒，含后续改编） |
| `reference-analysis <jobId>` | `GET /api/v1/reference-decompositions/{id}` | `creators:read` |
| `reference-frames <jobId> (--shot\|--shots\|--range\|--around)` | 读一次 `GET /api/v1/reference-decompositions/{id}` + `POST /creators/resolve`，**抽帧在你本机跑**（ffmpeg） | `creators:read` |
| `reference-adapt <jobId> --presenter … --product …` | `POST /api/v1/reference-decompositions/{id}/adaptations` | `generate`（不另收费，含在拆解价内） |
| `reference-compare <参考片jobId> <成片jobId>` | `POST /api/v1/reference-decompositions/{id}/compare` | `creators:read`（纯计算不花钱） |
| `reference-template <jobId> <jobId> …` | `POST /api/v1/reference-templates` | `creators:read`（纯计算不花钱） |
| `creator <secUid>` | `GET /api/v1/creators/{secUid}` | `creators:read` |
| `creator-report <secUid> <videoId>` | `GET /api/v1/creators/{secUid}/videos/{videoId}/report` | `creators:read` |
| `creator-archive <secUid> <videoId>` | `POST /api/v1/creators/{secUid}/videos/{videoId}/archive` | `assets:write`（取文件另需 `assets:read`） |
| `brief [<id或日期>] [--md]` | `GET /api/v1/briefs/latest`、`/briefs/{id}`（`--md` = `?format=markdown`） | `brief:read`（不花钱） |
| `brief list` | `GET /api/v1/briefs` | `brief:read` |
| `brief rebuild [--date d]` | `POST /api/v1/briefs/rebuild` | `brief:write`（不花钱、不调模型；只能今天或昨天） |
| `radar sources` | `GET /api/v1/radar/sources` | `radar:read` |
| `radar watch <主页链接>` | `POST /api/v1/radar/sources` | `radar:write`（幂等） |
| `radar unwatch <sourceId>` | `DELETE /api/v1/radar/sources/{id}` | `radar:write`（**不**幂等，重复删 404） |
| `radar followers <sourceId>` | `GET /api/v1/radar/sources/{id}/followers` | `radar:read` |
| `radar items` | `GET /api/v1/radar/items` | `radar:read`（排序是**增量**不是绝对值） |
| `radar item <itemId>` | `GET /api/v1/radar/items/{id}` | `radar:read` |
| `radar metrics <itemId>` | `GET /api/v1/radar/items/{id}/metrics` | `radar:read`（原始快照，不插值） |
| `radar hot` | `GET /api/v1/radar/hot` | `radar:read` |
| `radar daily [--date d]` | `GET /api/v1/radar/daily` | `radar:read`（自带成稿 markdown） |
| `copy search` | `GET /api/v1/copy/entries` | `copy:read`（只匹配钩子行） |
| `copy get <entryId>` | `GET /api/v1/copy/entries/{id}` | `copy:read`（平台条目 `body` 恒 null） |
| `copy import --body <文件>` | `POST /api/v1/copy/entries` | `copy:write`（幂等键 = 内容哈希） |
| `copy jobs` | `GET /api/v1/copy/jobs` | `copy:read`（只列你自己触发的） |
| `copy retry <jobId>` | `POST /api/v1/copy/jobs/{id}/retry` | `copy:write`（只有 failed 能重试） |

> 上面这 18 行是**选题情报**那条链，与搭画布互不依赖，全部**不扣积分**，
> 且共用同一个「选题雷达」账号权益（被拒码面 `radar_not_enabled`，重建令牌无用）。
> 参数、口径与陷阱见 [`topic-intel.md`](topic-intel.md)。

机器可读契约：`GET /api/v1/openapi.json`（OpenAPI 3.1，无需鉴权）。要写自己的调用代码时读它。

### 响应形状（用来写 jq，别靠眼睛抄 id）

**所有**响应形状恒定——成功也带 `error: null`，失败也带 `data: null`：

```jsonc
{ "ok": true,  "data": { /* … */ }, "error": null, "meta": { /* 可选 */ } }
{ "ok": false, "data": null, "error": { "code": "not_found", "message": "画布不存在" } }
```

`dj.mjs` **默认原样输出这个信封**（`--pretty` 才转人读摘要），所以脚本化取值一律走 `.data.*`：

```sh
# 一次调用要取多个字段：先存整个响应，再逐个解析——
# 千万别为了取第二个字段就把 `projects create` 跑第二遍（那会建出两个项目）
CREATED=$(dj projects create "深夜便利店")
PROJECT=$(printf '%s' "$CREATED" | jq -r '.data.projectId')
CANVAS=$(printf '%s'  "$CREATED" | jq -r '.data.canvasId')
URL=$(printf '%s'     "$CREATED" | jq -r '.data.url')

OPS=$(dj ops "$CANVAS" -f batch1.json)
SHOT1=$(printf '%s'   "$OPS" | jq -r '.data.results[2].nodeIds[0]')

TASK=$(dj generate --request-id "$RID" … | jq -r '.data.taskId')
ASSET=$(dj task "$TASK" | jq -r '.data.assetId')

# 按标题定位 nodeId（比赌数组下标稳）
dj canvas structure "$CANVAS" | jq -r '.data.nodes[] | select(.title=="镜1 推门") | .id'
```

> ⚠️ **变量转管道必须用 `printf '%s'`，不要用 `echo`**。zsh 的内建 `echo` 会解释反斜杠转义，
> 把 JSON 字符串里的 `\n` 变成真换行，jq 立刻报
> `control characters from U+0000 through U+001F must be escaped`。
> 直接管道（`dj … | jq`）不受影响，是最省事的写法。

各端点 `data` 的字段（列表端点的数组键**不统一**，照抄这张表）：

| 命令 | `data` 形状 |
|---|---|
| `me` | `{userId, name, scopes[], expiresAt, spendLimitCredits, spentCredits}` |
| `models` | `{models: [{id, name, description?, capabilities[], pricing: {unit, creditsPerUnit} \| null, video?, image?, audio?}]}` — `description` 是档位/取舍说明（速度档/质量档这类同名多档模型靠它选档），未填写时缺席；`audio: {emotionVector, durationFactor}` 只在配音模型且至少一位为 true 时出现（见「配音情绪向量」节） |
| `projects list` | `{projects: [{id, name, updatedAt, defaultCanvasId}]}` + `meta{total,limit,offset}` |
| `projects create` | `{projectId, canvasId, canvasKey, url}` |
| `canvas list` | `{projectId, canvases: [{canvasId, canvasKey, name, isDefault, updatedAt, url}]}` |
| `canvas create` | `{projectId, canvasId, canvasKey, name, url}` |
| `ops` | `{version, canvasId, projectId, canvasKey, results[], createdNodeIds[], deletedNodeIds[]}`；`results[i] = {op, index, ok, nodeIds?, noop?, code?, message?}` |
| `canvas structure` | `{version, canvasId, projectId, canvasKey, nodes[], edges[]}` — 加 `--full`（`?detail=full`）时每个 `nodes[i]` 多一个 `detail: {body?, params, config?}`：正文全文（缺省的 `summary` 截到 600 字）+ 全部可写参数，与 `dj node` 同一口径（读回什么就能改什么）。`detail` 只认 `full`，其它值 400 `invalid_request`。大画布响应会明显变大，只要拓扑/nodeId 时别带 |
| `canvas lint` | `{version, canvasId, findings: [{rule, severity:"error"\|"warn", nodeId?, nodeTitle?, names?[], message}], summary:{errors, warnings}, references: [{nodeId, nodeTitle, references:[{index, tag, assetId, sourceNodeId?, via, label?}], truncated?}]}` — 规则四条：`video_missing_reference`（视频卡上游没有任何已出图的参考，error）· `board_not_generated`（被下游引用的设定板自己还没出图，error，`names` 列板名）· `hub_empty`（空引用坞连了下游，warn）· `prompt_names_unlinked`（提示词点了某个设定板的名字、这张卡却没连它，warn，`names` 列是哪几个——**改过 prompt 之后最容易撞上**）。**`summary.errors` 不为 0 就别提交生成**，命令退出码 2。`references` 是每张待出片视频卡的**参考解析预演**：`tag` 直接抄进提示词、`label` 是「这张参考是谁」，顺序与真正提交时逐位一致 |
| `precheck` | `{enabled, total, balance, available, ok, items: [{credits, priced}]}` — `available` 才是本批可用（含赠送积分），`balance` 只是充值积分 |
| `generate` | `{taskId, status, canvasId?, nodeId?, heldCredits?}` + `meta{resolvedReferences?, promptCompile?, warnings?}` — `heldCredits` 是**冻结额**（最多花这么多），不是实扣。**`meta` 里那三位都要看**：`resolvedReferences` 是服务端替你填的参考及来源（逐条核对）；`promptCompile.applied` 是平台补了哪几段提示词（没有这一位=一个字都没动）；**`warnings` 是「提示词点了某个设定板的名字，但这张卡没连它」**——不阻断提交，但十有八九就是「人物每镜换脸」那个事故，看到就该停下来改边而不是等出片 |
| `tasks` | `{tasks: [{taskId, status, capability, requestId?, canvasId?, nodeId?, assetId?, createdAt, updatedAt}]}` + `meta{total, limit, offset}` — **状态丢了就用它**：缺省只列在途（`--status all` 看历史），可按 `--canvas` / `--request` 过滤。⚠️ `status` 是**库里的快照、不轮询上游**，可能滞后——要准确状态（以及触发终态落卡）仍要逐条 `dj task <taskId>`。`requestId` 是你提交时的幂等键，拿它和自己的记录对上号 |
| `task` | `{taskId, status, progress?, assetId?, error?, capability, canvasId?, nodeId?, landedTo, chargedCredits?, cancelRequested?, prompts?}` + `meta{pollAfterMs}` — **终态的 `chargedCredits` 才是实扣**，收尾汇报逐笔累加它。`prompts.applied` 是**平台补了哪几段**的段名（与提交回执 `meta.promptCompile.applied` 同源）；`prompts.submitted`（你提交的原文）**只在两种情况下回显**：提交时传了 `promptCompile:"off"`，或平台一段都没补（`prompts.applied` 为空）——其余情况只回段名、不回编译后的全文，要逐字可控就传 `off`（原文本就在你手里）。**没有编译记录的老任务两位都不回显**。`prompts.final` 只在走**图片改写链路**时出现，视频链路恒缺席——别拿它判断「平台改没改」 |
| `chat new` | `{conversation: {conversationId, agentId, modelId, title, kind, createdVia, createdAt, updatedAt, lastSeq}}` + `meta{billingUnit, stagesPerTurn, perRoundCredits, estimatedTurnCredits}` — **`conversationId` 就是这段创作的全部状态**，存进你的「任务 → conversationId」表。建会话不扣钱，但 **`meta.estimatedTurnCredits` 就是下一轮的报价**（`null` = 该模型未配价、发轮会被 503 拒，**不是免费**） |
| `chat send` | `{messageId, seq, text, status, artifacts[], usage, credits, createdAt}` + `meta{billingUnit, stagesPerTurn, replayed?}` — 产物型 Agent 的稿件在 `artifacts[]`：`{kind, roundId?, artifactId?, phase?, summary?, error?, variants:[{variantId:"a"\|"b", artifactId, text?}]}`，**`text` 是稿件全文**（读不回来时该稿只是没有 `text` 字段，不是空串）。`usage` / `credits` 为 `null` 是产物型的常态（多阶段各自扣分，门面拿不到聚合金额，**不等于免费**——去 `ledger` 对账）。`meta.replayed:true` = 同 `requestId` 的幂等重放，**本次未扣费** |
| `chat history` | `{messages: [{seq, role, text, artifacts[], createdAt}]}` + `meta{limit, afterSeq?, count, lastSeq}` — `seq` 游标严格大于 `afterSeq`；下次增量拉取传 `meta.lastSeq`。内部消息（幂等标记、作废行）不出现在这里 |
| `chat show` | `{conversation{…同 chat new…}, lastMessage?{seq, role, text, artifacts[], createdAt}}` + `meta{billingUnit, stagesPerTurn, perRoundCredits, estimatedTurnCredits}` — **`meta.estimatedTurnCredits` 就是下一轮的报价**（服务端已把 `stagesPerTurn × 单价` 乘好）；换过 `modelId` 之后重查一次就是新单价 |
| `chat delete` | `{deleted: true, conversationId}` — 拿到它就是**真删掉了**：这段会话与它的全部消息都没了，网页端也看不到，**不可撤销**。删除不退款、不动账本（已花的钱记在 `ledger` 上，与会话生死无关）。会话正被写时是 409 `conversation_busy`（等这一轮跑完再删）；重复删除是 404 而不是 200 |
| `chats` | `{conversations: [{…同 chat new 的 conversation…}]}` + `meta{total, limit, offset}` — **含网页端建的会话**（`createdVia` 分辨 `web` / `api`）；`lastSeq` 是各段会话的历史游标起点 |
| `cancel` | `{taskId, status, stopped, cancelRequested, cancelState}`。`cancelState` 三态：`stopped`=真停已退款 / `recorded`=意向在案（约 10 分钟内必收敛到终态）/ `already_final`=幂等空操作 |
| `assets list` | `{items: [{assetId, mime, sizeBytes, createdAt, durationS}]}`（加 `--project` 时多一个 `integrity`）+ `meta{total,limit,offset}` |
| `wallet` | `{enabled, balance, held, pools: [{id, label, balance, held, scopeModelIds}]}` — `pools` 是赠送积分，只能花在 `scopeModelIds` 内的模型与 LLM 对话（analyze / 文案加工类）上（扣费时先花赠送、再花充值） |
| `ledger` | `{entries: [{id, type, amount, balanceAfter, heldAfter, createdAt, taskId, tokenId}]}` |
| `creator-resolve` | 按 `kind` 判别：`{kind:"creator", creator:{secUid,nickname,avatarUrl,followerCount,videoCount}, videos:[{videoId,title,coverUrl,durationSec,authorName,statistics:{diggCount,commentCount,shareCount,collectCount,playCount}}]}` + `meta{total}` / `{kind:"video", video:{videoId,title,authorName,coverUrl,durationSec,statistics}}`。**默认没有播放直链**（要直链用 `video-url`）。主页分支当前恒返空 `videos` + `videoListUnavailable:{reason:"blocked",message}`——`secUid` 仍可用，见纪律 15 |
| `video-url` | 与 `creator-resolve` 同构，但每条视频多一个 `playUrl`（视频直链，裸 `curl -L` 可下）。**主页分支当前拿不到列表**（上游封锁），只有单条视频链接可用 |
| `creator-analyze` | `{jobId, status:"queued", sampleVideoIds[], skippedVideoIds?:[{videoId,reason}], statusUrl}`；命中幂等时 `{jobId, status, deduplicated:true}`。`skippedVideoIds` = 你点名了但没进样本的，要如实转告用户 |
| `creator-analysis` | `{jobId, secUid, status, videos:[{videoId, phase, gpuStage?, failedStage?, failedCode?, error?}], succeededVideoIds[], error?, createdAt, updatedAt}` + `meta{total,succeeded}`。`gpuStage` queued=还在 GPU 队列排队 / processing=已在处理；`failedStage` 说明死在哪一步（resolve/enqueue/queue/gpu/analysis）；`failedCode` 说明为什么死并决定处置：`upstream_server_error`/`upstream_unreachable` 换模型或稍后再来 · `upstream_auth`/`analysis_not_configured`/`gpu_unconfigured` 找管理员（重试无用）· `upstream_rate_limited` 退避重试 · `upstream_unparsable` 直接重试 · `gpu_queue_timeout` 队列拥堵 · `gpu_inference_timeout` 推理超时 · `job_expired` 整单超龄 |
| `reference-analyze` | 提交回执 `{jobId, status:"queued", videoId, statusUrl, credits, billedSec}`（幂等命中 `{jobId, status, deduplicated:true}`，**不扣费**）；默认等到终态后 stdout 是 `reference-analysis` 的信封。**计费**：0.1 积分/秒 × 源视频时长（服务端取可信时长，向上取整秒，上限 600 秒），建任务前一次扣清，`credits` 实扣、`billedSec` 计费秒数；任务 `failed` 自动全额退款；排队已满 409 `reference_job_active` 不扣费；同一条拆解的后续改编（`reference-adapt`，单条最多 20 份）**不另收费**。余额 / 令牌限额不足 → 402；读不出时长（如图文笔记）→ 400；未配价 → 503 `service_unavailable`。**发起前先按「时长 × 0.1」向用户报价并等确认** |
| `reference-compare` | `{referenceJobId, candidateJobId, comparison}`。**复刻验收**（纯计算不花钱）：成片先 `reference-analyze --asset <assetId>` 拆一遍，再与参考片 diff。`comparison.functionSequence.missing` = 参考片有、成片一次都没出现的功能（**最该看的一行**，丢了 proof 就是漏了证据环节）· `agreement` = LCS 对齐数 ÷ 参考片段数 · `preserveKept[].status:"dropped"` = 参考片标必保、成片没当回事的维度 · `verdict` 只是提示**不是门禁**（只比结构，不比观感画质）。两边都要 succeeded，否则 409 |
| `reference-template` | `{template, samples[], skipped?}`。**纯计算、不花钱**：2–12 条已 succeeded 的拆解 → 赛道结构模板。`template.pattern` 骨架（`escalate+` = 多数样本里连续好几段）· `steps[].support` 每环节在多少比例样本里出现（**< 1 才有信息量**，如 `cta 0.67` = 三条里一条不带 CTA）· `functionMix` 各功能占比 · `preserveConsensus` 各维度被标「换掉就垮」的段占比 · `avgSegmentCount/avgDurationSec`。未 succeeded 的样本列在 `skipped` 不静默少算；可用样本 < 2 → 400 |
| `reference-adapt` | `{jobId, adaptation, diagnostics?, deduplicated?}`。**同步**（十几到几十秒），scope `generate`。`adaptation.segments[]` 与参考片一一对应：`index/sourceIndex/function/intent` 由服务端回填（结构不许动）、`dialogue`/`visualBrief` 是新写的、`conflicts[]` 是「你要换但这一段标了必保、所以没换」的维度（`conflictCount` 给段数）。**先看 `adaptation.verdict`**：`strained` = 至少一个维度过半的段都拒绝更换，产物必是自相矛盾的混合稿，别用——`warnings[]` 点名维度，`dimensionOutcomes[]` 给逐维度落点（换了几段/被拒几段/拒绝率）；处置是换一条对标片或去掉那个维度。`diagnostics.fallbackIndices` = 模型漏写按原片兜底的段号。拆解未 succeeded 或改编数超 20 → 409。带 `requestId` 幂等（`deduplicated:true` 时**没打上游、没花钱**）。`--script-md` 直接出可粘进剧本卡的分段文案 |
| `reference-analysis` | `{jobId, videoId, title?, status, phase, gpuStage?, visualProgress?:{done}, structureAttempts?, transcriptSource?, failedStage?, failedCode?, error?, result?, createdAt, updatedAt}`。`phase` 顺序 `pending → gpu → visual → structure → done`（画面层先跑、结构层后跑并吃画面清单；结构层最多试 2 次）。**`succeeded` 时 `result.account` 就是产物**：`spine`（一句话骨架）+ `segments[]`（按镜号，每镜 `index,startSec,endSec,dialogue,function,intent,adaptable[],preserve[],visual,confidence`）；**`result.reliability` 先读**：`function{level:"medium"\|"low", issues[]}`（由 rubric 位置约束/缺坏段/后段敷衍/未经画面确认的 proof 算出，issues 逐条说复核哪几段；上限 medium，无人工基准）· `dimensions[]{dimension,preserveRate,adaptableRate,signal}`（`low-signal` = 从不进 adaptable 且 preserve > 70%，一刀切无区分力；`unassessed` = 两边都没出现）· `proofUnverified[]`（判了 proof 但无画面描述的镜号）· `dialogue` `timed`/`untimed`/`none`；每镜可选 `sourceSpans[[start,end]…]` = 由哪几个原始切镜合并而来；`result.diagnostics` 有 `shotsWithoutFrames/visualFailures/missingStructureIndices/rawShotCount` 等计数。**`visual` 为空串 = 该镜无画面证据，不是缺陷**（系统刻意不编）。`transcriptSource`：`dashscope` 台词按镜归属可靠 / `whisper` 无时间戳 `dialogue` 全空 / `none` 无人声。`failedCode` 处置同 `creator-analysis` 那张表，另加 `structure_failed`/`structure_unparsable`（结构层两次都没出合法产物，重发一次）、`gpu_product_expired`（产物过期，重新发起）、`vlm_unconfigured`/`vlm_mock_only`（找管理员）。每账号 1 条在跑 + 最多 3 条排队（可一次发 4 条，平台按账号串行消化；排队中 `status:"queued"`）；排队满时 **409 `reference_job_active`**（`meta.activeJobId` 在跑的那条、`meta.queued` 排队数），等它们推进后再发；`dj reference-analyze` 撞到它会自动转为等在跑的那条 |
| `creator` | `{secUid, nickname, reportVersion, analyzedAt, freshness, sampleVideoIds[], videoCountAtAnalysis, report:{…全量画像，含 stylePrompt/replicationGuide/titleFormula/contentMatrix…}, aigc:true}` |
| `creator-report` | `{videoId, reportVersion, transcript, report:{…}, aigc:true}` |
| `creator-archive` | `{videoId, assetId, sizeBytes, mimeType, expiresAt, archivedAt, deduplicated, aigc:false}` |
| `extract` | 按 `kind` 判别：`{kind:"characters", characters:[…]}` / `{kind:"scenes", scenes:[…]}` / `{kind:"props", props:[…]}` + `meta{modelId,creditRef,credits,billingUnit,usage}` |
| `storyboard` | `{visualTone, newCast[], scenes:[{name,time,inOut,emotionArc,shots:[…], segments:[{shotNoStart,shotNoEnd,durationSec,title,videoPrompt,cast[],props[],audio,lint:{version,error,warn,info,codes[]}}]}]}` + 同上 `meta`。`lint` 是该段的编译后机检摘要（只记录不拦截）：`error>0` 先按 codes 回 ③ 修分镜再落卡，`warn` 酌情，`info` 可忽略。`segments` 是平台同款打包+编译的建议段：**整段原样传给 `createStoryboard kind:"video"`**（`videoPrompt`→`prompt`；多镜含硬切指令与镜头时长，对白在「音轨：」行内一字不丢；`cast`/`props` 是段内并集、`audio` 是段内有无音轨），自拼提示词曾导致全片对白静默丢失。**调用时务必传 `appearanceAnchors`**（`--anchors`：把 extract 的 `shotInjection` 映射成 `[{name,anchor}]`），否则模型每镜重新想象角色长相 |
| `rewrite` | `{mode, text}` + 同上 `meta` |
| `caption` | `{kind:"image", text}` 或 `{kind:"video", prompt, scope?, slots?, warnings?}` + `meta{modelId,promptVersion,billingUnit,credits,creditRef,mock?}`。**扣积分**（与网页端同价）：图片 `billingUnit:"per_call"` 0.1 积分/次；视频 `"per_second"` 0.1 积分/秒，计费时长 = max(`durationSec`, 末帧时刻) 向上取整秒，上限 600 秒。上游失败 / 产物不可用自动退款（失败响应 `credits` 报 0，`creditRef` 供对账）；mock 演示产物不扣费。余额 / 令牌限额不足 → 402（`insufficient_credits` / `token_limit_exceeded` / `token_daily_limit_exceeded`）；未配价 → 503 `service_unavailable`。**调用前先报价** |
| `inspect` | `{verdict, checks:[{dimension,verdict,reason,basis?}], advice?, judge{modelId,promptVersion}}` + `meta{modelId,promptVersion,billingUnit:"free",credits:0,mock?}`（**不扣积分**，但受 `llm` scope 与视觉桶限流约束） |
| `edit-session create` | `{sessionId, url, expiresAt, capability, canvasId, nodeId, sourceAssetId, status:"pending"}` |
| `edit-session status` / `revoke` | `{sessionId, status, capability, canvasId, nodeId, sourceAssetId, expiresAt, createdAt, result?}`；`result`（仅 submitted）`= {maskAssetId, resultAssetId, instruction, submittedAt}` |

`structure.nodes[]` 的字段（**这是你按标题定位 nodeId 的依据**）：

```jsonc
{
  "id": "n_e9968ba8-03a1",          // 就是 ops 要的 nodeId
  "kind": "image",                  // text/image/video/audio/scene/script/group/hub/analyze/director
  "title": "老城区天台 · 全景",
  "summary": "黄昏，晾衣绳…",        // 按卡型取的正文摘要，≤600 字；截断时另有 summaryTruncated:true
  "assetIds": [],                   // 本卡的产物；下载就用这里的 id
  "hasAsset": false,                // 等价于 assetIds 非空
  "aspectRatio": "2:1",
  "anchor": { "kind": "scene", "name": "老城区天台" },  // 身份锚，仅角色/场景/道具卡有
  "shotNo": 1,                      // 故事板镜号，仅挂进故事板的图片卡有
  "parentId": "n_…",                // 所属编组，顶层卡无此字段
  "members": [                      // 仅引用坞（hub）有：它引用的设定板/资产
    { "kind": "node", "id": "n_…", "label": "角色设定板" }
  ]                                 // 设定板 → 坞是成员关系不产生边；视频卡的参考图 = 成员的 assetIds
}
```

`structure.edges[] = {source, target, sourceHandle?}`。

**分页**：`limit` 默认 50 上限 100，越界一律 **400 不静默夹取**；`meta.total` 是过滤后的总数；
`offset` 翻过头返回空页而非报错——**以空页作为翻页终止条件**。

### 生成能力词（十二个粗粒度词）

| capability | 必填输入（在 `params` 内，`ref2v` 除外） | 常用可选 |
|---|---|---|
| `t2i` 文生图 | `prompt` | `size`(1k/2k/4k)、`aspectRatio`、`seed`、`quality`、`watermark`、**`transparentBackground`**（透明底 PNG，见下节）、顶层 `referenceAssetIds`、**`mask`**（局部重绘，见下节） |
| `i2i` 图生图/编辑/放大/抠图 | `image` | `prompt`、`operation`(edit/upscale/removebg/look，**`removebg` 要先按 `image.removebg` 挑模型，见下节**)、`size`(1k/2k/4k，决定输出档位与计价倍率，放大请显式给)、`aspectRatio`（放大时与源图一致）、`quality`、`seed` |
| `i2v` 图生视频 | `firstFrame` | `prompt`、`durationSec`、`resolution`(480p…4k，按模型目录)、`aspectRatio`、`audio` |
| `flf2v` 首尾帧生视频 | `firstFrame` + `lastFrame` | 同 `i2v` |
| `ref2v` 参考图生视频 | 顶层 `referenceAssetIds`（≥1，最多 9） | 同 `i2v`、顶层 **`referenceAudioAssetIds`**（锁角色音色，见「角色音色一致性」章；加顶层 `referenceAudioMode: "fully_copy"` 则改为**原样复用这段音频当成片声音**，如唱用户的歌：仅 H3 全参考、恰好一段、≤15 秒，时长跟随音频）、顶层 **`referenceVideoAssetIds`**（≤3 段，动作/运镜参考，见「白模换角」章） |
| `avatar` 数字人口播 | `drivingAudio` + （`firstFrame` 或 `motionVideo` 至少一个；或管理员的专属数字人 `digitalHumanId`，见下节） | `prompt`、`aspectRatio`（见下节） |
| `t2a` 配音 | `text` + 音色（`voiceId` 或 `voiceName` 二选一，先 `dj voices` 挑；不传 = 400 不扣费，平台不替你挑默认嗓子） | `speed`、`emotion`、`styleText`、`moodId`、**`emoVector`+`emoAlpha`**（8 维情感向量+强度，成对）、**`durationFactor`**（模型内变速，与 `speed` 互斥）——后三个要先按 `audio` 能力位挑模型，见「配音情绪向量」节。**Gemini 模型**用 `styleText`（一句自然语言风格指令，≤100 字、不含括号）表达情绪与语速，`emotion` 对它不生效；台词里的停顿 `<#0.5#>` 与语气词由服务端转成 Gemini 标签 |
| `music` 音乐 | `text` | `lyrics`、`instrumental`、`durationSec` |
| `sfx` 音效 | `text` | `durationSec`（0.5–30） |
| `upscale` **视频**高清 | `video` | `targetResolution`(1080p/2k) |
| `v2a` 视频抽音轨 | `video` | `dryVoice`(干声分离)、`transcribe`(转写比对台词，缺省开)——定嗓样本提取用，见「角色音色一致性」章 |
| `blockout` 视频转白模 | `sourceVideo` | `mode`(clay/clay_masked，缺省 clay_masked)、`keepAudio`(缺省否)——产物当 `ref2v` 的参考视频用，见「白模换角」章 |

五条会踩的边界：

- **点名了就不降级**：请求 `i2v` 却不给 `firstFrame` 得到 400，而不是悄悄按文生视频出一段
  和分镜图无关的片子（那种片子你照样付钱）。
- **素材一律用 assetId**（64 位小写 hex，来自 `canvas structure` 的 `assetIds` 或资产清单）。
  不收 URL，不收 base64，不收本地路径——本地文件先 `dj.mjs upload` 换成 assetId。
- **图片放大是 `i2i` + `params.operation:"upscale"`**；`upscale` 这个词专指视频高清。
- **`avatar` 与 `i2v` 的模型面互斥**：数字人模型只出现在 `dj models --capability avatar` 里，
  不会出现在 `i2v`/`flf2v` 的目录里（它的任务规划恒要求驱动配音，当普通图生视频用必然失败）。
- **三个「视频进」的词不通用**：`upscale` / `v2a` 处理**这段视频本身**（高清化 / 抽音轨），
  源片字段叫 `params.video`；`blockout` 是拿这段视频**当几何蓝本另出一段**，源片字段叫
  `params.sourceVideo`。字段挂错粒度直接 400（`sourceVideo` / `mode` / `keepAudio`
  只有 `blockout` 认）。

### 透明底 PNG（`params.transparentBackground`）

要贴纸、角色立绘、道具素材这类**能直接叠到别的画面上**的图，就给 `t2i` 传
`params.transparentBackground: true`，产物是带 alpha 通道的透明底 PNG。

生产实测（2026-09-23，Qwen-Image-2.1，1K）：产物 1328×1328、PNG 色彩类型 6（RGBA），
完全透明像素 28.9%、半透明 46.3%（毛发与抗锯齿边缘）、不透明 24.8%——是真透明底，
不是「有 alpha 通道但整幅不透明」。

```sh
# 先确认模型支持——这不是所有模型都有的能力
dj models --capability t2i | jq -r '
  .data.models[] | select(.image.transparentBackground == true) | .id'

# ⚠️ 传 JSON 要用 --params-json；--params 只收 key=value（写成 JSON 会直接报错）
dj generate --request-id "$(uuidgen | tr 'A-Z' 'a-z')" --model "$MODEL" \
  --capability t2i \
  --params-json '{"prompt":"一只橘猫坐着，正面全身","transparentBackground":true,"size":"1k"}'
```

三条纪律：

- **别自己往提示词里写英文 alpha 声明**。服务端会按模型注入对应措辞，你再写一遍
  属于重复，还可能和注入的句子打架。你只管把画面内容写清楚，透明底交给这个参数。
- **先查能力再传**。目录里 `image.transparentBackground` 为 `true` 的模型才真出透明底
  （目前只有 Qwen-Image-2.1）；其余模型传了会被**静默忽略**——不报错，但你拿到的是
  普通不透明图片。要是用户明确要透明底，就先按上面那条 jq 选模型，别拿默认模型硬上。
  **这个键只出现在 t2i 粒度的模型行上**：i2i 行整键缺席（透明底是生成时的事，
  编辑链路不下发这个参数），所以用 `== true` 判断，别写 `!= false`。
  ⚠️ 注意别和同一条目里的 `capabilities` 搞混：那是粗粒度能力**词数组**（`["t2i","i2i"]`），
  细粒度的图片能力在**顶层 `image`**、视频的在顶层 `video`。
- **「透明底」和「抠掉背景」是两件事**。这个参数只保证输出带 alpha 通道；画面里有什么
  由 `prompt` 决定。要把已有图的背景去掉，用 `i2i` + `params.operation:"removebg"`
  （**那条路要另外挑模型，见下一节**）。想生成一张「主体之外全透明」的贴纸，
  就在 `prompt` 里直说主体、别描述背景。

### 抠图去背景（`i2i` + `params.operation:"removebg"`）

把**已有**的一张图的背景去掉。与上一节的透明底参数是两条路：那条管「生成时带不带
alpha」，这条管「把这张图的背景抠掉」，各自按各自的能力位选模型。

```sh
# 先挑出能抠图的模型——alpha 才是透明底，matte 只是把背景涂白
MODEL=$(dj models --capability i2i | jq -r '
  .data.models[] | select(.image.removebg == "alpha") | .id' | head -1)

dj generate --request-id "$(uuidgen | tr 'A-Z' 'a-z')" --model "$MODEL" \
  --capability i2i \
  --params "{\"image\":\"$ASSET_ID\",\"operation\":\"removebg\"}"
```

两条纪律：

- **先查 `image.removebg` 再提交**。没有这一位的模型**直接 400**，不会降级——
  这和上一节的透明底参数相反，是刻意的：透明底降级后你拿到的仍是你要的那张图，
  只是不透明；抠图降级后你拿到的是一张背景被重绘过的白底图，**和抠图是两样东西，
  而你照样付钱**。取值 `"alpha"` = 透明底 PNG（自建 GPU 的 RMBG，像素级保留主体），
  `"matte"` = 只能把背景重绘成纯白。用户说「抠图」「去背景」「要透明底」时一律挑 `alpha`。
- **不用写 `prompt`**。抠图走固定工作流，指令给了也不影响结果。

### 数字人口播（`avatar`）

一段配音 + 一个形象 → 对口型的口播视频。

```sh
MODEL=$(dj models --capability avatar | jq -r '.data.models[0].id')
dj generate --request-id "$(uuidgen | tr 'A-Z' 'a-z')" --model "$MODEL" \
  --capability avatar \
  --params "firstFrame=$PORTRAIT,drivingAudio=$AUDIO,aspectRatio=9:16" \
  --canvas "$CANVAS" --node "$NODE"
```

- `params.drivingAudio`（**必填**）= 驱动配音，口型与**产出时长**都由它决定；
  **只收 wav / mp3**——按秒计价的时长由服务端从音频字节现测，探测器只认这两种容器，
  m4a/ogg 先转码（否则 400）。
- 形象来源：`params.firstFrame`（肖像图）或 `params.motionVideo`（参考动作视频）
  **至少给一个**，都不给 → 400；都给走视频驱动版（帧数由服务端按配音时长自动裁剪）。
- `durationSec` / `resolution` / `audio` 对它**无效**（时长由配音定、无清晰度档、
  产物必带配音音轨）；`aspectRatio` 只对「肖像 + 配音」这一版生效。
- 预检报价给个估计的 `durationSec`（≈ 配音秒数）即可，实扣以服务端测得的为准。

#### 专属数字人（仅管理员）

管理员在后台登记过的专属数字人（形象图 + 专属模型），出片更像本人。先取 id，再生成：

```sh
dj digital-humans --pretty
DH=$(dj digital-humans | jq -r '.data.digitalHumans[0].id')
# 模型选「数字人口播（InfiniteTalk）」——只有它挂得上专属模型，别的 avatar 模型会被拒
MODEL=$(dj models --capability avatar | jq -r '.data.models[] | select(.name | test("InfiniteTalk")) | .id' | head -n1)
dj generate --request-id "$(uuidgen | tr 'A-Z' 'a-z')" --model "$MODEL" \
  --capability avatar \
  --params "digitalHumanId=$DH,drivingAudio=$AUDIO" \
  --canvas "$CANVAS" --node "$NODE"
```

- **只支持口播**：`drivingAudio`（配音 wav/mp3）必给；不支持参考动作视频、不支持唱歌。
- **形象图不用传**：服务端从登记记录读形象图与专属模型。再给 `firstFrame` / `motionVideo` → 400
  （两者互斥）；`digitalHumanId` 挂在 `avatar` 以外的粒度 → 400。
- **仅管理员可用**：非管理员 `dj digital-humans` 恒为空列表（不是出错，如实告诉用户没有可用的，
  别拿普通肖像图冒充）；带着别处抄来的 id 提交 → 403 `upstream_rejected`；id 不存在 → 404。
- 报价与普通数字人口播相同（`durationSec` ≈ 配音秒数）。

### 配音前先挑音色

**别不传音色让上游用默认嗓子**——那等于放弃角色的声音设定。也别让用户手抄 id：

```sh
dj voices --q 温暖少女 --pretty
# 拿第一条的 voiceId
VOICE=$(dj voices --q 温暖少女 | jq -r '.data.voices[0].voiceId')
```

`kind` 决定填哪个字段，**两者不通用**：

- `kind: "system"`（平台预置）→ 填 `params.voiceId`；
- `kind: "user"`（用户自己的克隆/设计音色）→ 填 `params.voiceName`。其中
  `provider: "selfhosted"` 的就是自建 TTS（IndexTTS / VoxCPM2）的「我的音色」，`voiceId`
  形如 `v_我的声音_xxxxxx`，按入库时间倒序排在系统音色前面。
- **`provider: "gemini"` 例外，一律填 `params.voiceId`**：系统音色是小写 id（如 `kore`），
  用户设计音色以 `voice_` 开头。Gemini 音色只能配 Gemini 模型（`dj models --capability t2a`
  里挑 Gemini 的那条），配给别的模型会被拒。带 `expiresAt` 的设计音色**会到期（30 天）**，
  过期后合成失败——长剧集定嗓前先看一眼这个字段。
- Gemini 系统音色分两类：**30 个经典音色**（`language: "多语种"`，**中文配音只用它们**）和
  **2000 多个地区音色**（id 形如 `ja-jp-techagent-10`，按语种区分口音，**没有中文**）。
  地区音色排在目录最末，不带 `--q` 翻首页看不到；要外语口音就按语种圈：
  `dj voices --q 日语`、`dj voices --q ja-jp`、`dj voices --q 美式英语`。

⚠️ `voiceId` **原样回传，不要 trim**：个别系统音色 id 带尾随空格，清洗过就不命中了。
`--q` 是宽匹配（id / 名称 / 语种 / 标签任一命中），所以 `--q mandarin` 能圈出一批
普通话音色。只列得到**你自己**的用户音色，拿到别人的 id 也用不了。

自建音色来自用户的云端音色库备份：用户得**登录过网站、音色库已同步上云**才列得出来。
用户说「用我的声音」而目录里找不到时，兜底是从他画布上已有的配音卡读：
`dj node <canvasId> <nodeId> --pretty` 里的 `voiceName` 原样照填，别自己编。

### 配音情绪向量（IndexTTS 2.5）

情绪有几套**互不通用**的控制方式，按模型选一套：MiniMax 用 `emotion`；VoxCPM2 与 Gemini
这类吃自然语言的模型用 `styleText`（一句风格指令，≤100 字、不含括号，如「压低声音、语速偏慢，带点疲惫」；
Gemini 的语速也写进这句里，`emotion` 对它不生效）；IndexTTS 2.5 这类向量引擎用 `emoVector` + `emoAlpha`。

**① 挑模型**：`dj models --capability t2a --pretty` 里带「配音 情感向量 emoVector ✓」一行的才吃向量；
脚本里用 jq 筛（整块 `audio` 缺席 = 两个新参数都不吃）：

```sh
MODEL=$(dj models --capability t2a | jq -r '
  .data.models[] | select(.audio.emotionVector == true) | .id' | head -1)
# 还要用 durationFactor 控节奏的话，再加 and .audio.durationFactor == true
```

**② 挑音色**：`kind:"user"` 的条目把它的 **`voiceId` 字段值**填进 `params.voiceName`。
自建引擎（IndexTTS / VoxCPM2）的「我的音色」在 `dj voices` 里是 `provider:"selfhosted"` 的条目
（`voiceId` 形如 `v_我的声音_xxxxxx`），v1 按名字就能用。只有音色库**还没同步上云**、目录里找不到时，
才兜底从他画布上已有的配音卡读：`dj node <canvasId> <nodeId> --pretty` 里的 `voiceName`
原样照填，别自己编。名字不存在时任务失败、冻结的积分退回。

**③ 定每段的向量**：维度序固定 `[happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]`，
8 个 [0,1] 的数。从下表的预设出发（与画布【情绪】标签的内置默认值相同）：

| 预设 | emoVector |
|---|---|
| 悲伤 | `[0, 0, 0.85, 0, 0, 0.3, 0, 0]` |
| 愤怒 | `[0, 0.9, 0, 0, 0.2, 0, 0, 0]` |
| 高昂 | `[0.85, 0, 0, 0, 0, 0, 0.2, 0]` |
| 开心 | `[0.9, 0, 0, 0, 0, 0, 0, 0]` |
| 平静 | `[0, 0, 0, 0, 0, 0, 0, 0.9]` |
| 恐惧 | `[0, 0, 0, 0.85, 0, 0, 0, 0]` |
| 惊讶 | `[0, 0, 0, 0, 0, 0, 0.9, 0]` |
| 厌恶 | `[0, 0, 0, 0, 0.85, 0, 0, 0]` |
| 低落 | `[0, 0, 0.6, 0, 0, 0.7, 0, 0]` |
| 低语 | `[0, 0, 0, 0, 0, 0, 0, 0.7]` |

8 维里**没有**「坚定」「耐心」「认真」这类语气，只能用相近情绪组合近似，例如
坚定收束 ≈ 平静为主 + 少量愤怒（`[0, 0.2, 0, 0, 0, 0, 0, 0.8]`），耐心解释 ≈ 平静 + 少量开心
（`[0.2, 0, 0, 0, 0, 0, 0, 0.8]`）。这些组合是起点，不是保证——要靠试听微调，别向用户承诺听感。

- **`emoAlpha`**（[0,1]，**必须与 `emoVector` 成对**，只给其一 → 400）决定「演得多满」。
  口播建议从 **0.6–0.8** 起步；拉满容易盖过音色本身。相邻段落的情绪变化宜小，
  只在语义真正转折的那一段拉开差异——处处都变，整条听起来就不像同一个人在连续说话。
- 服务端下发前会**归一**（照上游 webui）：各维先乘衰减系数
  `[0.9375, 0.875, 1, 1, 0.9375, 0.9375, 0.6875, 0.5625]`（惊讶、平静压得最狠），
  总和超过 0.8 再等比缩到 0.8；上游随后再乘 `emoAlpha`。所以别为了「更满」把各维都拉到 1。
- 不想控情绪就**两个都不传**（模型按文本自推），别传全零向量。
- 这三个参数只认 `capability: "t2a"`；向量/强度发给不吃向量的模型、`durationFactor` 发给
  没有模型内变速的模型 → 400 `model_unsupported`（冻结积分之前，不扣费）。**发给向量模型时
  再带 `emotion` / `styleText` / `moodId` 也是 400**——向量引擎一个都不消费。
- 语速：IndexTTS 2.5 优先用 **`durationFactor`**（[0.5, 2]，>1 变慢，模型出音时就按这个节奏，
  无拉伸劣化；看目录 `audio.durationFactor` 为 true）。`speed` 是出音后的时间拉伸。
  两者**互斥**，同发 → 400。不需要控节奏就**都不传**（按模型自然语速）；要放慢收束句
  从 1.05–1.15 试起，要赶节奏从 0.9–0.95 试起，同样靠试听定。

```sh
dj generate --request-id "$RID1" --model "$MODEL" --capability t2a \
  --params-json "{\"text\":\"你居然还敢回来？\",\"voiceName\":\"$VOICE\",
    \"emoVector\":[0,0.6,0,0,0,0,0.3,0],\"emoAlpha\":0.8}"
```

`--params k=v` 写不了数组，`emoVector` 只能走 `--params-json` 或 `-f`。

**`text` 里别写【情绪】标签**。v1 把 `text` 原样交给上游朗读，服务端不解析也不剥离
【】标签——写了会被当台词念出来。

**④ 报价**：precheck 里 t2a 的 `params` 留空 `{}` 即可——配音的计费时长由服务端定，
传 `durationSec` 也会被忽略。IndexTTS 2.5 这类自建 TTS 是 `per_second` 计价，但配音请求
不带时长，冻结按缺省 10 秒、结算按冻结额——**每次调用（每一段）固定 = 单价 × 10**，与台词长短
无关。分 N 段就在 precheck 的 `items` 里放 N 项，`total` 就是实扣。

**⑤ 一段台词要换几次情绪**：v1 没有分段字段，也不在服务端拼接。**由你驱动时走这条**：
逐段各调一次 v1（同一个 `voiceName`、各段自己的 `emoVector` / `emoAlpha`，每段一个存下来的
requestId），产物下载后在本地拼接。每段是**独立计费**的任务；重新生成就是重新扣费。

产物是 **WAV**。拼接时段间插 0.3 秒静音（与站内分段合成同口径），顺序别搞错——
`download.mjs` 按 assetId 前缀命名文件，记好 `段号 → assetId` 的对应：

```sh
ffmpeg -i seg1.wav -i seg2.wav -i seg3.wav -filter_complex \
  "[0:a]aresample=48000,apad=pad_dur=0.3[a0];[1:a]aresample=48000,apad=pad_dur=0.3[a1];\
[2:a]aresample=48000[a2];[a0][a1][a2]concat=n=3:v=0:a=1" -c:a pcm_s16le full.wav
```

另一条路是让用户在**画布站内**用【情绪】标签生成（如 `【惊讶】你怎么来了？【平静】坐吧。`，
标签按上表映射成向量，站内逐段合成再拼接、同样逐段计费）——但那要用户自己在浏览器里点，
你驱动不了。

**⑥ 要不要落卡**：只要音频的话不必落卡。要落就**每段一张配音卡**（同一张卡连生三次会
变成三个版本，而不是三段）。定向落卡时卡片会回写 `emoVector` / `emoAlpha`，情绪显示「自定义向量」；
`durationFactor` 以倒数写进卡片的 `speed`。

要改卡上的情绪参数不必重新生成：`updateCard` 可写 `emoVector`（8 个 [0,1]，传 `null` 清掉）/
`emoAlpha`（[0,1]）/ `emotionSecondary`（次情绪，MiniMax 情绪词表）/ `emotionMix`（[0,1]，次情绪占比），
只在情感向量模型上生效。**联动**：写 `emoVector` 会把 `emotion` 置回「自动」；写 `emotion` 会清掉
`emoVector`；同一补丁同时给 `emotion` 和非空 `emoVector` → `invalid_field_value`。
`emotion` 传 null = 置回「自动」；`emoVector` 不能与 `emotionSecondary` / `emotionMix` 同批写（次情绪只配合预设情绪生效）→ `invalid_field_value`。
读回用 `dj node`：`emoAlpha` / `emotionSecondary` / `emotionMix` 在 `params` 里，向量在 `config.emoVector`。
卡上的值供站内重新生成使用；`dj generate` 仍只按请求体 `params` 走，不读卡上的向量。
