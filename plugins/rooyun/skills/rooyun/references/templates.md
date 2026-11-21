# 用模板出片（templates / template-runs）

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：用户要「拿我的素材套平台模板出一条」、或问有哪些现成模板时（`dj templates` / `dj template-run`；花钱规则见纪律 1）

## 它是什么，什么时候用

平台把调好的工作流画布发布成**模板**：一张画布 + 对外声明的输入（商品图、卖点文字、时长、画幅……）与输出。
你只填输入，服务端在本账号下复制一张**隐藏画布**、把输入填进对应卡片、按依赖分波执行，跑完给成片的 assetId。

| 场景 | 用哪个 |
|---|---|
| 固定套路的成片：「用这个带货模板给我的商品出一条」 | **模板**：`dj template-run` |
| 自己设计结构、逐卡调提示词 | 原子命令（ops + generate）或委托创作助手（`dj agent-run`） |

所需 scope：看模板 `templates:read`；报价 / 建作业 / 取消 / 转正 / Webhook 密钥 `generate`；查作业 `tasks:read`；下载产物 `assets:read`；上传素材 `assets:write`。
手工建的令牌可能缺 `templates:read`——撞 403 `insufficient_scope` 就请用户去 `/profile#api` 重建令牌勾上。

**灰度**：按模板执行按账号逐步开放。报价 / 建作业返回 403 `template_runs_disabled` = 这个账号还没开放，令牌没问题、重建也没用，如实告诉用户；
看模板、查 / 取消已有作业不受影响。

## 端到端

```sh
dj() { node "$SKILL/scripts/dj.mjs" "$@"; }

# ① 本地素材先上传拿 assetId
dj upload ./product.png                       # → data.assetId

# ② 挑模板、看输入（免费）
dj templates list --featured --pretty
dj templates get <templateId> --pretty         # inputs：key / 类型 / 必填 / 可选值 / 示例

# ③ 报价（不扣费）：把 credits 原样告诉用户、记下 quoteId（15 分钟有效），等明确确认
dj template-run precheck <templateId> \
  --input product=<assetId> --input selling_point="一按即开，单手就能用" --input duration:=10 --pretty

# ④ 用户确认后提交：requestId 自己生成并记下来（dj 不自动生成）
RID=$(dj uuid)
dj template-run create <templateId> \
  --input product=<assetId> --input selling_point="一按即开，单手就能用" --input duration:=10 \
  --yes --request-id "$RID" --quote-id <③的 quoteId> --wait --pretty
#   --yes 必须带 --quote-id：dj 不会替你重新报价再提交（用户确认的是③那次的金额）；输入与③一致。
#   网络中断重试用同一个 $RID（不会重复扣费）

# ⑤ 取件（outputs[].assetId / film.assetId）
node "$SKILL/scripts/download.mjs" --ids <assetId1>,<assetId2>

# ⑥ 用户想在浏览器里接着改：转正隐藏画布（作业结束后才行）
dj template-run open-canvas <runId>            # → canvasUrl，按纪律 6 汇报给用户
```

## 输入怎么写

| 输入类型 | 填什么 | dj 写法 |
|---|---|---|
| `image` / `video` / `audio` | 素材 assetId（64 位 hex，必须是你名下的、媒体类型一致） | `--input key=<assetId>` |
| `text` | 文字（≤4000 字） | `--input key="文字"`，长文本 `--input key=@文件.txt` |
| `option` | 详情里 `option.choices` 的某个值：`durationSec` 是**数字**、`aspectRatio` 是字符串 | `--input duration:=10`、`--input aspect=9:16` |

- 可选输入不给时用模板自带的内容；必填的不给 → 422 `template_input_invalid`（`meta.issues` 逐条列出 key / code / message）。
- 也可以 `--inputs-json '{"product":"…","duration":10}'` 或 `-f body.json`（`{templateId, version?, inputs}`）；`--input` 逐个覆盖前两者。
- `--version N` 锁定版本：作者发了新版 → 409 `template_version_superseded`（`meta.currentVersion`），重读详情、按新版重新报价确认。

## 报价、花费与上限

- 报价 `credits` = 整单预算上限：执行中逐步提交生成、逐步结算，累计不超过它；`balance` 是当前可用积分（计费未开启时为 null）。
- 详情里的 `estimatedCredits` 只是作者发布时的预估，**报给用户的一律用 precheck 的数**。
- 提交时余额按「可用 − 你其他在跑作业的剩余预算」判（不够 402 `insufficient_credits`）；令牌总额度 / 今日额度放不下整单 → 402 `token_limit_exceeded` / `token_daily_limit_exceeded`（处置相反，见 errors.md）。
- 数量上限：账号同时在跑 3 个、每令牌同时在跑 3 个、每令牌每天新建 50 个 → 429 `template_run_limit_exceeded`（`meta.kind` 区分）。别换令牌绕过。
- 凭证一次性：建作业成功后同一 `quoteId` 再用 → 409 `quote_used`；要再出一条就重新报价、换新的 requestId。
- 凭证绑定报价当时的**模板版本**：报价后作者发了新版，提交 → 409 `quote_mismatch`，重读详情、重新报价确认。
- 网络中断原样重发（同一 requestId）返回原作业（`meta.replayed`），即使模板之后发了新版或下架也一样，不会再扣费。
- 建作业中途失败（错误里带 `meta.runId`）：那条作业已记为失败、没扣费；**换一个新的 requestId** 重新报价提交（同一 requestId 只会拿回那条失败作业）。

## 作业视图（`dj template-run get <runId>`）

- `status`：`queued` / `running` / `succeeded` / `failed` / `canceled`（后三个是终态）；`--wait` 轮询到终态（成功退出码 0，失败 / 取消 7）。
- `steps[]`：每一步 `{index, wave, kind, status, attempts, error?}`，同一 `wave` 并行；失败的步骤会自动重试。
- `outputs[]`：`{key, kind, assetId, downloadPath}`；`film`：模板会合成成片时的那一条。视图**不给签名地址**，取件走下载端点（计入下载配额）。
- `credits`：`quoted` 报价 / `spent` 已占用（含在途预占）/ `charged` 实扣 / `released` 结清后退回 / `settling` 还在结算（实扣是暂估，稍后再 get）。
- `canvasUrl`：`--keep-canvas` 成功后自动转正时出现；否则用 `open-canvas` 拿。
- 丢了 runId：`dj template-run list` 列最近 20 个（含站内建的）。别重新提交——那是再付一次钱。

取消：`dj template-run cancel <runId>`——没提交的步骤不再提交，**已提交的生成照常跑完、照常结算**；已结束 → 409 `template_run_state`。

## 调用自己的工作流

先在画布上把画布**发布成工作流**（发布给自己用免审核；公开到模板库要审核），再用自己的令牌调用：

```bash
dj templates list --mine --pretty          # 自己发布的工作流：可见性（私有 / 公开）、当前版本号、公开版本号
dj templates get <templateId> --pretty     # 自己的私有工作流也能看：当前版本的输入 / 输出（示例给素材编号）
# 报价、提交、查询与公开模板完全一样；执行的是你最新发布的版本（不必等审核）
dj template-run list --template <templateId> --pretty   # 只看这个模板的作业（旧版本上的也在）
```

- 私有工作流只有你（同账号的令牌）看得到、能执行；别人的私有工作流与不存在一律 404，响应相同。
- 计费照旧：谁调用谁付，令牌额度、并发上限、报价凭证、requestId 幂等都一样。

## 多段成片：合成、失败后继续

- **合成**：输出全是视频且多于一段时可以合成一条成片。`--compose on|off` 覆盖模板的设定（缺省按模板）；`--segment-order k1,k2,…` 调本次的分段顺序（输出 key 的完整排列，只作用于这一次）。输出里有非视频时合成被忽略，视图 `compose.ignored` 说明原因。
- 视图里 `film` 是成片，`segments[]` 按顺序列出每一段（带状态；失败 / 取消的作业也列出已完成的段）。
- **合成没成功**（`compose.canRetry=true`）：`dj template-run compose <runId>` 单独重试合成，不重跑分段、不另收生成费。
- **失败 / 取消后继续**（`resume.canResume=true`，最多 3 次）：在同一个画布副本上接着做完，已完成的段**不重新提交、不重复扣费**。

```bash
# ① 报价（只算剩下的部分，不扣费）：把「已完成 kept 段，继续需要约 credits 积分」告诉用户，等明确确认
dj template-run retry <runId> --pretty
# ② 确认后继续：requestId 新生成一个（不能用建作业时那个），quoteId 用 ① 的
dj template-run retry <runId> --yes --request-id "$(dj uuid)" --quote-id <①的 quoteId> --wait --pretty
```

继续前会重新校验余额、令牌额度、提示词与素材，不过就拒绝并说明、作业不变。**只能用建作业的那枚令牌继续**（站内建的、别的令牌建的都是 404）。
已经生成好（已扣费）正在落回画布的、在画布副本里手动补好的卡不会重跑，报价里会点名。
`credits.quoted` 是建作业时的报价，`credits.quotedTotal` 是累计（建作业 + 每次继续），`credits.lastResumeQuoted` 是最近一次继续的报价。
用户当初选了只要分段（`compose.canCompose=true`）也能事后 `dj template-run compose <runId>` 合成一条。

## Webhook（可选，替代轮询）

1. `dj webhook-secret --yes` 为当前令牌生成签名密钥（`whsec_…`）。**明文只显示这一次**，让用户自己存进接收方配置，别写进日志、终端记录或仓库；再调一次 = 轮换，旧密钥立即作废。
2. 提交时加 `--webhook-url https://…`：只收 **443 端口的 https 公网地址**（内网 / 本机 / 平台自己的域名都拒）。没生成密钥就带 → 409 `webhook_secret_missing`。**别把密钥或令牌放进地址的查询串**：同账号下的其他令牌能查看、取消、重投这个账号的作业，也看得到回调地址。
3. 作业到终态时平台 POST `template_run.finished` 事件：`{id, type, createdAt, data:{runId, status, outputs:[{key,kind,assetId}], filmAssetId?, credits:{quoted,charged,settled}, error?, finishedAt}}`。
4. 接收方验签：头 `X-Webhook-Signature: t=<unix秒>,v1=<hex>`，`hex = HMAC-SHA256(secret, "<t>.<请求体原文>")`；用原始字节重算、常数时间比较、拒绝 300 秒外的时间戳；**按事件 id 去重**（重试与手动重投复用同一个 id）。
5. 作业结束后事件先入队，由平台后台任务投递（通常几分钟内到；取消会立刻尝试一次）。回 2xx 算送达；失败最多共投 6 次（30 秒起指数退避、封顶 1 小时），`webhook.lastError` 只给粗粒度原因（「地址不被允许」/「对方未成功响应」）。调试时 `dj template-run webhook-redeliver <runId>` 立刻重投一次（6 次/分）。

Node / Python 验签示例与完整字段见 docs/API_V1.md §5.16（或 `GET /api/v1/openapi.json` 里 `createTemplateRun` 的 callbacks）。

## 错误码速查

| 码 | 处置 |
|---|---|
| `template_runs_disabled` (403) | 账号还没开放按模板执行；如实告诉用户，别重建令牌 |
| `template_version_superseded` (409) | 重读详情，按当前版本重新报价确认 |
| `template_input_invalid` (422) | 按 `meta.issues` 逐条改输入，再重新报价 |
| `template_not_runnable` (422) | 模板本身的问题（`meta.reason`），换模板 |
| `template_run_limit_exceeded` (429) | 等在跑的结束 / 明天再来 |
| `template_run_state` (409) | 先 get 看状态再操作 |
| `webhook_secret_missing` (409) | 先 `dj webhook-secret --yes`，或去掉 `--webhook-url` |
| `request_id_conflict` (409) | 网络重试参数要原样；新提交换新 uuid |

以上全部**未执行、未扣费**。
