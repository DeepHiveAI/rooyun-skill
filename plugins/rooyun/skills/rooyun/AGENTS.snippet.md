<!--
  rooyun-skill-version: 1.42.0

  把下面 `## RooYun 开放 API` 整段粘进你项目的 AGENTS.md（Codex）或等价的长期指令文件，
  并把 rooyun-skill/scripts/ 放到 Agent 能执行到的位置（零依赖，Node ≥ 18）。
  完整版说明见同目录 SKILL.md；本文件是它的等价压缩版。
  1.23.0 起 SKILL.md 只留常驻部分，细节分在同目录 references/*.md（主文件末尾有索引表）。
  references 只随整包分发、没有单文件端点，所以只拷 scripts/ 的布局要拿到它们，
  得下整包：curl <base>/api/skill/bundle

  更新：粘进去的是快照，不会自己变。`node <你放脚本的位置>/dj.mjs version` 会告诉你
  线上是哪一版；落后了就重新下载分发包（curl <base>/api/skill/bundle）并重新粘一遍本段。
  版本号由 pnpm skill:generate 从 SKILL.md 同步，勿手改。
-->

## RooYun 开放 API

RooYun（<https://www.rooyun.com>）是「无限画布 + AI Agent」的短剧创作工作台。
用户提到 **RooYun / rooyun / 生成分镜 / 把剧本做成视频工程 / 下载 RooYun 产物** 时，
用 `scripts/dj.mjs` 与 `scripts/download.mjs` 驱动它的 v1 开放 API。

**产出不是一堆文件，是一张用户可以接着手工编辑的画布。**

### 配置：登录一次，之后自动可用

```sh
node scripts/dj.mjs login   # ① 申请授权码并打开浏览器，立即返回；把 verificationUrl 转给用户点「授权」
node scripts/dj.mjs login   # ② 再跑一次：等待授权（最多 90s），令牌自动保存到 ~/.rooyun/credentials.json
```

退出码 6 = 用户还没点，提醒后再跑一次；退出码 2 = 授权码已过期/已用，从 ① 重来。
保存后所有会话、所有命令自动带令牌，不需要环境变量（`ROOYUN_API_TOKEN` 仍支持且优先；
`ROOYUN_API_BASE` 可选，默认 `https://www.rooyun.com`；旧名 `DUANJU_*` 仍可用）。

开工第一件事永远是 `node scripts/dj.mjs me`——确认令牌有效、scope 够用、限额余量；报「尚未登录」就走上面两步。

### 工作流纪律（硬规则，不可自行放宽）

1. **任何 `generate` 之前必须先 `precheck` 报价，把预计积分消耗展示给用户并等确认。**
   没有例外——用户说「你看着办」只覆盖创作决策，不覆盖花钱额度。
   `precheck` 对未配价模型也返回 200，必须逐项看 `items[].priced` 与整批 `ok`。
   需求变大（加镜头 / 换贵模型 / 加时长）→ 重新报价、重新确认。
   `precheck -f` 形状：`{"items":[{"model":"…","capability":"t2i","params":{"size":"2k"}}]}`
   （params 只认 `durationSec`/`resolution`/`size`/`targetResolution` 四个影响价格的键）。
   响应自带 `balance`，**报价不需要 `billing:read`**。
   **链式生成要报两次价**：`t2i → i2v` 的第二段 `firstFrame` 要等第一段产物，没法合并预检——
   一开始就告诉用户「这活儿分两步、会报两次价」。
2. **优先在自己创建的画布上工作**（`projects create`）。要写用户既有画布，先告知并发编辑
   风险（他若有未同步的改动，写入后会先出横幅要他裁决），得到同意后**直接写，别带
   `--if-version`**（不带才会在版本被推进时自动重读重放，带上一撞就 409）。写完**不必叫他刷新**：他开着
   那张画布的话，15–25 秒内自动出现；本地有未同步改动时会出一条非模态横幅提示他处理。
   只有你**新建**了画布才需要提醒刷新（切换器里不会自己冒出来）。
3. **令牌只由脚本自己读**（环境变量 `ROOYUN_API_TOKEN` 或 `dj login` 写的 `~/.rooyun/credentials.json`），
   你不 `cat` 凭据文件、不 `echo $ROOYUN_API_TOKEN`、不把令牌写进任何文件/代码/日志/报告，
   不在 curl 里内联明文。下载的 302 签名地址同理（60 秒内谁拿到谁能下）：不打印、不转发、不写日志。
   用户若在对话里贴了明文令牌，告诉他这枚已泄漏、请立刻吊销，然后 `dj.mjs login --force` 重新授权。
4. **批量生成必须用幂等键**：`requestId` 每个逻辑任务生成一次（`dj.mjs uuid`）并**存下来**，
   失败重试**复用同一个键**（换新 uuid = 重复扣费）。**幂等键只认键不认参数**：同键换 prompt
   重发会原样返回第一次那个任务（首次参数生效），所以「改词重生成」必须用新 requestId、
   也会付两次钱。提交限流 10/分/令牌、20/分/账号，正确姿势是「整批预检 → 逐条提交 → 轮询」。
   **那张本地表丢了别重发**：`dj tasks` 把现场捞回来（缺省只列在途，可 `--canvas` / `--request`
   过滤；它不轮询上游，捞回 taskId 后拿准确状态仍用 `dj task <id>`）。
5. **轮询遵守建议间隔**：用 `dj.mjs task <id> --watch`（已按服务端 `pollAfterMs` 配退避，
   封顶 15s，默认等 1800s 后退出码 6 = 仍在跑而非失败）。不要自写 while 循环高频打。
   视频分钟级、图片音频十几秒到两分钟。
6. **搭建完成后汇报画布链接**（用响应里的 `url` 字段拼，别自己拼路径）并提示用户
   打开浏览器接力编辑。人机在同一张画布上接力是这个产品的核心价值。
7. **下载后核对完整性元信息**：`download.mjs` 会打印 `referenced / cloud_available / missing`。
   API 可见 = 云端已同步子集。缺失项如实报告（`not_synced` = 请用户在原设备打开画布同步或导出），
   不要用「下载成功 N 个」掩盖「其实引用了 M 个」；`unreadable_canvases` 意味着
   「不知道缺了多少」而不是「没有缺失」。
8. **分析端点返回的是结构化数据，改完用 ops 回写，别重新提取**。重跑一次分析既要用户
   再付一次钱，又会冲掉他刚做的修改。链路固定为「拿到结构 → 和用户过一遍改掉不对的 →
   `ops` 写进画布 → 之后要改就 `dj node` 读回那张卡、用 `updateCard` 改字段」。
   `dj storyboard` 的结果用 `createStoryboard kind:"video"` 落分镜视频卡（分镜表卡已下线；
   分镜视频卡只能由它派生，见纪律 10）。
   **计费分叉读 `meta.billingUnit`**：`extract`/`storyboard`/`rewrite` 是 `per_round`
   （扣积分，一次调用算一轮，与输出长度无关）；`caption` 扣积分（图片 `per_call` 0.1/次、
   视频 `per_second` 0.1/秒，调用前报价）；`inspect` 是 `free`（不扣积分，但仍受 `llm` scope 与限流约束）。
   视觉端点素材一律先 `dj upload` 换 assetId（不收 dataURL/URL/路径，单张 ≤1.4MB
   且服务端不降采样，视频要你自己抽帧）。质检里 `checks` 没有的维度 = 缺基准**没判**
   而非通过，`meta.mock=true` 是演示产物没有信息量——两者都别当结论转述。
9. **需要人工介入的步骤，签发编辑链接交给用户，说明有效期，然后去做别的事。**
   局部重绘要重画画面的哪一块，用文字描述永远是猜——`dj edit-session create <canvasId>
   <nodeId>` 签一条免登录链接（源图由服务端从卡上读，所以 **nodeId 必须已经出过图**），
   把 `url` 和 **`expiresAt`（默认 15 分钟）一起**转述给用户。
   **不要阻塞轮询死等**：签完就去做别的事，下一轮再 `dj edit-session status <sessionId>`。
   查到 `submitted` 就用 `result.maskAssetId`（蒙版）+ `result.instruction`（用户写的要求）
   发起局部重绘（`t2i` + `--reference <源图>` + `params.mask`）——那是**新的花钱决策，
   回到纪律 1 先报价**。`expired`/`revoked` 说明链接废了：重签一条并告诉用户上一条已失效。
   **链接等同凭据**（免登录、谁拿到谁能编辑那张卡）：只转述给用户本人，不写进文件与日志。
10. **按依赖顺序搭画布：剧本 → 角色/场景/道具 → 分镜视频卡 → 定嗓 → 生成；分镜视频卡只能由
    `createStoryboard` 派生。顺序是硬规则，用户说「直接出视频」也要先把前面几步补齐。**
    ① `createCard(kind=text)` 先把剧本落成文本卡（后续提取都以它为源；只有一句创意就先把
    剧本写出来）；② `dj extract characters/scenes/props` 提取后用 `createCharacterBoard` /
    `createSceneSet` / `createPropBoard` 落卡，**然后逐板出图**（提示词 `dj node` 读回卡上编译好的
    那份；分镜视频引用的是设定板的**产物**，板没出图 = 参考为空）——第一次报价；
    ③ 再 `dj storyboard` 拆分镜（整集一次），把上一步的名字作 `--cast` / `--scenes` 传回去，
    并把每个角色的 `shotInjection` 映射成 `[{name,anchor}]` 用 `--anchors` 传入；
    ④ **优先用 `dj storyboard-fall <canvasId> -f <storyboard响应.json> --script <剧本卡id>`**（按场次切批、
    空场景名兜底、超 30 段自动拆批全在命令里；自己拼批次写错的表现是静默断链）。
    它等价于**每场一批 `createStoryboard kind:"video"`**，params 带 `sceneName` + `layout:"grouped"`，
    `shots` 逐段取该场 `segments[]` 的 `{title, videoPrompt→prompt, durationSec, audio, cast, props}`
    原样传回——落出来才是站内「提取分镜」同款（本场参考进引用坞、视频卡排网格、整块成组）。
    **禁止 `createCard kind:"video"` 建分镜视频卡**（不连参考、不进坞、不成组）、禁止逐镜落卡、
    禁止自拼 prompt；op 结果 `noop` 点名的名字 = 没有设定板，回 ② 补建；
    ⑤ 有台词的角色先 `dj character-voices` 定嗓；⑥ 出视频前**先跑 `dj canvas lint <canvasId>`**
    （MCP：`lint_canvas`；只读、不扣积分）：**有 error 级 finding 不许提交生成**，按 message
    补连线 / 补建设定板 / 先把设定板生成出来，`summary.errors` 归零（有 error 退出码 2，可写成
    `dj canvas lint "$CANVAS" || exit 1`）；再 `dj canvas structure` 核每张视频卡上游是本场引用坞
    （hub 卡的 `members` 就是它引用的设定板），生成走 `ref2v` 且**不必给 `--reference`**——带上
    `--canvas` + `--node` 后服务端按画布边自动解析参考，回执 `meta.resolvedReferences` 回显每一张
    的来源，**逐条核对**，对不上先改边再生成；prompt 用 `dj node` 读回。
    **`<Picture i>` 的编号不要猜**——`dj canvas lint` 的响应里就有 `references` 预演
    （每张视频卡逐条给出 `index` / `tag` / `label`，顺序与提交时逐位一致），照抄即可；
    带 `--canvas` + `--node` 时服务端还会自动补台词段与【限制】段（回执
    `meta.promptCompile.applied` 如实回显补了哪几段），要逐字可控就传
    `--params-json '{"promptCompile":"off", …}'`——第二次报价；
    没有任何参考连线的视频卡不要生成（解析为空时服务端照常报「缺参考」）。
    跳步的后果是**静默**的：卡都在、生成也成功，只是人物每镜换脸、场景每镜重造，
    而卡面上看不出任何异常。已经建错了就用 `connectCards` 补边、缺板的补建并出图，
    **不要删了重来**（会丢已生成的产物）。用户说「只要剧本先别建东西」时，
    只调 `dj extract` / `dj storyboard`（它们默认不落卡）把结构给他看。
11. **每次生成前复查提示词。**
    角色定妆照**不要自拟提示词**：`createCharacterBoard` 落卡时平台已编译好一份
    （单主体/中性表情/干净影棚/三视图/禁文字），用 `dj node <canvasId> <nodeId>` 读回
    `data.body` 原样提交；自拟会把这些约束整体旁路，而它是后面所有镜头的参考基准。
    视频提示词就是分镜视频卡上的 `prompt`（`createStoryboard kind:"video"` 落卡时来自
    `segments[].videoPrompt`，含硬切指令与时间码，**对白在「音轨：」行内一字不丢**）：
    生成前 `dj node` 读回原样提交，自拼最常见的后果就是整片没有对白。
    提交前核三件事：① 提示词里的角色/场景名与卡上的名字逐字一致；② 声明的角色/场景/道具
    都已连上参考图；③ 有对白的镜头对白确实在提示词里。**不要留「她」「那个男人」这类代称**
    ——跨镜生成里它指代不到任何人。发现问题先 `updateCard` 改回卡上再生成，
    只在本次请求里临时改的话，用户看到的和下次重新生成用的还是错的那版。
12. **视频默认走 Seedance 2.0 Fast 720p；余额不够或调用失败时，把「换 MiniMax H3」和「充值」
    两条路摆给用户选。** `i2v`/`flf2v`/`ref2v` 用户没点名模型时，一律用 `dj models` 里名字以
    「Seedance 2.0 Fast」开头的那一行（现取 id，别硬编 uuid），且 `precheck` 与 `generate` 的
    params **都显式带 `resolution:"720p"`**（它默认档 480p，不给就按 480p 出片计价）。
    用户点名了就按用户的。三种跑不动——`precheck` `ok=false` 且各项 `priced=true`（可用 < 合计，
    常见于只有赠送积分）、402 `insufficient_credits`、任务终态 `failed` / `upstream_rejected`——
    **不要自行换模型、不要换 requestId 盲重试**，固定话术：「A. 换 MiniMax H3（名字以
    「MiniMax H3 ·」开头的对应能力行，更便宜、赠送积分可用，我重新报价）/ B. 去网页端充值」，
    等用户选。`token_limit_exceeded` 不在此列（换模型、充值都没用）。
13. **多轮 Agent 会话：会话 id 是状态、一个 Agent 一个会话、每轮先按目录报价、跑不动不换 Agent。**
    历史与系统提示词全在服务端，你只持有 `conversationId`：每轮只发新的一句话，不要把上一轮的
    稿子再贴一遍；本地记「任务 → `conversationId`」表，丢了用 `dj chats` 捞回来，别新建会话重说。
    `agentId` 创建时定死、**中途不可换**（换 Agent = 新会话；多 Agent 并行 = 多会话并行）。
    每轮都扣钱：报价**直接读** `dj chat new` / `dj chat show` 回执的 `meta.estimatedTurnCredits`
    （= `stagesPerTurn` × 该 `modelId` 的 `per_round` 单价，服务端已乘好），先报给用户等确认再
    `dj chat send`（纪律 1）。该值为 `null` = **该模型未配价、发轮会被 503 拒**（不是免费），
    换模型或找管理员补价；`requestId` 必填、重试复用同键（纪律 4）。
    409 `conversation_busy` = 上一轮或网页端还在写，按 `meta.retryAfterSeconds` 退避后**原样重发
    同一个 requestId**，别换会话。402 `insufficient_credits` 摆「换 `modelId`（同一会话可换）/ 充值」
    两条路等用户选，**不要换 Agent、不要自行降级**。稿件正文只从 `artifacts[]` 取，选稿用
    下一轮的 `references`，别让用户把稿子贴回来。会话级默认参数（`chat new --params-json`）
    **落库并对之后每轮生效**，发轮的 `params` 在其上逐键覆盖——整段不变的设定说一次就够。
    `dj chat delete` 是**硬删**（连消息、不可撤销、网页端也没了、不退款不动账本）：
    删前必须跟用户确认，别为了「重新开始」删掉还在用的会话。

14. **图片默认走 Qwen-Image-2.1 · GPU；固定 0.05 积分/张，画质与档位都不改价**——`t2i`/`i2i`
    都用目录里名字以「Qwen-Image-2.1」开头的那一行（现取 id，别硬编 uuid；同名两行，
    按 capability 各取各的）。1K 与 2K 同价、三个画质档同价，**别为了省钱劝用户降档**。
    档位只有 `1k`/`2k`（**没有 4K**，传了回退默认档 `2k`；不带 `size` 就是 `2k`）。
    `quality` **可以传且是真参数**（GPU 通道映射采样步数：low = 文生图 15 / 编辑 18，
    不传 = 25，high = 35，不加价）
    ——与旧版「别传 quality」相反。赠送积分**全覆盖**，没有「只覆盖 1K」那道坎。
    参考图最多 **9 张**（顶层 `referenceAssetIds`，模型支持 10 但卡在 API 上限），
    提示词用 `<image1>`…`<image10>` 按上送下标指派用途。跑不动时把
    「A. 换 GPT Image 2.5 重新报价 / B. 充值」摆给用户选，**等他点头再换**。

15. **博主分析一律点名 `videoIds`，别让服务端自动挑样本**——抖音自 2026-09-15 封了博主
    主页作品列表接口（游客态恒 403），自动挑样本拿不到候选池、必然 502；单条视频解析完全正常。
    `secUid` 用**主页**链接跑 `creator-resolve` 拿（列表被封时它仍回 200，`videos` 为空且带
    `videoListUnavailable`，`creator.secUid` 照样可用）；`videoId` 则向用户要**单条视频**
    分享链接逐条解析。空 `videos` + `videoListUnavailable` **不等于**「这个博主没作品」
    （那是 404），别把前者报告成后者。点名的作品进不了样本时会带 `reason` 出现在响应的 `skippedVideoIds` 里：
    `unresolvable`/`not_analyzable`/`note`/`foreign_creator` 四种重发也没用，
    **`timeout` 与 `throttled` 稍后重新点名这几条即可进**。如实转告用户，别默认全都分析了。
    可用样本不足 2 条时：全因 timeout/throttled 报 503（原样重发），否则 400（要换 videoIds）。
    `video-url` 传主页链接同样拿不到列表，传单条视频链接则正常。

### 典型链路

```sh
dj() { node scripts/dj.mjs "$@"; }   # 用函数不用变量：zsh 不拆分变量
dj me --pretty                                        # 0 自省
dj projects create "深夜便利店" --pretty               # 1 建项目（含首画布 + url）
dj extract characters --script ./ep1.txt --pretty     # 1.5 剧本→结构（不落卡，扣积分）
dj ops <canvasId> -f batch1.json --pretty             # 2 剧本文本卡 + 角色/场景/道具板 → 逐板出图
dj storyboard --script ./ep1.txt --cast "…" --scenes "…" --anchors anchors.json   # 剧本→分镜（不落卡）
dj ops <canvasId> -f scene1.json                      # 3 每场一批 createStoryboard kind:"video"
                                                      #   （sceneName + grouped；段原样传回）
dj canvas list <projectId> --pretty                   # 3b 列画布（接着上次做时先跑它）
dj canvas structure <canvasId> --pretty               # 4 读回结构（总览）
dj node <canvasId> <nodeId> --pretty                  #   详读单卡（正文全文/可写参数/上下游）
dj canvas lint <canvasId> --pretty                    # 4.5 体检门禁（不扣积分）：有 error 先修完再报价 ★
dj models --capability i2v --pretty                   # 5 挑模型（配音先 dj voices 挑嗓子）
dj precheck -f quote.json --pretty                    # 6 报价 → 报给用户等确认 ★
RID=$(dj uuid)                                        # 7 幂等键，存下来
dj generate --request-id "$RID" --model <id> --capability t2i \
   --params-json '{"prompt":"…","size":"2k"}' --canvas <c> --node <n>
dj task <taskId> --watch --pretty                     # 8 轮询到终态（产物自动落卡）
dj inspect <产物assetId> --prompt "…" --pretty         # 8.5 质检（不扣积分）
node scripts/download.mjs --project <projectId> --out ./out --pretty   # 9 下载 + 完整性
# 10 汇报画布链接，提示打开浏览器接力
```

### LLM 分析（`llm` scope，五条命令）

```sh
dj extract <characters|scenes|props> --script ./ep1.txt [--existing 名字,名字]  # 扣积分
dj storyboard --script ./ep1.txt [--cast 名,…] [--scenes 地点,…] [--bible ./b.md]  # 扣积分
dj rewrite <edit|optimize|translate|lyrics> --text "…" [--instruction "…"]        # 扣积分
dj caption image <assetId>                                                        # 扣积分 0.1/次
dj caption video --frames <id,id,…> --duration <秒> [--times t1,t2] [--dialogue "…"]  # 扣积分 0.1/秒
dj inspect <assetId> [--prompt "…"] [--dimensions integrity,…]   # 不扣积分；复杂 context 用 -f
```

`extract` 出 `{kind, characters|scenes|props}`；`storyboard` 出
`{visualTone, newCast[], scenes[].shots[]}`；`rewrite` 出 `{mode, text}`；
`caption` 出 `{kind,text}` 或 `{kind,prompt,scope?,slots?,warnings?}`；
`inspect` 出 `{verdict, checks[], advice?, judge}`。**全都不落卡**——回写走 ops（纪律 8）。

`rewrite edit` 必须给 `--instruction`；`translate` 不接受 `--instruction`。
专属错误码（502）：`llm_upstream_failed` / `llm_empty_output` **已退款可重试**；
`llm_unparsable_output` **已计费不退款**（结构没对上，但 token 真烧了）。

`GET /api/v1/agents` 列的是「平台有哪些分析能力」，**不是**「你能点名调哪个 Agent」
——分析端点的 Agent 由服务端硬编码，**没有通用对话通道**。

### 博主分析（`creators:read`，七条命令；转存另需 `assets:write`+`assets:read`）

```sh
dj creator-resolve "<抖音分享链接或口令>"          # → secUid + 作品列表（无播放直链）
dj video-url "<抖音视频或主页链接>"                # → 视频直链，curl -L 下到本地看片（不转存、数周失效）
dj creator-analyze <secUid> <videoId> <videoId> …  # 发起分析（videoIds 必须点名，纪律 15）
dj creator-analysis <jobId>                      # 查一次进度
dj creator <secUid>                              # 账号画像 + 仿写提示词 stylePrompt
dj creator-report <secUid> <videoId>             # 单条报告 + ASR 转写全文
dj creator-archive <secUid> <videoId>            # 转存原片 → assetId（须先分析过；单视频链接没有 secUid，要文件用 video-url）
#   取文件：download.mjs --asset <assetId> --out ./out
```

四条硬规则：

- **先分析才能读**：读端点只放行本账号发起过分析的对象，没分析过一律 404（与「不存在」同响应）。
- **异步且慢**：单条视频 GPU 处理硬超时 540 秒，整链 30–60 分钟属正常；轮询 15 秒起，
  打得再密也不会更快。同时只能跑一个分析（GPU 全站共享，第二个请求 409）。
- **`partial` 是终态但不是失败**（退出码 0）：逐条报告已产出可读，只是没出账号画像，
  看 `succeededVideoIds` 取已成功的那些。
- **原片是 opt-in**：不调 `creator-archive` 就不会有第三方视频进资产库；
  `creator-resolve` 刻意不给播放直链（抖音直链 2–4 周失效且防盗链）。

专属错误码：`creator_upstream_failed`（502，退避 1–2 分钟重试，连续失败别再密集打——
全站共享出口）、`archive_limit_reached`（409，未过期转存满额，等保留期回收，重试无用）。

### ops 词表（13 个，最小例子）

一批 1–50 个 op，**整批原子**（任一失败则整批回滚、零写入）。
**引用的 nodeId 必须在这批之前已经存在**：id 由服务端生成，只能从响应 `results[].nodeIds`
取，所以对**刚建的卡**连线/改卡必须放到下一批（两端都是既有卡则可同批）。
`createSceneSet` ≠ `createCard kind:"scene"`：前者才是带身份锚、会被分镜自动连的场景设定板。

```jsonc
{ "op": "createCard",            "params": { "kind": "text", "title": "场次说明", "content": "第一场：重逢" } }
{ "op": "createCharacterBoard",  "params": { "name": "林小满", "description": "25 岁女主，短发，米色风衣" } }
{ "op": "createSceneSet",        "params": { "name": "老城区天台", "description": "黄昏，晾衣绳，远处高架桥" } }
{ "op": "createPropBoard",       "params": { "name": "旧铜钥匙", "description": "布满绿锈的黄铜钥匙", "material": "黄铜", "era": "1990s" } }
{ "op": "createStoryboard",      "params": { "shots": [{ "title": "镜1 推门", "prompt": "林小满推开天台铁门，逆光" }] } }
{ "op": "connectCards",          "params": { "sourceId": "n_c3d7d8de-1b77", "targetId": "n_ebeca6e7-bec0" } }
{ "op": "disconnectCards",       "params": { "sourceId": "n_c3d7d8de-1b77", "targetId": "n_ebeca6e7-bec0" } }
{ "op": "updateCard",            "params": { "nodeId": "n_ebeca6e7-bec0", "prompt": "黄昏逆光，米色风衣" } }
{ "op": "attachAsset",           "params": { "nodeId": "n_a19cb462-d5cd", "assetId": "3f9a…（64 位 hex）" } }
{ "op": "adoptVersion",          "params": { "nodeId": "n_a19cb462-d5cd", "assetId": "7c2b…（64 位 hex）" } }
{ "op": "moveCard",              "params": { "nodeId": "n_a19cb462-d5cd", "position": { "x": 640, "y": -120 } } }
{ "op": "deleteCard",            "params": { "nodeId": "n_a19cb462-d5cd" } }
{ "op": "autoLayout" }
```

请求体：`{ "ops": [ … ] }`。**默认别给 `ifVersion`**——不给才会在版本被推进时自动
重读重放（最多 3 轮），用户正开着画布也写得进去；只有「读—判断—写」事务宁可失败也不能
重放时才给（取响应里的 `data.version`，**别硬编码**）。

`connectCards` / `disconnectCards` 都幂等（已存在 / 本就没有都返回 `noop`，不是错误）。
**分镜表卡已下线**：`createShotTable`/`updateShotRow`/`insertShotRow`/`deleteShotRow`
四个 op 已撤除（发过去判 400）。拆分镜用 `createStoryboard`（一镜一张图卡），
某一镜要改就 `updateCard` 改那张卡。存量画布里的分镜表卡仍可 `dj node` 读，但只读。

**`updateCard` 可改字段按卡型不同**（给了不适用的字段或词表外的取值会直接报错，不静默忽略）：

| 卡型 | 可改字段 |
|---|---|
| 任意 | `title` |
| text | `content` ｜ scene：`description` |
| image | `prompt` `aspectRatio` `resolution`(**1k/2k/4k**) `quality`(low/standard/high) `seed` `seedLocked` |
| video | `prompt` `aspectRatio` `resolution`(**480p/720p/1080p/2k/4k**) `durationSec`(0–600] `audio` `mode`(i2v/flf2v) |
| audio voice | `text` `voiceId` `voiceName` `speed`(0.5–2) `emotion`(9 档) `emoVector`(8 个 [0,1]，null 清掉) `emoAlpha`(0–1) `emotionSecondary` `emotionMix`(0–1)——后四项仅情感向量模型生效；写 `emoVector` 会把 `emotion` 置回自动、写 `emotion` 会清掉向量，同一补丁同时给 `emotion` 与非空 `emoVector` = `invalid_field_value`；`emotion` 传 null = 置回自动；`emoVector` 不能与 `emotionSecondary`/`emotionMix` 同批写 |
| audio sfx | `text` ｜ audio music：`musicStyle` `lyrics` `instrumental` |
| 其余卡型 | **仅 `title`** |

⚠️ `resolution` 是两套词表，图片卡与视频卡不通用。拿不准就先 `dj node` 看 `params`——
读回来的字段集就是写得进去的字段集。错误码：`no_applicable_fields`（字段不适用该卡型）、
`invalid_field_value`（取值非法）、`invalid_aspect_ratio`。

**分镜自动参考边的实测规则**：`createStoryboard` 拿每个镜头的 `title + prompt` 拼成文本，
**角色卡/场景卡的名字出现在这段文本里**才会自动连边（名字要逐字一致）。
**道具板不参与自动连线**，必须下一批手动 `connectCards`。
`createStoryboard` 返回的 `nodeIds` 与 `shots` **一一对应、顺序一致**。

### 生成能力词

`t2i`(prompt) · `i2i`(image) · `i2v`(firstFrame) · `flf2v`(firstFrame+lastFrame) ·
`ref2v`(顶层 referenceAssetIds≥1) · `avatar`(drivingAudio + firstFrame/motionVideo 二选一) ·
`t2a`(text) · `music`(text) · `sfx`(text) ·
`upscale`(video，**专指视频**高清；图片放大是 `i2i` + `operation:"upscale"`) ·
`v2a`(video，抽音轨；定嗓样本提取) · `blockout`(sourceVideo，视频转白模)。

- **点名了就不降级**：请求 `i2v` 不给 `firstFrame` 得到 400，不会悄悄按文生视频出片。
- **白模换角**（让新角色复刻一段现成视频的动作与运镜）分两步：`blockout` 把原片转成深度
  粘土白模 → `ref2v` 同时带 `--reference <新角色定妆照>` 与 `--reference-video <白模片>`。
  **参考视频只提供动作与运镜，参考图只提供长相**；提示词写「动作、走位与镜头运动严格跟随
  `<Video 1>`，不参考其画风、色彩、材质与背景」，**绝不描述具体动作**（模型会听文字不听视频）。
  本场景建议 `--params-json '{"promptCompile":"off", …}'`：提示词要逐字可控，平台自动补的
  限制段可能与动作锁定句打架。
  `referenceVideoAssetIds` 只有 `ref2v` 吃、≤3 段、模型须声明参考视频能力（否则 400
  `model_unsupported`）、每段时长须可确认且不超模型上限（本地 H3 单段 ≤15s）、与数字人
  `motionVideo` 互斥；输出时长按参考取大，实扣另计参考视频的输入秒。
- **数字人口播用 `avatar`**：模型从 `dj models --capability avatar` 里挑（普通视频模型会被拒，
  数字人模型也不出现在 `i2v`/`flf2v` 目录里）。`drivingAudio` 只收 wav/mp3，口型与产出时长
  都由它决定；`durationSec`/`resolution`/`audio` 对它无效。
  **专属数字人（仅管理员）**：`dj digital-humans` 取 id → `--params "digitalHumanId=<id>,drivingAudio=<配音>"`，
  模型选「数字人口播（InfiniteTalk）」；形象图不用传（再给 `firstFrame`/`motionVideo` 400），只支持口播；
  非管理员列表恒为空、带 id 提交被拒。
- **素材一律用 assetId**（64 位小写 hex，来自 `canvas structure` 的 `assetIds`）；
  不收 URL、不收 base64、不收本地路径。本地文件先 `dj upload <path>` 换 assetId
  （需 `assets:write`；≤50MB，1 GiB/天；幂等——assetId 就是内容 sha256，重传只会
  返回 `deduplicated: true`）。
- **配音先挑嗓子**：`dj voices --q 温暖少女`。`kind:"system"` 填 `params.voiceId`，
  `kind:"user"` 填 `params.voiceName`，两者不通用；id **原样回传别 trim**
  （个别系统音色 id 带尾随空格）。

### 人工介入编辑与局部重绘（`canvas:write`）

```sh
SESSION=$(dj edit-session create "$CANVAS" "$NODE" --hint "把头发改成卷发")
SID=$(printf '%s' "$SESSION" | jq -r '.data.sessionId')
printf '%s' "$SESSION" | jq -r '.data.url, .data.expiresAt'   # ← 一起转述给用户
# …去做别的事，下一轮再查…
STATUS=$(dj edit-session status "$SID")
MASK=$(printf '%s' "$STATUS" | jq -r '.data.result.maskAssetId')
SRC=$(printf  '%s' "$STATUS" | jq -r '.data.sourceAssetId')
WANT=$(printf '%s' "$STATUS" | jq -r '.data.result.instruction')
dj generate --request-id "$(dj uuid)" --model <图片模型id> --capability t2i \
  --reference "$SRC" --params-json "{\"prompt\":\"$WANT\",\"mask\":\"$MASK\"}" \
  --canvas "$CANVAS" --node "$NODE"        # ← 先 precheck 报价（纪律 1）
dj edit-session revoke "$SID"              # 用户改主意：收回还没被用的链接（幂等）
```

- 四态：`pending`（还没交，下一轮再查）· `submitted`（`result` 就是你要的）·
  `expired` / `revoked`（这条废了，重签并告诉用户上一条已失效）。
  已提交的**撤销不掉** → `409 session_consumed`，改用 `status` 取 `result`。
- `params.mask` 三条硬约束：**只有 `t2i` 消费**（挂 `i2i` 上会被静默丢弃，所以显式 400）·
  **必须与 `--reference` 同时给出**，作用于第一张（＝源图）· **必须是 PNG，
  透明像素 = 重绘区**，其余锁定。
- 两条**服务端不校验、你要自己保证**：蒙版与源图**尺寸一致**（`dj upload` 回执有
  `width`/`height`；走编辑会话拿到的天然同尺寸），蒙版**确实含透明像素**
  （全不透明＝什么都不重绘，照样扣钱）。
- 另三个错误面：蒙版不存在/不属于你 → `404 not_found`；模型不吃蒙版 →
  `400 model_unsupported`；渠道承载不了蒙版 → `422 asset_unresolved`。

### 响应形状

所有响应形状恒定：`{ok, data, error, meta?}`（成功也带 `error:null`，失败也带 `data:null`）。
`dj.mjs` 默认原样输出信封，脚本化一律走 `.data.*`：

```sh
# 一次调用取多个字段：先存整个响应再逐个解析（别把 create 跑两遍，那会建两个项目）
CREATED=$(dj projects create "X")
PROJECT=$(printf '%s' "$CREATED" | jq -r '.data.projectId')
CANVAS=$(printf '%s'  "$CREATED" | jq -r '.data.canvasId')
OPS=$(dj ops "$CANVAS" -f b1.json)
SHOT1=$(printf '%s'   "$OPS" | jq -r '.data.results[2].nodeIds[0]')
TASK=$(dj generate --request-id "$RID" … | jq -r '.data.taskId')
ASSET=$(dj task "$TASK" | jq -r '.data.assetId')
```

⚠️ **变量转管道用 `printf '%s'` 不要用 `echo`**：zsh 的 `echo` 会把 JSON 里的 `\n`
解释成真换行，jq 报 `control characters … must be escaped`。直接管道不受影响。

列表端点的数组键**不统一**：`projects` / `models` / `items`（资产）/ `entries`（账单）。
`structure.nodes[] = {id, kind, title, summary?, assetIds[], hasAsset, anchor?, shotNo?, aspectRatio?, parentId?}`
——按 `title` 定位 nodeId 就靠它。`dj.mjs uuid` 输出裸 uuid 串（不是信封）。

### 错误处理

**一律按 `error.code` 分支**，不要按 HTTP 状态码，更不要按 `message` 文案。

- **两个 402 千万别合并**：`insufficient_credits` = 账户余额空了 → 摆出「换 MiniMax H3 / 充值」两条路（纪律 12）；
  `token_limit_exceeded` = **这枚令牌**的限额用尽（账户可能还有很多钱）→ 去 `/profile#api`
  调额度或换令牌，**绝不能引导用户充值**。
- `insufficient_scope`(403) 重建令牌，不要重试；`version_mismatch`(409) 重读 structure 再写；
  `node_not_found`/`canvas_busy` **未提交任何任务**，重试安全；
  `node_busy`(409) 那张卡正跑着一个生成，**未提交任何任务**且重读结构没用——等它跑完或换卡；
  `cancel_unsupported`(409) 没有取消通道，如实告诉用户等它跑完、钱照付。
- **`succeeded` 但没有 `assetId`**：任务成功、产物转存失败，**钱已经花了**。
  去 `assets list` 按时间找，**别当失败重抽**（那是第二次付钱）。
- `landedTo:"assets"` 不算失败（目标卡被删了，产物在资产库里）；`landedTo:null` 且非终态 =
  还没落，下次轮询自动重试。
- **自己收尾**：上面两种情况都不必重新生成——拿到 assetId 后用 `attachAsset` 把产物绑回
  画布。它只接受**空卡**（已有产物/版本链/在途任务报 `card_not_empty`），目标卡不空或已被删
  就先 `createCard` 建一张空卡、下一批再绑。

`dj.mjs` 退出码：0 成功 ｜ 1 用法/配置 ｜ 2 API 业务错误 ｜ 3 402 ｜ 4 429 ｜ 5 网络 ｜
6 `--watch` 超时（任务仍在跑，不是失败）｜ 7 任务终态但非 succeeded。

机器可读契约：`curl -s $ROOYUN_API_BASE/api/v1/openapi.json`（OpenAPI 3.1，无需鉴权）。
