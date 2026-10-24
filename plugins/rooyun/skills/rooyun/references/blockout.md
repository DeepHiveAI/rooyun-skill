# 白模换角

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：用户要「把这段视频换成我的角色重演」时

## 白模换角：让新角色复刻一段现成视频的动作与运镜

**问题**：用户手里有一段「动作对了」的片——自己拍的走位、上一版角色出的镜头、
一段想照抄运镜的参考片——想让**自己的角色**照着演。把原片直接当参考喂 `ref2v`
不行：模型会把原片的人物外貌、画风、色彩一并吸进去，出来的是「半新半旧」的人。

**解法（白模换角）**：先用 `blockout` 把原片转成**深度粘土白模**（几何、动作、镜头
保留；外观、色彩、材质抹掉），再用 `ref2v` 同时带上白模片（顶层 `referenceVideoAssetIds`）
与新角色定妆照（顶层 `referenceAssetIds`）出片。**分工定死：参考视频只提供动作与运镜，
参考图只提供长相**——两者各管一半，提示词里也按这个分工写。

### 三步流程（照抄即可）

```sh
# ① 原片换 assetId：画布上已生成的片直接从 canvas structure 的 assetIds 取；
#    用户本地的片先上传（≤50MB；白模只要几何，先压到 720p 完全够用）
SRC=$(dj upload ./ref.mp4 | jq -r '.data.assetId')

# ② 转白模。按源片秒计价（约 0.03 积分/秒量级，8 秒片≈0.24 积分），先报价（纪律 1）：
BLOCKOUT_MODEL=$(dj models --capability blockout | jq -r '.data.models[0].id')
dj precheck --model "$BLOCKOUT_MODEL" --capability blockout --params durationSec=8
#    → 把「合计 X 积分 / 余额 Y」报给用户，等确认
dj uuid   # → $REQ1
dj generate --request-id $REQ1 --model "$BLOCKOUT_MODEL" --capability blockout \
   --params-json "{\"sourceVideo\":\"$SRC\"}" \
   --canvas $CANVAS --node $BLOCKOUT_NODE     # 目标卡是一张空视频卡（createCard kind:"video" 的合法用法）
dj task <taskId> --watch      # → 产物视频 assetId = $BLOCKOUT_VIDEO
#    白模是确定性几何变换：没有 seed、同一条片转两次结果一致，失败别换参数重试，先看错误码

# ③ 换角出片：ref2v + 新角色定妆照 + 白模片。模型必须**声明参考视频能力**（见下方硬约束）
REF2V_MODEL=<支持参考视频的 ref2v 模型id>
dj precheck --model "$REF2V_MODEL" --capability ref2v --params durationSec=8
#    ⚠️ 预检只按 durationSec 报价；带参考视频的实扣会**另计参考视频的输入秒**（切「含视频输入」
#    场景价），把这一点连同报价一起告诉用户
dj uuid   # → $REQ2
dj generate --request-id $REQ2 --model "$REF2V_MODEL" --capability ref2v \
   --reference $CHAR_PORTRAIT_ASSET --reference-video $BLOCKOUT_VIDEO \
   --canvas $CANVAS --node $SHOT_NODE \
   --params-json '{"prompt":"<Picture 1> 是林小满（主角）。画面中的人物动作、走位与镜头运动严格跟随 <Video 1>，逐段对应其节奏与镜头切换。不参考 <Video 1> 的画风、色彩、材质与背景。场景：黄昏的老城区天台。","durationSec":8}'
dj task <taskId> --watch
```

### 提示词怎么写（实测逼出来的约定，不是风格建议）

> 本章是白模换角的**增量**，公共规范（五段式骨架、标签编号、台词格式）在
> 「视频提示词书写规范」章。**本场景建议 `params.promptCompile: "off"`**：
> 下面第 2、3 条要求提示词逐字可控，平台补的限制段可能与动作锁定句打架。

站内「换成角色」按钮装配的就是下面这四段，照抄结构即可：

1. **角色绑定**：`<Picture 1> 是林小满（主角）`。编号按类型 1-based = 上送数组下标：
   `referenceAssetIds[0]` 是 `<Picture 1>`，`referenceVideoAssetIds[0]` 是 `<Video 1>`
   （`<Audio j>` 同理，三类各自独立编号）。多角色时加一句
   「白模中的灰色人形从左到右依次对应 `<Picture 1>`、`<Picture 2>`」，
   且 `--reference` 的顺序必须与这句逐位一致——错位 = 主客体对调。
2. **动作 / 运镜锁定用中性句**：「人物动作、走位与镜头运动严格跟随 `<Video 1>`」。
   只想跟动作不跟镜头就写「镜头由画面需要决定」。
3. **画风隔离**：「不参考 `<Video 1>` 的画风、色彩、材质与背景」——白模是灰模渲染，
   不写这句会出灰片。
4. **场景一句话**（可选）：光线、地点、氛围。

**最重要的一条：提示词里绝不描述任何具体动作**（不要写「主角挥手」「转身跑开」）。
真机实测：一旦文字里出现了与参考视频不一致的动作，模型**听文字不听视频**——首单成片
跟了文字、丢了参考里的群兵登阶与镜头后拉。动作的唯一真相源是 `<Video 1>`。

### 硬约束速查（都在计费前判定，违反即拒不扣钱）

| 约束 | 数值 | 违反后果 |
|---|---|---|
| 参考视频只有 `ref2v` 吃 | — | 挂 `i2v` / `flf2v` / `avatar` 直接 400（别的链路不透传，放行=付了钱拿回一条无关的片） |
| 段数上限 | 3 段 | 上游只有三路参考视频通道 |
| **模型必须声明参考视频能力** | — | 否则 400 `model_unsupported`。看 `dj models` 每条的「视频」行：`视频N` 为 0 的不能用（目前本地 MiniMax H3 与 Seedance 2.0 系声明了；白模换角只在 H3 真机验证过） |
| 必须是视频资产 | assetId | 图片 / 音频资产 → 400 |
| 每段时长可确认、且不超模型上限 | 本地 H3 单段 ≤15s | 时长取自资产真实字节（不收申报值）：解析不出 → 422 `asset_unresolved`；超上限 → 400，**先裁剪或拆镜** |
| 与数字人 `params.motionVideo` 互斥 | — | 两个都给 400：那是数字人的**命令式驱动源**（逐帧跟随），这里是**参考素材**（模型自行取用），两条链路互不相通 |
| `ref2v` 仍要 ≥1 张参考图 | — | 只给白模不给定妆照照常 400——「长相」这一半没人提供 |
| `blockout` 源片字段 | `params.sourceVideo` | 写成 `params.video` 会被当缺输入拒掉；`sourceVideo` / `mode` / `keepAudio` 挂别的粒度也是 400 |

### 还有四件要提前知道的事

- **输出时长按参考视频取大**：白模片比你选的 `durationSec` 长时，出片与计价都按白模
  长度走（不取大的话素材后半段会被静默截掉）。想省钱就先把原片裁到需要的那几秒再转白模。
- **参考视频是重成本，不是顺带**：实测 8 秒参考视频让同 seed 推理从 59s 涨到 279s
  （4.7×），实扣也会另计输入秒。别把整段原片扔进去只为用其中 3 秒。
- **`mode` 缺省 `clay_masked`（人物浅灰、背景深灰）**——真机判定只有它能稳定驱动人物动作；
  `clay` 纯深度粘土留给「只要场景几何」的场合。`keepAudio` 缺省关：白模只作动作参考时
  音轨无用，开了只是徒增转存体积。
- **`blockout` 不消费** `prompt` / `aspectRatio` / `resolution` / `durationSec`：
  画幅、帧率与时长全部跟随源片。这几个键传了**不报错、也不生效**（只有拼错的键才 400），
  别指望靠它们改白模的画幅或时长。产物是普通视频资产，落卡与取件与 `i2v` 完全一致；
  它也能出现在 `dj assets list --mime video` 里，之后随时可复用为别的角色的参考。

