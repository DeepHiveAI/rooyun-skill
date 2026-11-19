# 委托画布创作助手（agent-runs）

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：要把多步的画布创作整件交给站内创作助手时（`dj agent-run`；花钱规则见纪律 1）

## 它是什么，什么时候用

一个 **run** = 把一件事委托给画布创作助手（`canvas-assistant`）：它在你指定的画布上读卡、搭卡、写提示词、出计划，
遇到要花钱的生成就**停下来等用户批准**。一轮怎么跑、计费口径与用户在网页端用创作助手完全相同。

| 场景 | 用哪个 |
|---|---|
| 从剧本搭整套画布、按分镜批量出图出片、「把这一集做出来」 | **委托**：`dj agent-run start` |
| 改一张卡、重出一张图、调一个参数、补一条连线 | **原子命令**：`dj ops` / `dj generate`——更快更省 |
| 只要文字产出（改稿、A/B 双稿） | **会话**：`dj chat`（纪律 13；会话不能落卡、不能生成） |

所需 scope：起 run / 插话 / 批准 / 拒绝会让助手起一轮读写画布，需 `llm` + `projects:read` + `canvas:write`；
查询 / 取消只需 `llm`（只带 `llm` 的令牌查询时待批项全部不可批准、也不会顺带注入排队插话）；批准**花钱**的项另需 `generate`。

额度与归属：

- 委托助手每轮的**模型费也计入发起该轮的令牌**的总上限 / 日上限（与生成费合并判定，在途的轮按每轮上限预留）；放不下本轮上限就 402，不起轮、不扣费。
  `dj whoami` 看到的令牌已用**不含**这部分模型费，余量以起轮时的判定为准。
- 每个令牌每天（北京时间）最多新建 30 个 run、同时在跑最多 3 个 → 429 `agent_run_limit_exceeded`。
- run 归属**账号**而不是令牌：同一账号的其他令牌（具备上述 scope）也能查询、插话、批准、取消它；每一轮的花费计到发起那一轮的令牌上。
- 支持交互界面的 MCP 宿主会在 `get_agent_run` 上渲染审批卡，让用户亲手点批准 / 拒绝；命令行里没有界面，服务端也无法分辨是不是用户本人在批，
  所以 `approve` 前**必须**把描述与价格原样告诉用户、拿到逐项明确答复。

## 命令一览

```sh
dj() { node "$SKILL/scripts/dj.mjs" "$@"; }

# 起 run：不带 --yes 只报价首轮模型费上限；--yes 时 dj 自动先报价拿凭证再委托，幂等键缺省现取一个
dj agent-run start <canvasId> "<要助手做的事>" [--auto-generate] [--yes] [--request-id <uuid>] [--wait]

# 查：--wait 按 pollAfterMs 轮询，停在 awaiting_approval 或终态（awaiting_approval / completed 退出码 0，failed / cancelled 退出码 7）
dj agent-run get <runId> [--wait] [--timeout <秒>] [--pretty]

# 批准（必须显式 --quote-id，用户本人确认后）/ 拒绝（免费）
dj agent-run approve <runId> <actionId> --quote-id <quoteId> [--note "…"]
dj agent-run reject  <runId> <actionId> [--note "原因"]

# 插话（起一轮扣模型费，默认只报价）/ 软取消
dj agent-run steer  <runId> "<补充要求>" [--auto-generate] [--request-id <幂等键>] [--yes] [--wait]
dj agent-run cancel <runId>
```

## run 视图（`agent-run get` 的 `data`）

| 字段 | 说明 |
|---|---|
| `status` | `queued` / `running` / `awaiting_approval` / `completed` / `failed` / `cancelled` |
| `finishing` | 已取消、但在跑的那一轮尚未结束时为 `true` |
| `autoGenerate` | `false` = 只出计划（缺省）；`true` = 允许生成（仍逐项批准） |
| `turns` | 已起的轮数 |
| `reply` | 助手最近一轮对外可见的回复文字 |
| `recentSteps[]` | 最近一轮的工具步骤 `{tool, state}` |
| `pendingActions[]` | 待批项（下表） |
| `steerQueued` | 排队等本轮结束后注入的插话条数 |
| `spentCredits` | `{total, generation, conversation}`：本 run 累计实扣 |
| `lastError` | 最近一次失败说明 |
| `pollAfterMs` | 建议查询间隔；终态为 `null` |

待批项 `pendingActions[i]`：

| 字段 | 说明 |
|---|---|
| `actionId` | 批准 / 拒绝时用 |
| `type` | `spend`（花钱的生成）/ `plan`（执行计划）/ `memory`（记住偏好）/ `canvas_changes`（破坏性改画布）/ `external_content`（引入外部内容）/ `confirm` |
| `description` / `title` / `items[]` | 给用户看的说明；计划卡带步骤，`items[].costly` 标出花钱的步骤 |
| `credits` | 动作本身的报价（免费确认项 = 0；`null` = 读不出，不能批准） |
| `turnCredits` | 批准后续跑一轮的模型费上限 |
| `quoteId` / `quoteExpiresAt` | 批准用的报价凭证（积分 = credits + turnCredits，15 分钟有效）；不可批准时缺席 |
| `decided` | 已做出、尚未生效的决定（同批全部答完才提交） |
| `approvable` / `blockedReason` | 能否批准；不能时给原因（只出计划 / 令牌缺 `generate` / 报价读不出） |

## 审批：一项一项问用户

1. `get --wait` 停在 `awaiting_approval` → 把**每一项**的 `description` 与报价（`credits` + `turnCredits`）原样告诉用户；
2. 用户本人说「批准这一项」→ `approve <runId> <actionId> --quote-id <该项的 quoteId>`；不要的 → `reject`（`--note` 交给助手）；
3. 同一批全部答完，助手自动继续 → 回到第 1 步。

- `quoteId` **只在查询里签**（批准 / 插话 / 取消的回执都不带）。过期 410 `quote_expired`、用过 409 `quote_used` → 重新 `get` 拿新的；
  价格变了必须重新征得同意。凭证积分低于当前报价 → 409 `quote_mismatch`。
- 免费确认项（计划、记忆、破坏性改画布）也要带 `quoteId`（积分只含续跑一轮的模型费），同样先告诉用户。
- **用户事先说「全部批准」「你看着办」也不能替他逐项批准花钱项**（纪律 1）；dj 也不会自动替用户取凭证批准。
- 执行时服务端会再核一次价：价格涨了不扣费、重新出待批项。

## 只出计划 vs 允许生成

- `start` 缺省 `autoGenerate:false`：助手只出计划、搭卡、写提示词，花钱项一律批不了（409 `agent_run_plan_only`）。
- 用户明确要生成：`start --auto-generate`，或对已有 run `steer <runId> --auto-generate "可以开始生成了" --yes` 升级（**只升不降**）。
  升级前先征得用户同意——这是「愿不愿意花钱」的决定，不是创作决定。

## 插话（steer）

- 助手**空闲**（`awaiting_approval` / `completed` / `failed`）→ 立即起一轮，并**作废尚未处理的待批项**（未提交、未扣费）；
- 助手**在跑** → 进队列（最多 5 条），本轮结束后由下一次 `get` 注入——所以插话后要接着 `get --wait`；
- 已取消，或 run 遇到永久性失败（跑满轮数 / 画布已删除 / 助手对该账号不可用，`status: failed`，原因见 `lastError`）→ 409 `agent_run_state`，要继续就新开一个 run；
- 起一轮扣模型费：不带 `--yes` 只报价，确认后 `--yes`；
- 幂等：`--request-id`（≤128 字，缺省 dj 现取一个并打印）——网络中断重试时原样带上，同一句不会重复入队 / 注入（回执 `meta.replayed: true`）；
- **插话报错（4xx / 5xx）= 这句没有被注入**，可以用同一个 `--request-id` 重试。

## 取消（cancel）

软取消：在跑的一轮跑完即止（视图带 `finishing: true`），之后不再起轮；未批准的花钱项永不执行。
**已批准并提交的生成照常完成、按实结算**——要中止它们，对相应任务 `dj cancel <taskId>`。重复取消幂等。

## 错误码

| 码 | HTTP | 处置 |
|---|---|---|
| `agent_run_state` | 409 | 状态不受理（在跑时批准、actionId 过期、已取消后插话、插话队列满）→ 先 `get` 看最新状态再决定 |
| `agent_run_plan_only` | 409 | 只出计划的 run 批准花钱项 → 问用户；同意就 `steer --auto-generate` 升级，否则 reject |
| `agent_run_unavailable` | 403 | 创作助手对这个账号暂不可用 → 如实告诉用户，改用原子命令 |
| `quote_expired` / `quote_used` / `quote_mismatch` | 410 / 409 / 409 | 重新 `get` 拿新 `quoteId`，价格变了重新确认 |
| `insufficient_scope` | 403 | 起 run / 插话 / 批准 / 拒绝需要 `llm` + `projects:read` + `canvas:write`（`meta.requiredScopes` 列出缺的）；批准花钱项另需 `generate` → 请用户重建带这些权限的令牌 |
| `token_limit_exceeded` / `token_daily_limit_exceeded` | 402 | 委托 run 的模型费与批准后的生成费都记进**发起该请求的令牌**的总上限 / 日上限；放不下本轮就不起轮（未扣费），原因也会出现在 `get` 的 `lastError` → 告诉用户调高令牌额度、换令牌或明天再试（充值不解决）|
| `agent_run_limit_exceeded` | 429 | 令牌的委托 run 数量到上限：`meta.kind=daily_runs`（今天新建满 30 个）→ 在已有 run 上插话或明天再开；`active_runs`（同时在跑满 3 个）→ 等其中一个这一轮跑完。别换令牌绕过 |

## 轮询

按 `pollAfterMs`：`queued` 约 2 秒、`running` 约 3 秒、`awaiting_approval` 约 10 秒（在等人）；终态为 `null`，停止。
`dj agent-run get --wait` 已按这个节奏退避，超时（退出码 6）不代表失败，用同一条命令续查。
