---
name: rooyun-cli
version: 1.41.1
releasedAt: 2026-10-25
description: RooYun 精简版（CLI 自由模式）：只告诉你终端里的 dj.mjs 能调哪些能力、各产出什么——文生图、图生图/编辑、图生视频、首尾帧、参考图生视频、数字人口播、配音、音乐、音效、视频高清、视频转白模、上传素材、下载产物，以及可选的画布读写和平台 LLM 辅助（提示词优化、参考图/参考片反推提示词、剧本拆解）。不预设创作流程：提示词怎么写、先做什么后做什么、用哪个模型、要不要画布，全由用户决定。当用户说「用 RooYun 生成一张图 / 一段视频」「我自己写提示词」「别走固定流程」「直接调 RooYun 的工具」「rooyun-cli」，或提到 RooYun、ROOYUN_API_TOKEN 且想自己掌控创作时使用。生成会花用户的真钱，任何生成前先报价并等用户确认。
---

# RooYun · CLI 自由模式

这是一个**工具箱，不是流水线**。你的职责是把用户的意图翻译成正确的命令和参数：

- **用户说了算**：提示词怎么写、先出图还是先出视频、用哪个模型、要不要建画布，都听用户的。
  你可以给建议（「这一镜加个参考图人物会更稳」），但**不要因为没走某个流程就拒绝或拖延生成**。
- **提示词逐字直达**：用户给的提示词原样提交。不带画布提交时平台一个字都不改；
  想润色、翻译、扩写，先问用户要不要，或者用下面的辅助命令产出一版给他挑。
- 用户想要「剧本 → 角色/场景设定板 → 分镜 → 定嗓 → 出片」那套完整工程流程时，
  告诉他装完整版 `rooyun` skill 更合适（两个版本**二选一安装**，同时装会抢着触发）。

## 安装与登录

```sh
# 安装（解压后落点是 ~/.claude/skills/rooyun-cli/）
curl -fsSL -o /tmp/rooyun-cli.zip "https://www.rooyun.com/api/skill/bundle?variant=cli"
unzip -o /tmp/rooyun-cli.zip -d ~/.claude/skills

SKILL=~/.claude/skills/rooyun-cli
dj() { node "$SKILL/scripts/dj.mjs" "$@"; }   # 用函数不用变量：zsh 不对变量做单词拆分

dj login        # ① 打开浏览器，把输出里的链接转给用户请他点「授权」
dj login        # ② 再跑一次：等待授权并保存令牌（退出码 6 = 用户还没点，提醒后再跑）
dj me --pretty  # 开工第一件事：确认令牌有效、scope 够用
```

令牌保存在本机 `~/.rooyun/credentials.json`，之后每条命令自动带上。环境变量 `ROOYUN_API_TOKEN`
优先级更高；`ROOYUN_API_BASE` 默认 `https://www.rooyun.com`。说不清的怪状况先跑 `dj doctor --pretty`；
看到「线上已是 vX」就 `dj update --pretty`。每条命令的完整参数：`dj --help`。

## 四条铁律（只有这四条，不可放宽）

### 1. 先报价，等用户确认，再生成

```sh
dj precheck --model <模型id> --capability t2i --params size=2k --pretty   # 单项
dj precheck -f /tmp/batch.json --pretty   # 整批（≤100 项）：{"items":[{"model":"…","capability":"…","params":{…}}]}
```

把「合计 X 积分，可用 Y」告诉用户（Y 取响应的 `available`，不是 `balance`），等一个明确的「继续」。
`precheck` 的 `params` 只认影响价格的 `durationSec` / `resolution` / `size` / `targetResolution`。
看 `ok` 与每项的 `priced`，任一为假就别提交。用户确认的是**这一批**；批次变大、换更贵的模型、
加时长都要重新报价。「你看着办」只授权创作决策，不授权花钱。

### 2. 每个生成任务一个幂等键，重试复用同一个

```sh
RID=$(dj uuid)   # 存下来（比如写进「镜号 → requestId」的本地 JSON）
dj generate --request-id "$RID" --model … --capability … --params-json '{…}'
```

- 提交没成功（网络断了、没拿到回执）→ **原样重发同一个键**，只扣一次钱。
- 改了提示词要重生成、或任务已 `failed` 想再来一次 → **换新键**（同键只会返回旧任务）。
- 映射丢了别盲目重发：先 `dj tasks --status all --pretty` 把现场捞回来。

### 3. 令牌与签名链接不碰明文

只让 `dj.mjs` / `download.mjs` 自己读令牌：不 `cat` 凭据文件、不 `echo $ROOYUN_API_TOKEN`、
不写进任何文件/日志/commit、不在 curl 里内联。用户把令牌贴进对话 → 告诉他已泄漏、去
`/profile#api` 吊销，再 `dj login --force`。下载用的签名地址、`edit-session` 的编辑链接同理。

### 4. 轮询用 `--watch`，不自己写循环、不自己判死

`dj task <taskId> --watch --pretty` 已按服务端建议间隔退避。视频是分钟级、图片十几秒到两分钟；
`--watch` 默认等 30 分钟后退出码 6（还在跑，不是失败）。服务端看门狗判死才会全额退款，
你自己判的「死」不退钱。

> 跑不动（`ok=false` / 402 `insufficient_credits` / 任务 `failed`）时，**别自己换模型或降档重试**——
> 把选项（换哪个模型、多少钱 / 去充值）摆给用户，让他选。换模型是创作决策，归用户。

## 能力地图：想要什么 → 调什么

### 生成（花钱，先过铁律 1）

| 想要 | capability | 必填 `params` | 常用可选 |
|---|---|---|---|
| 文生图 | `t2i` | `prompt` | `size`(1k/2k)、`aspectRatio`、`quality`(low/high)、`seed`；顶层 `--reference` 带参考图即按图编辑 |
| 图生图 / 编辑 / 放大 / 抠图 | `i2i` | `image` | `prompt`、`operation`(edit/upscale/removebg/look)、`size` |
| 局部重绘 | `t2i` | `prompt` + `mask` | `--reference <源图>`；蒙版可让用户在 `dj edit-session create` 签的链接里涂 |
| 图生视频 | `i2v` | `firstFrame` | `prompt`、`durationSec`、`resolution`、`aspectRatio`、`audio` |
| 首尾帧视频 | `flf2v` | `firstFrame` + `lastFrame` | 同上 |
| 参考图生视频 | `ref2v` | 顶层 `--reference`（1–9 张） | 同上；`--reference-audio` 锁音色、`--reference-video` 动作/运镜参考 |
| 数字人口播 | `avatar` | `drivingAudio`(wav/mp3) + `firstFrame` 或 `motionVideo` | `prompt`、`aspectRatio` |
| 配音 | `t2a` | `text` + `voiceId`(系统音色) 或 `voiceName`(用户音色)（必填，`dj voices` 挑；不传 = 400）。`provider:"gemini"` 的音色（`kore` 这类预置、`voice_` 开头的设计音色）一律填 `voiceId`，只配 Gemini 模型 | `speed`、`emotion`；Gemini / VoxCPM2 用 `styleText`（一句风格指令，≤100 字、不含括号，Gemini 不认 `emotion`） |
| 音乐 | `music` | `text` | `lyrics`、`instrumental`、`durationSec` |
| 音效 | `sfx` | `text` | `durationSec`(0.5–30) |
| 视频高清 | `upscale` | `video` | `targetResolution`(1080p/2k) |
| 视频抽音轨 | `v2a` | `video` | `dryVoice`、`transcribe` |
| 视频转白模 | `blockout` | `sourceVideo` | `mode`、`keepAudio`；产物当 `ref2v` 的 `--reference-video` 用 |

```sh
dj models --capability t2i --pretty          # 有哪些模型、单价多少（pricing 为 null = 未配价，提交必被拒）
dj voices --q 温暖少女 --pretty               # 配音前挑音色（voiceId 原样回传，别 trim；带 expiresAt 的 Gemini 设计音色 30 天到期）
dj upload ./ref.png                           # 本地素材 → assetId（≤50MB）；所有素材参数都只收 assetId
RID=$(dj uuid)
dj generate --request-id "$RID" --model "$MODEL" --capability t2i \
  --params-json '{"prompt":"<用户的提示词，原样>","size":"2k"}' --pretty
dj task <taskId> --watch --pretty             # 终态拿 assetId 与 chargedCredits（实扣）
node "$SKILL/scripts/download.mjs" --asset <assetId> --out ./out --pretty
```

不带 `--canvas` / `--node` 时产物落进用户的资产库（回执 `landedTo:"assets"`），在网页端资产页也能看到。

### 文本辅助（可选工具，不是必经步骤）

| 想要 | 命令 | 计费 |
|---|---|---|
| 口语描述 → 电影级生图提示词 | `dj rewrite optimize --text "…"` | 扣积分（按轮） |
| 按要求改写 / 中译英 / 写歌词 | `dj rewrite edit --text "…" --instruction "…"` · `translate` · `lyrics` | 扣积分 |
| 参考图 → 画面描述（反推提示词） | `dj caption image <assetId>` | 扣积分（0.1/次） |
| 参考片 → 镜头脚本（自己抽 2–8 帧逐张 upload） | `dj caption video --frames a,b,c --duration 8` | 扣积分（0.1/秒，按时长取整） |
| 剧本 → 角色/场景/道具结构 | `dj extract characters --script ep1.txt` | 扣积分 |
| 剧本 → 分镜（每段带视频提示词） | `dj storyboard --script ep1.txt` | 扣积分 |
| 判断一张图有没有崩、像不像 | `dj inspect <assetId> --prompt "…"` | 免费 |

扣积分的辅助命令也是花钱：先告诉用户「这一步要扣积分」再跑。你自己直接写提示词不花钱，
很多时候比调辅助命令更直接——由用户选。

### 其它（按需）

- **账务**：`dj wallet`（余额）· `dj ledger --token-id self`（本令牌花了多少）
- **任务**：`dj tasks`（在途）· `dj cancel <taskId>`（只有排队中的能真停）
- **抖音素材**：`dj video-url <单条视频分享链接>` → 视频直链，`curl -L` 下到本地看片（不花钱）
- **多轮 Agent 会话**、**选题情报**（简报 / 雷达 / 文案库）、**参考视频拆解**：见 `dj --help` 对应段落

## 提示词：用户写什么就交什么

默认就是逐字提交。下面是**写法参考**，用户问「怎么写更好」时再拿出来，不是格式要求：

- **图片提示词**：主体（谁/什么、外观）→ 场景（地点、时间、天气）→ 光线与色调 → 镜头（景别、机位、焦段）
  → 风格（写实/动漫/胶片…）。带参考图时用 `<image1>`…按 `--reference` 的顺序指派每张的用途
  （如「<image1> 的人物穿上 <image2> 的外套」）。
- **场景提示词**：先定空间（室内外、规模、陈设）和时间光线，再写氛围与关键道具；要做多镜复用的场景图，
  不写人物、不写动作，构图留空间。
- **视频提示词**：画面（谁在做什么、镜头怎么动）→ 台词 → 限制。带参考时开头写
  「<Picture 1> 是林小满。<Picture 2> 是深夜便利店。」——编号 = `--reference` 的顺序（`<Video k>`、
  `<Audio j>` 同理，各自从 1 编号）。台词写成 `台词：林小满（清冷女声·压着火气）：“这批货今晚必须出城。”`
  （中文弯引号里的字会被对口型；内心独白写 `OS：…`、音效写 `OV：…` 不加引号）。
  需要多镜头硬切可写 `【镜头1｜00:00-00:03】…【镜头2｜00:03-00:08】…`。末尾 `【限制】` 列 3–8 条本镜最容易出错的点。
  完整说明见 [`references/video-prompt.md`](references/video-prompt.md)。

**平台什么时候会动提示词**：只有带 `--canvas` + `--node` 提交视频时，平台会按画布上下文**追加**
（只追加、不改写）参考声明 / 台词 / 【限制】，回执 `meta.promptCompile.applied` 如实列出补了什么。
用户要逐字可控就在 `params` 里加 `"promptCompile":"off"`。个别模型（如 MiniMax H3）提交时会把
`<Picture i>` 这类标签翻成模型自己的语法——那是格式适配，不改内容。

## 默认模型（用户没点名时的建议，用户点名就听用户的）

- **图片**：名字以「Qwen-Image-2.1」开头的那一行（`t2i` / `i2i` 各一行，按 capability 现取 id，别硬编）。
  固定 0.05 积分/张，1k/2k、`quality` 高低都同价；只有 1k/2k 两档（`4k` 会回落 2k）。
- **视频**（`i2v` / `flf2v` / `ref2v`）：名字以「Seedance 2.0 Fast」开头的那一行，**`precheck` 与 `generate`
  都显式带 `resolution:"720p"`**——它的默认档是 480p，不带就按 480p 出片计价。
  更便宜的选择是名字以「MiniMax H3 ·」开头的那一行（平台自建算力、赠送积分可用）。

```sh
MODEL=$(dj models --capability t2i | jq -r '.data.models[] | select(.name | startswith("Qwen-Image-2.1")) | .id' | head -1)
VIDEO=$(dj models --capability ref2v | jq -r '.data.models[] | select(.name | startswith("Seedance 2.0 Fast")) | .id' | head -1)
```

## 画布是可选的

不建画布也能生成。用户想要「能在网页上接着编辑」的成果时再建：

```sh
dj projects create "雨夜便利店" --pretty          # → projectId / canvasId / url
dj ops <canvasId> -f batch.json --pretty           # 建卡、连线、改卡（1–50 个 op，整批原子）
dj generate … --canvas <canvasId> --node <nodeId>  # 产物自动落到这张卡上
dj canvas structure <canvasId> --pretty            # 读回结构拿 nodeId / assetIds
```

最常用的两个 op：`{"op":"createCard","params":{"kind":"image","title":"海报","clientRef":"@poster"}}`、
`{"op":"connectCards","params":{"sourceId":"@a","targetId":"@b"}}`（同批内用 `clientRef` 互相引用）。
全部词表见 [`references/ops-vocabulary.md`](references/ops-vocabulary.md)。写用户**已有**的画布前先提醒他：
他那边二十秒内会自动出现改动，如果他手上有没同步的编辑，会弹横幅让他处理。
建完把响应里的 `url` 拼上站点地址交给用户。

## 两条硬限制（一开始就说清）

- **API 拼不了成片**：只能做到「每段一个视频」。要整片，请用户在画布上点「合成成片」，
  或你把各段下载后用本机 ffmpeg 拼。
- **单个上传 ≤ 50MB**：更大的视频先在本地压缩（白模/动作参考压到 720p 就够）。

## 错误速查

- **两个 402 处置相反**：`insufficient_credits` = 账户没钱（换模型或充值，让用户选）；
  `token_limit_exceeded` = 这枚令牌限额用完，账户可能还有钱——去 `/profile#api` 调额度，**别劝充值**。
- **`succeeded` 但没有 `assetId`**：产物做出来了、钱已花，只是转存失败——`dj assets list` 按时间找，**别重新生成**。
- **`rate_limited`**：按提示退避；提交生成是 10 次/分/令牌，批量就逐条提交，别并发轰。
- **`invalid_request` / `asset_unresolved`**：参数或 assetId 有问题，改了再发，重试没用。
- 其余见 [`references/errors.md`](references/errors.md)；各命令响应字段见 [`references/endpoints.md`](references/endpoints.md)。

> `references/` 里的文档与完整版共用，里面提到的「纪律 N」「按顺序搭画布」是完整版的工程流程建议；
> 在本精简版里，**只有上面四条铁律是强制的**，其余都是可选的参考。
