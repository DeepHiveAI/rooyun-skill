---
name: rooyun
version: 1.46.0
releasedAt: 2026-10-29
description: 用自然语言驱动 RooYun（短剧 AI 创作工作台）的开放 API：建项目与无限画布、按「剧本 → 角色/场景/道具 → 分镜视频卡 → 生成」的固定顺序搭画布、用平台 LLM 把剧本拆成结构化的角色/场景/道具/分镜再落成卡片、调模型生成图片视频音频并自动落回卡片、把一段现成视频转成白模再让新角色复刻它的动作与运镜、反推参考素材的提示词、质检分镜图、下载产物到本地、把抖音视频分享链接解析成可直接下载的视频直链，供本地看片做对标分析；以及选题情报一条链：读每日频道简报（选题 + 「AI 数字人做不做得了」的可执行性判断 + 对标参考）、订阅对标博主并按增速看谁在起来、查热榜与每日选题报告、检索文案库看别人的爆款是怎么写的（钩子/段落节奏/CTA）。当用户说「用 RooYun 生成分镜 / 把我的剧本做成视频工程 / 拆一下这个剧本的角色 / 在 RooYun 里建个项目 / 把这段视频换成我的角色重演 / 下载我 RooYun 项目的产物 / 查我 RooYun 还剩多少积分 / 帮我把这条抖音视频下下来看看 / 抓一下这个抖音博主的视频 / 今天做什么选题 / 帮我盯着这几个对标博主 / 别人这条爆款是怎么写的 / 看看今天的选题简报」，或提到 RooYun、rooyun.com、ROOYUN_API_TOKEN 时使用本技能。生成类会花用户的真钱，任何生成前必须先报价并等用户确认；选题情报那条链全部只读、不扣积分。
---

# RooYun 开放 API

RooYun 是「无限画布 + AI Agent」的短剧创作工作台。你通过 v1 开放 API 在用户的画布上
搭工程、生成内容、取产物。**产出不是一堆文件，是一张用户可以接着手工编辑的画布**——
这是本技能所有决策的出发点。

> 用户嫌固定流程管得太死（「我就想自己写提示词直接出图」「别让我先建角色板」）时，告诉他有
> **精简版 `rooyun-cli`**（CLI 自由模式：只留报价/幂等/令牌/轮询四条铁律，提示词与顺序全由他定），
> 安装见 README「精简版」一节。两个版本二选一安装，别同时装。

## 你能做什么

| 能力 | 说明 |
|---|---|
| 搭工程 | 建项目/画布，建角色设定板、场景卡、道具板、分镜视频卡（站内「提取分镜」同款：一段一卡 + 本场引用坞 + 成组），连线/断线，改卡，自动布局 |
| 读剧本出结构 | 剧本 → 角色/场景/道具（带完整字段）、剧本 → 分镜（一镜十几个字段）。**只返数据不落卡**，改完用 ops 回写 |
| 加工文案 | 按要求改写、口语描述转电影级生图提示词、中译英、给剧情写主题曲歌词 |
| **多轮 Agent 会话** | 跟目录里的 Agent（萌宠文案、剧本医生…）开一段**服务端持有历史**的会话：每轮只发新的一句话，拿回 A/B 双稿全文，指定其中一稿继续改（见「多轮 Agent 会话」章，纪律 13） |
| 读素材出提示词 | 参考图 → 画面描述；参考片（自己抽好的 2–8 帧）→ 完整镜头脚本 |
| 质检产物 | 判分镜图有没有崩坏、人物像不像定妆照、拍出来是不是导演要的 |
| 读画布 | 读整张结构（总览，含每张卡的落位坐标），或详读单卡（正文全文 + 可写参数 + 上下游 + 多版产物；存量分镜表卡另出全部行） |
| 管产物版本 | 同一张卡生成多次会攒成一排可选版本：详读看 `versions[]`，`adoptVersion` 换用其中一版；`attachAsset` 把资产库里的产物绑回空卡 |
| 生成内容 | 文生图 / 图生图 / 图生视频 / 首尾帧 / 参考图生视频 / 数字人口播 / 配音 / 音乐 / 音效 / 视频高清 / 视频抽音轨 / 视频转白模，**产物自动落回你指定的卡片** |
| **白模换角** | 拿一段现成视频（用户上传的原片、或画布上已生成的片）转成深度粘土白模，再让新角色复刻它的动作、走位与运镜：`blockout` 出白模片 → `ref2v` 带参考视频 + 新角色定妆照出片（见「白模换角」章） |
| 请用户搭把手 | 撞上「只有人能指」的步骤（局部重绘要涂哪一块）时，签一条免登录编辑链接给用户，他涂完你取回蒙版接着做 |
| 局部重绘 | 拿蒙版只重画选中的那一块（`t2i` + 源图 + `params.mask`），其余像素锁定不变 |
| 挑音色 | 查音色目录（系统音色 + 用户自己的克隆/设计音色），配音前先挑嗓子 |
| 专属数字人（仅管理员） | 管理员登记的专属数字人出口播：`dj digital-humans` 取 id → `avatar` 带 `params.digitalHumanId` + 配音，形象图不用传；非管理员列表恒为空（见 [`references/endpoints.md`](references/endpoints.md)「专属数字人」节） |
| **锁角色音色** | 试镜定嗓全自动闭环：试镜片 → 抽人声轨 → 绑到角色 → 对白镜头注入参考音频，同一角色全剧一把嗓子（见「角色音色一致性」章，对白剧必读） |
| 传素材 | 上传本地图片/视频/音频换 `assetId`，之后可当首帧、参考图、图生图源图 |
| 取产物 | 列资产、批量下载、完整性核对 |
| 查账 | 钱包余额、账单流水、本令牌已烧多少额度 |
| 拆解对标博主 | 解析抖音分享链接 → 发起深度分析 → 读账号画像（赛道/受众/叙事骨架/风格雷达/标题公式）与**可直接仿写的提示词**、逐条视频报告与 ASR 转写全文；需要原片还能转存进资产库 |
| **拿抖音视频到本地** | 粘一条抖音**单条视频**链接 → 拿到视频直链 → `curl` 下到本地自己看片/分析（不转存、不花钱。主页链接当前拿不到列表，见纪律 15） |
| **拆解一条参考视频** | 粘一条抖音**单条视频**链接 → 平台切镜抽帧 + 转写 → 出逐镜头的「分段实现账」：每镜的叙事功能（hook/setup/escalate/turn/proof/cta/close）、对观众做了什么、复刻时哪些维度能换/必保、画面具体做了什么。这是「看懂一条爆款并拆成可执行方案」的第一步，约 5–15 分钟异步；**扣积分：0.1 积分/秒 × 源视频时长**（后续改编不另收费，失败自动退款），发起前先报价。拿到账本后用 `dj reference-frames <jobId> --shots …` **在本机抽帧亲眼复核**（账本的 `visual` 是模型说的，帧预算覆盖不到所有镜头）（见「参考视频拆解」章，[`references/reference-video.md`](references/reference-video.md)） |
| **复刻验收** | 片子做完别只凭感觉说「像」：把自己的成片按同一套管线拆一遍（`dj reference-analyze --asset <assetId>`），再 `dj reference-compare <参考片jobId> <成片jobId>` 出结构 diff——**参考片有、成片一次都没出现的功能**（丢了 proof 就是漏了证据环节）、必保维度有没有保住。纯计算不花钱；判定只是提示**不是门禁**（只比叙事结构，不比观感画质），成片仍要你亲自看完 |
| **赛道结构模板** | 拆过 2–12 条同赛道的片子后，`dj reference-template <jobId> …` 归纳共性：骨架序列、每个环节的出现率（`cta 0.67` = 三条里一条不带 CTA）、功能组成占比、各维度「换掉就垮」的共识。纯计算不花钱 |
| **改编参考视频** | 拿上面那份账本，`dj reference-adapt <jobId> --presenter "…" --product "…"` → **同一套叙事结构、不同内容**的新段落清单：服务端逐段按该段的「可换/必保」判定决定改不改，命中「必保」的不改并如实标出。`function`/`intent`/段数全部保留，只有台词与画面要求是新的；`--script-md` 直接出可粘进剧本卡的分段文案 |
| **今天做什么选题** | 读平台替用户**持续采集**的选题情报：订阅的对标博主在涨什么、哪条作品在加速、今天的热榜与日报、以及一份每日**频道简报**（选题 + 「这条 AI 数字人做不做得了」的可执行性判断 + 对标参考）。全部只读、**不花钱**——数据是后台 cron 早就采好的（见「选题情报」章，[`references/topic-intel.md`](references/topic-intel.md)） |
| **别人这条爆款怎么写的** | 文案库给**转写全文 + 方法拆解**：钩子怎么起、结构怎么走（每段功能 + 时长占比）、CTA 怎么收，中英各一套归一化，可按关键词/表现分档检索。写稿前先看同题材别人怎么写，比空想开头有效得多——**拿结构写自己的稿，别照搬原文** |

做不到的（不要假装能做）：实时协同、操作导演台 3D 场景 / 配方 / 编组、
缩放已有卡片（`moveCard` 只挪位置，改不了宽高）、
调用**编排型** Agent（画布助手一类，`conversational: false`——它们要在画布里跑；
纯对话与产物型 Agent 已经可以开会话，见「多轮 Agent 会话」章）、
删除或覆盖已上传的资产（内容寻址的对象不可变）、
分析**没在本账号分析过**的博主的既有产物（读端点有归属门槛，见「博主分析」一节）。

两条要提前说清的硬限制，撞上再解释就晚了：

- **API 拼不了成片**。平台的成片合成（排序、拼接、混音）跑在**用户浏览器**里
  （ffmpeg.wasm），v1 没有任何合成端点，成片也只落用户本地、不回资产库——
  也就是说即便请用户在浏览器里合成一次，你也取不回那个文件。
  你能做到「每个镜头一段视频」，**做不到「一条完整成片」**。一开始就告诉用户这件事，
  别让他等到最后才发现还得自己剪。要交付成片有两条路：请用户在画布上点「合成成片」
  自行下载；或者你把各镜视频下载到本地，用**你自己环境里的 ffmpeg** 拼——
  配方见文末「附：本地拼接成片」（你的 ffmpeg 是原生的，比浏览器里那份 wasm 快得多）。
- **超过 50MB 的外部视频带不进来**。`POST /v1/assets` 单文件上限 50MB 且无分片续传，
  而 2 分钟 1080p 的片子通常 100MB 以上。这会挡死三条自然诉求：
  `upscale` 的 `params.video`（把用户拍的片子拿来高清化）、`avatar` 的
  `params.motionVideo`（用一段参考动作驱动数字人）与 `blockout` 的
  `params.sourceVideo`（把用户的原片转白模换角）。素材超限时如实告诉用户，
  并给出可行的替代：先在本地压到 50MB 以内（白模只要几何，压到 720p 也够用），
  或改用平台内已生成的视频（那些不必上传）。

## 前置配置：登录一次，之后所有会话自动可用

令牌**不需要用户手动创建、复制或配置**。你替他跑登录，他只在浏览器点一下「授权」：

```sh
node <skill目录>/scripts/dj.mjs login          # ① 申请授权码并自动打开浏览器，立即返回
# → 把输出里的 verificationUrl 转给用户：「请在打开的页面登录并点『授权』」
node <skill目录>/scripts/dj.mjs login          # ② 再跑一次：等待用户授权（最多 90s），拿到令牌自动保存
```

- 第 ② 步退出码 6 = 用户还没点，**提醒用户后再跑一次**（授权码 10 分钟内有效）；退出码 2 = 已过期/已用，重新从 ① 开始。
- 令牌保存在本机 `~/.rooyun/credentials.json`（0600；Windows 在 `C:\Users\<用户>\.rooyun\`），按站点分桶。
  **以后每次新会话、每条命令都自动读取**，不需要再登录，也不需要环境变量。
- 签出的令牌：全部权限、不设消费限额（受钱包余额约束）、365 天有效。到期或被吊销时任何命令都会提示重新 `login`。
- 用户想换账号：`dj.mjs login --force`；想清掉本机凭据：`dj.mjs logout`（不吊销令牌，吊销去 `/profile#api`）。
- 环境变量 `ROOYUN_API_TOKEN` 仍然支持且**优先级更高**（CI、密钥管理器注入的场景）；`ROOYUN_API_BASE`
  可选，默认 `https://www.rooyun.com`，私有部署才需要改。旧名 `DUANJU_*` 仍然可用。

工具在本技能的 `scripts/` 下，零依赖，直接跑：

```sh
node <skill目录>/scripts/dj.mjs --help
node <skill目录>/scripts/download.mjs --help
```

开工第一件事永远是 `dj.mjs me`——确认令牌有效、scope 够用、限额还剩多少。
它报「尚未登录」就走上面的 `login` 两步；缺 scope 就**停下来告诉用户**（`login --force` 重新授权会签一枚全权限令牌），不要试了再说。

遇到「装了/更新了却像没生效」「明明配了令牌还是报错」这类说不清的状况，
先跑 `dj.mjs doctor --pretty`：一次报出版本是否落后、有没有**同名 skill 的另一份安装
在抢触发**（备份副本 `rooyun-backup/` 是这类怪事的头号成因）、令牌与 scope、余额。
只查版本用 `dj.mjs version`，它**不需要令牌**——还没配令牌时也能跑。

**看到「本地 skill 是 vX，线上已是 vY」这行提示，就去更新**（每条 API 响应都带线上版本，
落后时脚本会在 stderr 说一次）。更新是一条命令、不需要令牌、不必重启 Claude Code：

```sh
node ~/.claude/skills/rooyun/scripts/dj.mjs update --pretty
```

它会把最新包覆盖到本地安装目录。SKILL.md 立即生效，脚本从下次调用起用新版。
旧版**不会报错**，只是用不到新增的字段与纪律——所以这条提示值得当回事，
不要因为「现在也能跑」就忽略它。

---

## 工作流纪律（硬规则，不可自行放宽）

### 1. 任何 generate 之前必须先 precheck 报价，展示给用户并等确认

这是产品第一原则「成本前置透明」。**没有例外**，包括用户说「你看着办」「不用问我」的时候——
那种授权只覆盖创作决策，不覆盖花钱额度。正确姿势：

```sh
# ① 整批报价（一次最多 100 项）。-f 的文件形状：
#    {"items":[{"model":"<模型id>","capability":"t2i","params":{"size":"2k"}}, …]}
#    也收裸数组 [ …items… ]。注意 precheck 的 params 只认影响价格的键：
#    durationSec / resolution / size / targetResolution，以及配音专用的 text / speed / durationFactor
#    （传别的会 400）。
#    配音 t2a 要传 text（台词原文，可加 speed）才能拿到按秒的准价——服务端按台词估算时长，
#    与提交时冻结同一份估算；不传 text 只会按缺省时长报一个不准的数
node scripts/dj.mjs precheck -f /tmp/batch.json --pretty
# ② 把「合计 X 积分，本次可用 Y」原样告诉用户（Y 取响应的 available），等一个明确的「继续」
# ③ 得到确认后才逐条 generate
```

报价响应自带 `balance` 与 `available`，所以**报价不需要 `billing:read`**，不必额外调 `wallet`。
**报「可用」要用 `available`，不是 `balance`**：用户可能持有只能花在某些模型上的「定向积分」
（兑换码限定模型），`available` = 通用余额 + 定向积分能为本批承担的部分；`balance` 只是通用余额，
拿它报会低报，用户以为不够。`ok` 已按同一口径算好，直接信它。

报价是**体验层判断，不是扣费承诺**（两次调用之间余额可能被别的任务花掉）。
`precheck` 对不存在或未配价的模型仍返回 HTTP 200——必须逐项看 `items[].priced`
和整批的 `ok`，任一为假就别提交，提交也是被拒。

用户中途改需求导致批次变大（多加镜头、换更贵的模型、加时长）→ **重新报价、重新确认**。

**链式生成要报两次价**：「分镜出视频」是 `t2i` → `i2v` 两段，第二段的 `firstFrame`
要等第一段的产物出来才有 assetId，没法和第一段一起预检。诚实做法是一开始就告诉用户
「这活儿分两步，我会报两次价」，而不是报完第一段就默默把第二段也做了。

### 2. 优先在你自己创建的画布上工作

默认路径：`dj.mjs projects create "<名字>"` 拿一张全新画布再干活。

确实要写用户已有的画布时，**先告知并发编辑风险再动手**：

> 「这张画布你可能正开着。我写进去之后，你那边二十秒内会自动出现；但如果你手上有还没
> 同步的改动，会先出一条横幅要你处理，处理不当有一边的改动会丢。要不要我新建一张画布？」

坚持要写既有画布，就**直接写，别带 `--if-version`**——不带才会在版本被推进时自动
「重读 → 重放」（最多 3 轮），这正是用户同时在编辑时你要的行为；带上等于关掉这层保护，
一撞就 409 失败。ops 是增量操作，重放到最新文档不会覆盖用户的改动。
写完告诉用户「二十秒内自动出现；如果顶部出了横幅，说明你有未同步的改动，先处理它」。

### 3. 令牌只由脚本自己读，你永远不碰明文

令牌只存在两处：环境变量 `ROOYUN_API_TOKEN`（回退旧名 `DUANJU_API_TOKEN`），或 `dj login` 写下的
`~/.rooyun/credentials.json`。**只有 `dj.mjs` / `download.mjs` 自己去读写它们**——你不要 `cat` 凭据文件、
不要 `echo $ROOYUN_API_TOKEN`、禁止把令牌写进任何文件、脚本、配置、commit、日志、报告、终端回显，
禁止在 curl 命令里内联明文。要用令牌就调脚本。

用户如果在对话里直接把令牌贴给你：告诉他这条消息已经泄漏了令牌，请立刻到
`/profile#api` 吊销，然后让他用 `dj.mjs login --force` 重新授权。**不要把贴来的令牌写进任何文件来「暂存」**。

签名下载地址（302 的 Location）同理：60 秒内谁拿到谁能下，不打印、不转发、不写日志。

### 4. 批量生成必须用幂等键，失败重试复用同一个键

`requestId` 是必填的 uuid。**每个逻辑任务生成一次并存下来**（比如写进一个
`镜号 → requestId` 的本地 JSON），重试时原样重发——同一个 `requestId` 落到同一个任务，
只扣一次钱。换一个新 uuid 重试 = 重复扣费。

```sh
RID=$(node scripts/dj.mjs uuid)   # 输出一个裸 uuid 字符串（不是信封）。存进你的任务表，别丢
node scripts/dj.mjs generate --request-id "$RID" --model … --capability … \
  --params-json '{…}' --canvas "$CANVAS" --node "$NODE"
```

`dj.mjs` 刻意**不会**替你自动生成 requestId——自动生成会在重试时静默换键。

**那份本地映射丢了怎么办**（上下文被截断、进程重启）：别急着换个新 requestId 重发一遍
——那就是重复扣费。先跑 `dj tasks` 把现场捞回来：

```sh
dj tasks --pretty                       # 缺省只列在途：我还有什么没跑完
dj tasks --canvas "$CANVAS" --status all --pretty   # 这张画布上都生成过什么
dj tasks --request "$RID" --pretty      # 幂等键还在、只是丢了 taskId
```

它**只读库里的状态快照、不轮询上游**，所以 `status` 可能滞后——捞回 taskId 之后，
拿准确状态（以及触发终态落卡）仍要 `dj task <taskId>`。

**幂等键只认键、不认参数**：拿同一个 `requestId` 配不同的 prompt 重发，会**原样返回第一次
那个任务**（首次提交的参数生效，新参数被丢弃），不会报错也不会按新参数重跑。
所以「改了提示词要重生成」必须用**新的 requestId**——这是两个不同的逻辑任务，也会付两次钱。

**幂等的粒度是「这次提交」，不是「这次结果」**：本节标题说的「失败重试复用同一个键」，
指的是**提交没成功**（网络断了、拿不到回执）时原样重发。而任务已经建起来又跑**失败**了
（轮询拿到 `failed`）之后，同一个键只会把那个失败任务**原样返回**——不重跑、也不再扣钱。
想真的重来一次，**必须换一个新 `requestId`**；拿旧键死循环重发是拿不到新结果的。

`generate -f body.json` 的文件形状就是请求体本身：

```json
{ "requestId": "…uuid…", "model": "<模型id>", "capability": "t2i",
  "params": { "prompt": "…", "size": "2k" },
  "canvasId": "<画布句柄>", "nodeId": "<卡片id>",
  "referenceAssetIds": ["<64位hex>"] }
```

提交限流是全域最紧的一档（10/分/令牌、20/分/账号），因为它花的是用户的钱。
批量的正确姿势是「整批预检 → 逐条提交 → 轮询」，不要并发轰。

### 5. 轮询遵守建议间隔

用 `dj.mjs task <id> --watch`，它已经按服务端 `meta.pollAfterMs`（建议 3 秒）配了退避，
封顶 15 秒。**不要自己写 while 循环高频打**。视频任务是分钟级的，图片/音频十几秒到两分钟。

`--watch` 默认等 **1800 秒（30 分钟）** 后放弃并退出码 6——那是「还在跑」不是失败，
再 `dj.mjs task <id>` 查一次即可；长视频可以 `--timeout 3600` 加大。

多条任务并行等待时，让它们各自 `--watch` 到终态，不要每秒扫一遍全部任务。

**别自己造超时判死逻辑。** 服务端问不到上游时会如实回 `running` 下轮重试而不判死——
终态一落就要同时写卡片、翻任务行、结算积分，三者必须一起发生。真卡住了由服务端看门狗
统一判死并**全额退回冻结**（图片类约 20–40 分钟，视频类更长），你会在某一轮拿到 `failed`。
你自己判的「死」不退钱，服务端判的才退。

### 6. 搭建完成后汇报画布链接，并提示用户打开浏览器接力

链接**用响应里的 `url` 字段**拼站点地址，不要自己拼路径（首画布是 `/canvas/{projectId}`，
后建的画布多一段 canvasKey）：

> 「画布已搭好：https://www.rooyun.com/canvas/p_xxxxxxxx
> 　5 张卡、2 条连线，3 条视频已生成并落卡（实耗 338 积分，本令牌限额余 1,662）。
> 　打开浏览器可以直接继续编辑、重生成、精修。」

这一步不是客套。人机在同一张画布上接力是这个产品的核心价值，别把结果留成一堆本地文件。

### 7. 下载后核对完整性元信息，缺失项如实报告

`download.mjs` 会打印 `referenced / cloud_available / missing`。
**API 看到的是云端子集**：用户浏览器里没推上云的编辑、超 50MB 的资产、上传还在队列里的，
API 一概看不见。

有 `missing` 就照实说，并给出真正的处置。**服务端侧 `missing[].reason` 目前恒为
`not_synced` 这一个值**——不是偷懒：服务端能观测到的事实只有「云端没有这一行」，
至于为什么（超大文件 / 上传在途 / 该画布从未在登录态同步过）全发生在浏览器侧，
编一个更细的原因码只会误导排查方向。处置统一是：**请用户在原设备打开该画布让它完成同步，
或直接导出**。（`download.mjs --asset` 模式下另有几个客户端码，如 `not_found` /
「assetId 形态非法」，那是 id 本身有问题，不是同步问题，报告里会分开写。）

**不要**用「下载成功 8 个」掩盖「其实引用了 12 个」。
`unreadable_canvases` 是另一类诚实：那些画布整档读不出、引用集**未知**，
所以它们的引用**不计入** `referenced_total`——意思是「不知道缺了多少」，不是「没有缺失」。

用了 `--mime` 过滤时注意：`integrity` 按项目**全量引用**计算，与过滤无关，
所以 `referenced_total` 大于本次列出的件数是正常的，别报成缺失。

### 8. 分析端点返回的是结构化数据，改完用 ops 回写，别重新提取

重新跑一遍分析既要用户**再付一次钱**，又会把他刚才在结构上做的修改整个冲掉——
这是本域最容易犯、也最贵的错。

标准链路只有一条：

```
拿到结构 → 和用户过一遍改掉不对的 → 用 ops 写进画布 → 之后要改就读回来改单行
```

- `dj.mjs extract` 的字段与 `createCharacterBoard` / `createSceneSet` /
  `createPropBoard` 对应；`dj.mjs storyboard` 的结果用 `createStoryboard` 落卡
  （`kind:"video"` **一段一张分镜视频卡**，段的 `videoPrompt` / `durationSec` / `audio` /
  `cast` / `props` 原样传回；缺省 `kind` 落分镜图卡并挂进故事板）。
  **分镜视频卡只能由它派生**，不要用 `createCard kind:"video"` 手搓——见纪律 10。
- 落卡之后要再改，就 `dj.mjs node` 读回那张卡，用 `updateCard` 改字段，
  **不要重跑分析端点**（重跑要再付一次钱，还会冲掉用户刚做的修改）。
- **分镜表卡已下线**：没有 `createShotTable` / `updateShotRow` / `insertShotRow` /
  `deleteShotRow` 这四个 op（发过去判 400），也不要向用户提议「生成一张分镜表」。
  存量画布里的分镜表卡仍然读得到（详读出全部行），但只读。

**计费分叉要读 `meta.billingUnit`，别按端点猜**：

| 命令 | `billingUnit` | 口径 |
|---|---|---|
| `extract` / `storyboard` / `rewrite` | `per_round` | **扣积分**。一次调用算一轮，与输出长度无关——拆分镜输出上万 token 也是一轮 |
| `caption`（图片） | `per_call` | **扣积分**：0.1 积分/次（与网页端同价），失败自动退款 |
| `caption`（视频） | `per_second` | **扣积分**：0.1 积分/秒，时长 = max(`durationSec`, 末帧时刻) 向上取整秒，上限 600 秒 |
| `inspect` | `free` | **不扣积分**，但照样受 `llm` scope 与限流约束 |

文本三条另带 `meta.credits`（本次实耗）与 `meta.usage`（真实 token），`caption` 带
`meta.credits` 与 `meta.creditRef`，收尾汇报时都算进总账（纪律 6）。

**视觉端点的素材一律先上传换 assetId**：不收 dataURL、不收 URL、不收本地路径。
单张上限约 1.4MB 且**服务端不降采样**，超了直接 413——自己先压到长边 1024 量级。
视频反推的多帧也要你自己抽好、逐张 `dj.mjs upload`、按时序传进去（服务端不抽帧）。

质检结果里 **`checks` 没有的维度 = 缺基准「没判」，不等于通过**；
`meta.mock` 为 true 时那是演示产物、没有信息量。两种都不要当成结论转述给用户。
判 `fail` 之后要不要重新生成是一次**新的花钱决策**，回到纪律 1 先报价。

### 9. 需要人工介入的步骤，签发编辑链接交给用户，说明有效期，然后去做别的事

有些事你说不清楚、只有用户能指：局部重绘要重画画面的哪一块，用文字描述永远是猜。
把这一步交给他，是这条产品线上人机接力的正常形态，**不是失败**。

```sh
# ① 撞上「必须由人指定区域」的步骤就签一条链接。
#    源图由服务端从那张卡上读，所以 nodeId 必须是一张**已经出过图**的图片卡
SESSION=$(dj edit-session create <canvasId> <nodeId> --hint "把头发改成卷发")
SID=$(printf '%s' "$SESSION" | jq -r '.data.sessionId')
printf '%s' "$SESSION" | jq -r '.data.url, .data.expiresAt'

# ② 把链接和**有效期**一起转述给用户，然后去做本轮还能做的别的事。
#    下一轮再查状态（几十秒一次足够，别写阻塞循环）
dj edit-session status "$SID" --pretty
```

- **转述链接时必须同时说明有效期**（响应里的 `expiresAt`，默认 15 分钟）。
  只丢一条链接不说时限，用户过半小时才点开，看到的是一句「链接已过期」，
  而他并不知道该找谁。
- **不要阻塞轮询死等**。用户可能几分钟后才点开，也可能今天不弄了。签完链接就去做别的事
  （或者干脆把这一轮交还给用户），下一轮再查状态——一次回合里循环等待只会白烧上下文
  并撞限流。
- 查到 `submitted` 就接着往下做：`result.maskAssetId` 是用户涂出来的蒙版、
  `result.instruction` 是他写的要求，拿去发起局部重绘生成。
  那是一次**新的花钱决策**，回到纪律 1 先报价再提交。
- 查到 `expired` / `revoked` 说明这条链接废了：重新签一条，并明确告诉用户上一条已失效、
  请用新的，别让他对着一条打不开的旧链接较劲。
- **链接等同于凭据**——它免登录、谁拿到谁能编辑那张卡。只转述给用户本人，
  不写进文件、日志、commit 或任何公开渠道（与纪律 3 对令牌、对签名下载地址是同一条红线）。

### 10. 按依赖顺序搭画布：剧本 → 角色/场景/道具 → 分镜视频卡 → 定嗓 → 生成；分镜视频卡只能由 createStoryboard 派生

画布不是一堆孤立的卡，是一张有向图：分镜视频卡通过**本场的引用坞**引用角色/场景/道具的
设定板，生成时才拿得到参考图。跳步或手搓建出来的卡看着都在，实际彼此不连——用户会拿到
一批「没有参考图、人物每镜都换脸」的视频，而且从卡面上看不出哪里错了。
真实事故（已两次）：调用方直接用 `createCard` 建了一堆视频卡，既没连参考也没成组，
成片里的人物与设定板完全不是同一个人。

**顺序是硬规则，不是建议**。每一步都以上一步在画布上的产物为输入；用户说「直接出视频」
也要先把前面几步补齐，跳过任何一步都会在最后一步静默出错：

```
① 剧本文本卡 → ② 角色/场景/道具设定板并出图 → ③ 拆分镜 → ④ createStoryboard kind:"video"
→ ⑤ 定嗓 → ⑥ 出视频
```

- **① 第一步永远是把剧本落成文本卡**（`createCard` kind=text，正文放剧本全文）。
  它是后续一切的真相源：提取从它出发、改稿改它、出了问题回头核对它。
  手上只有一句创意时，先跟用户把剧本聊出来再落卡，不要拿一句话直接去拆分镜。
- **② 提取素材并落卡，顺序是角色 → 场景 → 道具，然后把设定板出图**。提取用
  `dj extract`（只返数据不落卡），过一遍用户意见后用 `createCharacterBoard` /
  `createSceneSet` / `createPropBoard` 落卡；再用卡上编译好的提示词（纪律 11）逐板
  `t2i` 出定妆照 / 全景 / 道具图。分镜视频引用的是设定板的**产物**——板没出图 = 参考为空，
  连了线也等于没连。这是第一次报价（纪律 1）。
- **③ 才拆分镜**（`dj storyboard`，整集一次拆完），把上一步落卡的名字作 `--cast` /
  `--scenes` 传回去——让镜头里的人名与画布上的卡逐字对齐；把每个角色的 `shotInjection`
  映射成 `[{name, anchor}]` 用 `--anchors` 传入，否则模型每个镜头都在重新想象这个角色长什么样。
- **④ 落分镜视频卡，只能用 `createStoryboard kind:"video"`**：**优先用
  `dj storyboard-fall <canvasId> -f <storyboard响应.json>`**——按场次切批、空场景名兜底、
  一场超 30 段自动拆批全在命令里，自己拼批次写错的表现是静默断链。它等价于：每场一批，params 带
  `sceneName` + `layout:"grouped"`，`shots` 逐段取该场 `segments[]` 的
  `{title, videoPrompt→prompt, durationSec, audio, cast, props}` **原样传回**
  （段内角色/道具并集与音轨标记由服务端算好）：

  ```jsonc
  {"op":"createStoryboard","params":{
    "kind":"video", "sceneName":"深夜便利店", "layout":"grouped",
    "shots":[{"title":"镜01-02","prompt":"<segments[0].videoPrompt>","durationSec":7,
              "audio":true,"cast":["林小满"],"props":["收银机"]}]
  }}
  ```

  落出来是站内「提取分镜」同款：本场参考收进引用坞放最左列、视频卡排网格、整块圈进
  以场景名为标题的编组。三条禁令：**禁止**用 `createCard kind:"video"` 建分镜视频卡
  （不匹配参考、不进坞、不成组）；**禁止**把 `shots` 逐镜落成视频卡（段才是生成单位，
  多镜切换由模型在一次生成内完成）；**禁止**自拼 `prompt`。
  **落卡前先看每段的 `lint`**（`dj storyboard` 响应里 `segments[].lint`，编译后机检，
  只记录不拦截）：`lint.error > 0` 时先按 `lint.codes` 回到 ③ 修分镜再落卡，
  `warn` 酌情（多为台词塞不进镜、镜头过长过短这类），`info` 可忽略；判据表见
  API 文档 §5.7.4。
  op 结果的 `noop` 点名了「声明了却没有设定板」的名字时，回到 ② 补建、出图，再落。
  同一 `sceneName` 再落一批会复用同一引用坞，不会出现两个坞。
- **⑤ 有台词的角色先定嗓**（`dj character-voices <canvasId>` 看谁还没定），
  再批量出对白镜头——否则同一角色每镜换一把嗓子，且事后无法补救（只能重出）。
  全流程见「角色音色一致性」章。
- **⑥ 出视频前先跑画布体检，再核参考**：`dj canvas lint "$CANVAS" --pretty`（MCP：`lint_canvas`；
  **只读、不扣积分**，跑多少次都不花钱）。**有 `error` 级 finding 就不许提交生成**——按每条
  message 修画布（补连线用 `connectCards`、缺的设定板先补建、板还没出图就先把板生成出来），
  改完重跑到 `summary.errors` 为 0（有 error 时退出码 2，可写成 `dj canvas lint "$CANVAS" || exit 1`）。
  它把「声明了角色却没有任何参考连线」这类**静默失配**变成确定性结论。
  再核参考：`dj canvas structure` 看每张分镜视频卡的上游是不是本场引用坞，坞卡的 `members`
  列出它引用的设定板。生成走 `ref2v`，但**不必自己凑 `--reference`**——只要带上 `--canvas` +
  `--node` 且不给 `--reference`，服务端就按画布边（直连图边 + 引用坞成员展开）自动解析参考，
  并在回执 `meta.resolvedReferences` 里回显每一张的来源（`assetId` / `sourceNodeId` / `via` /
  `label`）。**回显要逐条核对**：与你预期的设定板对不上，说明画布连线不是你以为的样子，
  先去改边再生成。没有任何参考连线的视频卡**不要生成**（解析为空时服务端照常报「缺参考」）。
  errors 归零后才轮到报价——这是第二次报价（纪律 1）。
  **`<Picture i>` 的编号不要猜**：`dj canvas lint` 的响应里就有 `references` 预演，
  每张视频卡逐条给出 `index` / `tag` / `label`，顺序与真正提交时**逐位一致**——
  照抄即可，不必先花钱生成一次去看回执（写法见「视频提示词书写规范」章）。
- 已经跳步建了一堆孤立的卡怎么办：**不要删了重来**（会丢已生成的产物）。
  缺设定板的先补建并出图，缺边的用 `connectCards` 把设定板连到视频卡上，再继续。
- 用户明确要求「只要剧本，先别建东西」时，就只调分析端点、只把结构给他看——
  `analyze` 系列默认不落卡，正是为这种「先看后建」准备的。

### 11. 每次生成前复查提示词，别把没检查过的字符串送去烧钱

生成是不可逆的花钱动作，而提示词的问题几乎都能在提交前一眼看出来：
角色名写错连不上参考图、对白漏了整条音轨、定妆照被写成剧情画面。
事后发现只能重新花钱再来一次。

- **角色定妆照不要自拟提示词**。`createCharacterBoard` 落卡时平台已经编译好一份
  （单主体 / 中性表情 / 干净影棚背景 / 三视图 / 禁多余人物与文字），
  **读回来原样提交**：

  ```sh
  # 建板拿到 nodeId 后，读回卡上编译好的提示词（在 data.body，全文不截断）
  BOARD=$(dj node "$CANVAS" "$NODE_ID" | jq -r '.data.body')
  dj precheck -f - <<< "{\"items\":[{\"capability\":\"t2i\",\"params\":{\"prompt\":$(jq -Rs . <<< "$BOARD")}}]}"
  # 用户确认后再 generate，prompt 同样用 $BOARD
  ```

  自己拿角色的外貌描述拼一段，会把上面那些约束整体旁路掉——出来的图混剧情、
  带别人、不是三视图，而它正是后面所有镜头的参考基准，错在这一步会污染整部片子。
  同理，场景全景与道具板落卡时也各自编译过，都用 `dj node` 读回再提交。
- **视频提示词就是分镜视频卡上的 `prompt`**（`createStoryboard kind:"video"` 落卡时来自
  `analyze/storyboard` 的 `segments[].videoPrompt`）：生成前 `dj node` 读回原样提交，
  不要自己按 `shots` 拼、也不要只在请求里临时改写。平台编译过的版本里，多镜段带硬切
  指令与镜头时长，对白在「音轨：」行内一字不丢；自拼最常见的后果就是整片没有对白。
- **提交前逐条核三件事**：① 提示词里出现的角色/场景名与画布上卡的名字逐字一致
  （差一个空格就连不上）；② 这一镜声明的角色、场景、道具都已经连上参考图；
  ③ 有对白的镜头，对白确实在提示词里。
- **不要留代称和占位符**：「她」「那个男人」「主角」在跨镜生成里指代不到任何人，
  模型只会每镜随机编一个。要么写全名，要么靠 `cast` 显式绑定。
- 复查发现问题就**先改画布**（`updateCard` 改卡上的提示词），再提交生成——
  改完的提示词要落回卡上，而不是只在这次请求里临时改。否则用户在浏览器里看到的
  还是错的那版，重新生成又会错一次。

### 12. 视频默认走 Seedance 2.0 Fast 720p；余额不够或调用失败时，把「换 MiniMax H3」和「充值」两条路摆给用户选

用户没点名模型时，靠目录里的档位说明猜，每次选的都不一样、报价也跟着漂；
而余额不够或上游失败时最常见的两种错误处置是「静默换个便宜模型再提交」
（花的仍是用户的钱、成片效果还不一样）和「只说一句失败了」（用户不知道下一步能做什么）。

- **默认模型**：`i2v` / `flf2v` / `ref2v` 三种视频粒度，用户没点名模型时一律用目录里
  名字以「Seedance 2.0 Fast」开头的那一行——`dj models --capability <cap>` 现取 id，
  **别硬编 uuid**（后台换模型会全线失效）；并且 `precheck` 与 `generate` 的 `params`
  **都显式带 `resolution:"720p"`**：它的目录默认档是 480p，不带就按 480p 出片、按 480p
  计价，报价与成片都不是用户以为的那一档。

  ```sh
  # 取默认视频模型的 id（按名字前缀取，不硬编）
  MODEL=$(dj models --capability ref2v | jq -r '.data.models[] | select(.name | startswith("Seedance 2.0 Fast")) | .id' | head -1)
  dj precheck --model "$MODEL" --capability ref2v --params durationSec=8,resolution=720p --pretty
  # 用户确认后 generate 同样带 --params-json '{"prompt":"…","durationSec":8,"resolution":"720p"}'
  ```
- 用户点名了模型或档位就按用户的（显式选择优先），报价与确认流程不变。
- 三种「跑不动」都要停下来把两条路摆给用户，**不要自行换模型、不要换个 requestId 盲重试**：
  ① `precheck` 的 `ok=false` 且各项 `priced=true`（`available` 小于 `total`；最常见成因是
  用户手里只有赠送积分，而赠送积分不覆盖 Seedance）；② `precheck` / `generate` 回 402
  `insufficient_credits`；③ 任务终态 `failed` 且 `failure.code` 为 `model_unavailable`
  （`service_busy` 连续 3 次、`generation_failed` 重试 1 次后仍失败也算），或提交被
  `upstream_rejected` / `service_unavailable` 拒绝。
- 任务失败先看 `failure.code`，别一律当「跑不动」：`content_rejected` / `invalid_input` /
  `invalid_params` 要改提示词、素材或参数，原样重试必然再失败；`service_busy` 等 1–5 分钟后
  换新 `requestId` 重提；`interrupted` / `no_output` 换新 `requestId` 直接重提一次。这几类
  重提的是用户确认过的同一笔（失败的那笔已退款），告诉用户你在重试即可。详见
  [references/errors.md](references/errors.md)「任务失败按 failure.code 处置」。
- 话术固定给两个选项：「这批用 Seedance 2.0 Fast 720p 需要 X 积分，当前可用 Y，跑不动
  （或：这次生成没成功，这一笔没扣钱）。**A.** 换 MiniMax H3——目录里名字以「MiniMax H3 ·」
  开头、能力含本粒度的那一行（`ref2v`/`i2v` 是「全参考」，`flf2v` 是「首尾帧」），平台自建算力、
  单价更低、赠送积分可用，我会重新报价再提交；**B.** 去网页端充值，我继续用 Seedance。」
  然后等用户选，别替他选。
- 选 A 是一次新的报价（纪律 1）：H3 也有 720p 档，`resolution` 照给；多镜硬切段 H3 照收不拒，
  但它偏向按单镜理解，段内构图变化密集时可能不切镜——这是**表现倾向不是接口限制**，
  别默认替用户拆镜，先拿代表性的一段实测再定（见「提示词是模型无关的，参数不是」）。
  别挑「MiniMax H3 Max」——那是三方渠道，比 Seedance 还贵。
- 402 `token_limit_exceeded` 不在本条范围：换模型没用、充值也没用，按「两个 402 千万别合并」
  处置（调令牌额度或换令牌）。

### 13. 多轮 Agent 会话：会话 id 是状态、一个 Agent 一个会话、每轮先按目录报价、跑不动不换 Agent

会话的历史、系统提示词与窗口化全在服务端，调用方手里只有一个 `conversationId`——它就是这段
创作的全部状态。丢了它、或者遇事就新建一个会话，等于把上下文扔了重头再说一遍：用户既要重付
每一轮的钱，拿回来的稿子还换了个基准。

- **你只持有 `conversationId`，历史在服务端**：每轮只发新的一句话，不要把上一轮的稿子、要求、
  素材再贴一遍。本地维护一张「任务 → `conversationId`」表（与「镜号 → `requestId`」同一张表的
  思路）；表丢了用 `dj chats`（MCP：`list_conversations`）把现场捞回来，**不要新建会话重头说一遍**。
- **一个会话绑定一个 Agent**：`agentId` 在创建会话时定死，**中途不可换**。换 Agent = 新建一个
  会话；多个 Agent 并行做事 = 多个会话并行，各自互不串上下文。
- **每轮都扣钱，所以每轮都先报价**：报价**直接读** `dj chat new` / `dj chat show` 回执的
  `meta.estimatedTurnCredits`（= `billing.stagesPerTurn` × 这个会话 `modelId` 的 `per_round`
  单价，**服务端已经乘好**），不必自己算、也不必再拉一次 Agent 目录。
  把「这一轮预计 X 积分，当前余额 Y」告诉用户、拿到明确的「继续」，才 `dj chat send`
  （与纪律 1 同则，没有例外）。

  ```sh
  # 一轮预计多少积分（--pretty 的「计费」那一行就是它）
  dj chat show "$CHAT" | jq -r '.meta | "\(.estimatedTurnCredits) 积分＝\(.stagesPerTurn) 阶段 × \(.perRoundCredits)"'
  ```
- **`estimatedTurnCredits` 为 `null` = 这个模型未配价，发轮会被 503 拒**——**那不是免费**，
  也不是余额问题。如实告诉用户「该模型未配价、提交会被拒」，换个模型（同一会话可换 `modelId`）
  或请管理员补配价格；**不要因为算不出价就跳过确认直接发轮**。
- **每轮 `requestId` 必填，重试复用同一个键**（与纪律 4 同则）：同键重放返回**同一轮**的结果且
  不再扣费；换个新 uuid 重发 = 又付一轮的钱。
- **409 `conversation_busy` 是「这个会话正忙」，不是「这轮失败了」**：成因是上一轮还没跑完，
  或用户正在网页端同一个会话里写。按 `meta.retryAfterSeconds` 退避，然后**用同一个
  `conversationId`、同一个 `requestId` 原样重发**；不要新建会话重发，也不要并发再打一轮。
- **402 `insufficient_credits` 时把两条路摆给用户等他选**：**A.** 换模型（**同一个会话可以换
  `modelId`**，下一轮生效，按新单价重新报价）；**B.** 去网页端充值。**不要换 Agent、不要自行
  降级到更便宜的 Agent、不要把会话重开**——那是在替用户改创作基准。
- **稿件正文与产物只从响应的 `artifacts[]` 取**（A/B 两稿逐稿带 `variantId`）：不要让用户把稿子
  贴回来，也不要自己复述一遍再当下一轮的输入。要指定「就用哪一稿」，下一轮用 `references`
  带上那个 `artifactId` 即可——服务端自己去取最新正文。

### 14. 图片默认走 Qwen-Image-2.1 · GPU；固定 0.05 积分/张，画质与档位都不改价

与视频同一个毛病：用户没点名模型时靠目录里的档位说明猜，每次选的都不一样、报价也跟着漂。
而这个默认是**自建 GPU、按张固定计价**的，与此前按 token 计费的 GPT Image 2.5 口径完全相反
——把旧经验（2K 更贵、赠送只覆盖 1K、别传 `quality`）套上来，就会在本不该停的地方停下来
劝用户降档，白白折损成片规格。

- **默认模型**：`t2i` / `i2i` 都用目录里名字以「Qwen-Image-2.1」开头的那一行——
  `dj models --capability <cap>` 现取 id，**别硬编 uuid**（后台换模型会全线失效）。
  两个粒度是**同名两行**，按 capability 各取各的。同一套权重：不连参考图就是文生图，
  连上参考图就是按图编辑。

  ```sh
  # 取默认图片模型的 id（按名字前缀取，不硬编）
  MODEL=$(dj models --capability t2i | jq -r '.data.models[] | select(.name | startswith("Qwen-Image-2.1")) | .id' | head -1)
  dj precheck --model "$MODEL" --capability t2i --pretty
  ```
- **计价固定 0.05 积分/张**：1K 与 2K 同价、`low`/`standard`/`high` 三档同价、文生图与编辑同价。
  **不要为了省钱劝用户降档**——降档只让出图快一点，一分钱也省不下来。
- **档位只有 `1k` / `2k`，没有 4K**：传 `size:"4k"` 会回退到模型默认档（**`2k`**），
  报价不变但你以为的 4K 不会发生。不带 `size` 就是 `2k`。
- **`quality` 可以传，而且是真参数**：自建 GPU 通道把它映射成采样步数
  （`low` = 文生图 15 / 编辑 18，不传 = 模板默认 25，`high` = 35），
  `high` 真的更精细、只是更慢，**且不加价**。
  这与旧版「别传 `quality`」的结论相反，按本条执行。
- **赠送积分全覆盖**：自建 GPU 模型一律在赠送范围内，不存在「赠送只覆盖 1K」那道坎。
  用户手里只有赠送积分照样能出 2K。
- 参考图最多 **9 张**（顶层 `referenceAssetIds`，超出直接 400；模型本身支持到 10，卡在 API 上限）。
  提示词里用 `<image1>`…`<image10>` 指派每一张的用途，编号即上送数组下标。局部重绘的蒙版
  规则不变（`mask` 只有 `t2i` 消费，见下文；模型不吃蒙版会回 422 `mask_unsupported`）。
- **跑不动时同纪律 12 的两条路，别自己换模型**：`precheck` 回 `ok=false`、402
  `insufficient_credits`，或任务终态 `failed` 且按纪律 12 的 `failure.code` 口径属于
  「跑不动」时，把两条路摆给用户等他选：
  **A.** 换 GPT Image 2.5（按 token 计费、赠送只覆盖 1K，我会重新报价再提交）；
  **B.** 去网页端充值。**等用户点头再换**——换模型是创作决策，不要替他选。

  ```sh
  # failover：按名字前缀取（不硬编 uuid）；两个变体只是出图风格差异，没偏好用 Flare
  FALLBACK=$(dj models --capability i2i | jq -r '.data.models[] | select(.name | startswith("GPT Image 2.5")) | .id' | head -1)
  dj precheck --model "$FALLBACK" --capability i2i --params size=1k --pretty   # 换模型 = 一次新的报价（纪律 1）
  ```
- 用户点名了模型或档位就按用户的（显式选择优先），报价与确认流程不变。

### 15. 博主分析一律点名 videoIds，别让服务端自动挑样本

抖音自 2026-09-15 起不再对外提供博主主页作品列表，
自动挑样本那条路**拿不到候选池所以必然失败**。而单条视频解析完全正常——点名 `videoIds`
的模式不依赖主页列表，是现在唯一走得通的路。Agent 一律点名。

- **发起分析永远带 `videoIds`**（2–12 条）。不带 = 让服务端自动挑 = 撞 502
  `creator_upstream_failed`，白等一轮。
- **videoId 从哪来**：向用户要**单条视频**的分享链接（抖音 App 里逐条「分享→复制链接」），
  每条用 `creator-resolve` / `video-url` 解析出 `videoId`。别指望从主页链接拿列表。
- **secUid 从哪来**：拿博主**主页**链接调 `creator-resolve`。列表被封时它仍回 200，
  但 `videos` 是空的且带 `videoListUnavailable`——`creator.secUid` 照样可用，
  这正是它降级成 200 而不是 502 的原因。看到这个字段就别再等列表了，直接去要单条视频链接。
- **空 `videos` 不等于「这个博主没作品」**：带 `videoListUnavailable` 是拉不到，
  404 才是真的没有。别把前者报告成后者，那是在骗用户。
- **点名的作品会被逐条核对**：进不了样本的会带 `reason` 出现在响应的 `skippedVideoIds` 里。
  `unresolvable`（已删除/私密/风控）、`not_analyzable`（时长不在 0–600 秒）、`note`（图文笔记）、
  `foreign_creator`（作者不是这个博主，已排除以免污染其画像）这四种重发也没用；
  **`timeout` 与 `throttled` 只是这次没轮到，稍后重新点名这几条即可进**。
  如实转告用户哪几条没进去、为什么，别默认全都分析了。可用样本不足 2 条时整体报错：
  **全因 timeout/throttled 则是 503（原样重发即可），否则 400（要换 videoIds）**。
- `video-url` 传**博主主页**链接同样拿不到列表（与 resolve 同一条上游腿）。
  传**单条视频**链接则一切正常。

---

## 北极星旅程（照着做）

```sh
SKILL=<本技能目录>
# 定义成函数而不是变量：zsh 不对变量做单词拆分，`DJ="node …"; $DJ me` 在 zsh 下会报错
dj() { node "$SKILL/scripts/dj.mjs" "$@"; }

# 0) 自省：scope 够不够、限额还剩多少
dj me --pretty

# 1) 建项目（同时得到首画布 canvasId 与浏览器 url）
dj projects create "深夜便利店" --pretty
#    → projectId p_xxxxxxxx / canvasId <uuid> / url /canvas/p_xxxxxxxx

# 1.5) 手上有剧本？先让平台拆成结构，别自己读剧本硬编（会扣积分，但比出图便宜两个数量级）
dj extract characters --script ./ep1.txt --pretty
dj storyboard --script ./ep1.txt --cast "…" --scenes "…" --anchors /tmp/anchors.json --pretty
#    → 只返数据不落卡：和用户过一遍、改掉不对的，再在下一步落进 ops 批次

# 2) 按纪律 10 的顺序落卡：剧本文本卡 → 角色/场景/道具板（出图）→ 每场一批
#    createStoryboard kind:"video"（完整命令见「完整工作流：从提取到回写」）。
#    建卡 + 连线可以放**同一批**：建卡时起 clientRef（"@hero"），后面的 op 直接引用它
dj ops <canvasId> -f /tmp/batch1.json --pretty

# 3) 需要拿真实 nodeId 再做的事（改既有卡、布局）走下一批
#    不带 --if-version：版本被别人推进时服务端会自动重读重放，你不用管
dj ops <canvasId> -f /tmp/batch2.json --pretty

# 4) 读回结构，确认长成了你想要的样子
dj canvas structure <canvasId> --pretty
#    要精确改某一张卡时，再详读那张卡——
#    structure 的摘要截断在 600 字，看不到正文全貌
dj node <canvasId> <nodeId> --pretty
#    接着上次的工作、要把整张画布的正文和参数一次看全时，加 --full（放在命令最后）：
#    每张卡多带 detail（正文全文 + 全部可写参数，与 dj node 同一口径），省掉逐张 dj node；
#    但大画布响应会明显变大——只要拓扑 / nodeId 时别带
dj canvas structure <canvasId> --pretty --full

# 4.5) 出片前的门禁：画布体检（只读、不扣积分）
dj canvas lint <canvasId> --pretty
#    有 error 级 finding（视频卡没有已出图的参考 / 被引用的设定板还没出图）
#    就先修画布再回来——**errors 不为 0 不许往下走**，命令退出码为 2，
#    写进脚本就是 `dj canvas lint "$CANVAS" || exit 1`

# 5) 挑模型 → 报价 → **等用户确认**（配音的话先 dj voices 挑嗓子——用户自建的「我的音色」也在里面，provider 为 selfhosted；要控情绪看 endpoints.md「配音情绪向量」节）
dj models --capability i2v --pretty
#    视频（i2v/flf2v/ref2v）用户没点名就用「Seedance 2.0 Fast」+ params.resolution="720p"
#    （纪律 12；它的默认档是 480p，不显式给就按 480p 出片计价）。其余同一模型系拆多档
#    （速度档/质量档）、能力与单价完全一致时，取舍写在条目的 description 里——选档看它
dj precheck -f /tmp/quote.json --pretty
#    ↑ 把「合计 X 积分 / 可用 Y」报给用户，等一个明确的「继续」
#    ok=false（可用 < 合计）或后面 402 insufficient_credits / 任务 failed：
#    别自己换模型——把「A. 换 MiniMax H3（更便宜、赠送积分可用）/ B. 充值」摆给用户选

# 6) 定向生成（幂等键存好）+ 轮询到终态
RID=$(dj uuid)
dj generate --request-id "$RID" --model <模型id> --capability t2i \
  --params-json '{"prompt":"雨夜便利店门口，霓虹反射在积水里","size":"2k"}' \
  --canvas <canvasId> --node <nodeId> --pretty
dj task <taskId> --watch --pretty

# 6.5) 出图之后、交付之前可以质检一下（不扣积分）
dj inspect <产物assetId> --prompt "雨夜便利店门口，霓虹反射在积水里" --pretty
#    checks 里没有的维度 = 缺基准没判，不等于通过

# 7) 下载 + 完整性核对
node $SKILL/scripts/download.mjs --project <projectId> --out ./out --pretty

# 8) 汇报画布链接，提示用户打开浏览器接力
```

### 分镜卡的自动参考边（实测规则，会影响你怎么写 prompt）

`createStoryboard` 会为每个镜头/段**自动连参考边**（图卡与 `kind:"video"` 视频卡走同一套
规则——这正是分镜视频卡必须由它派生、不能 `createCard` 手搓的原因），但规则很具体：

> 拿该镜头的 `title + prompt` 拼成一段文本，凡是**角色卡 / 场景卡的名字出现在这段文本里**，
> 就从那张卡连一条参考边过来。

实测结果（同一批里先建「林小满」角色卡 + 「深夜便利店」场景卡 + 「旧铜钥匙」道具板）：

| 镜头 prompt | 自动连出的边 |
|---|---|
| 「深夜便利店内景，冷白灯」 | 场景卡 → 该镜头 |
| 「林小满走进深夜便利店」 | 角色卡 → 该镜头、场景卡 → 该镜头 |
| 「旧铜钥匙躺在收银台上」 | **无**——子串路径不收道具板；该镜带 `props:["旧铜钥匙"]` 才连 |
| 「雨水打在柏油路面」 | 无 |

两条实用推论：

1. **给每个 shot 传 `cast` / `props`**（把 `analyze/storyboard` 每镜产出的 `cast` 原样传回来）——
   这是参考图连线的**确定性**依据，名字含全角/半角空格差异也能连上。
   不传时才退回「名字有没有出现在 title+prompt 里」的子串猜测：提示词写「她推开门」
   而不是「林小满推开门」就**静默断链**，角色跨镜漂移且你不会收到任何报错。
   声明了但画布上没有对应设定板的名字，会在该 op 的 `noop` 里点名——**看到就去补建设定板**。
2. **道具板不参与子串匹配**，只认显式 `props` 名单——段/镜带了 `props` 就自动连；
   没带的老写法才需要在下一批手动 `connectCards`。
3. `layout:"grouped"` 下参考不逐张直连：本场所有匹配到的设定板收进 `引用坞·<场景名>`，
   坞连每张卡（结构读里坞卡的 `members` 就是它引用的设定板）。

`createStoryboard` 返回的 `nodeIds` **与 `shots` 数组一一对应、顺序一致**——
`nodeIds[0]` 就是 `shots[0]` 那张卡。重复连同一条边会返回 `noop`，无害。

---

## 参考文档（`references/`，按需读，不必全读）

主文件到此为止是**每次都要遵守的部分**：能力边界、登录、15 条纪律、北极星旅程。
下面这些是「做某件具体的事时才需要的细节」，随分发包一起落在 `references/` 下，
用到哪个读哪个——**别一次性全读进上下文**。

| 文件 | 什么时候读 |
|---|---|
| [`references/endpoints.md`](references/endpoints.md) | 要调任何端点前；不确定响应长什么样、该用哪个能力词；配音要控情绪/分段（「配音情绪向量」节：先查 `audio.emotionVector`，分段按段数×单次价报价；t2a 报价带 `text`（可加 `speed`）才是按秒准价）；用 Gemini 配音（音色填 `voiceId`、情绪走 `styleText`） |
| [`references/ops-vocabulary.md`](references/ops-vocabulary.md) | 要写任何画布改动批次；查 `updateCard` 能改哪些字段 |
| [`references/video-prompt.md`](references/video-prompt.md) | **所有视频生成前必读**——参考编号、台词前缀、限制段 |
| [`references/voice-consistency.md`](references/voice-consistency.md) | **对白剧集必读**——试镜定嗓，同一角色全剧一把嗓子 |
| [`references/blockout.md`](references/blockout.md) | 用户要「把这段视频换成我的角色重演」 |
| [`references/assets-and-llm.md`](references/assets-and-llm.md) | 传本地文件、请用户涂蒙版、读剧本出结构、改文案 |
| [`references/agent-conversations.md`](references/agent-conversations.md) | 跟目录里的 Agent 开多轮会话（纪律 13） |
| [`references/creator-analysis.md`](references/creator-analysis.md) | 拆解对标博主；把抖音链接下到本地看片（纪律 15） |
| [`references/reference-video.md`](references/reference-video.md) | 用户给了一条爆款/对标视频要照着做：拿分段实现账 → 读懂功能序列 → **`reference-frames` 亲眼复核** → 写三份文件 → 按可换/必保维度改编落画布 |
| [`references/topic-intel.md`](references/topic-intel.md) | 用户问「今天做什么选题 / 帮我盯着这几个对标博主 / 别人这条是怎么写的」；订阅博主、读日报热榜、读每日简报、检索文案库 |
| [`references/errors.md`](references/errors.md) | 撞上非 2xx、任务失败、与浏览器编辑起冲突 |
| [`references/local-compose.md`](references/local-compose.md) | 用户要一条完整成片，你决定用本机 ffmpeg 拼 |

> 拿不到这些文件（只拷了 `scripts/`、或通过 MCP 接入）？
> 单文件也能取：`curl -fsSL https://www.rooyun.com/api/skill/SKILL.md`。
> 整包见 README 的安装命令。

## 错误处理红线（详版见 [`references/errors.md`](references/errors.md)）

这几条不读详版也**必须**知道——弄错了要么让用户白花钱，要么把自己写进死循环：

- **两个 402 处置相反，绝不能合并**：`insufficient_credits` 是账户没钱
  （摆出「换 MiniMax H3」或「去充值」两条路，纪律 12）；
  `token_limit_exceeded` 是**这枚令牌**的限额用尽，账户里可能钱还多得很——
  **引导充值是错的**，充了照样跑不动，该去 `/profile#api` 调额度或换令牌。
- **`succeeded` 但没有 `assetId` 不是失败**：产物做出来了、**钱已经花了**，只是代取转存失败。
  去 `assets list` 按时间找，用 `attachAsset` 绑回空卡。**重新生成 = 让用户第二次付钱**。
- **`landedTo: "assets"` 也不是失败**：只是目标卡被删了，产物照样能从 `/v1/assets` 取。
- **`node_busy` 与 `canvas_busy` 不是同一条重试分支**：后者重读结构后可重试；
  前者是目标卡上已有在跑的生成，**重读结构没用**，得等它跑完或换一张卡——
  写成同一条分支会死循环。
- **`version_mismatch` 盲目重试无意义**：必须重读 `structure` 拿新 version 再写。
- **`invalid_request` / `asset_unresolved` / `node_limit_exceeded` 都不是抖动**：改参数或拆画布，别重试。
