# 换人重演（`dj remake`）

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：用户要「把这段视频里的人换成我的角色，场景、动作、镜头都不动」时

## 它做什么、不做什么

- 把源视频里 **1–2 个人**换成你的角色，**场景、动作、走位、运镜全部保留**。≥3 人会被拒。
- **成片用源视频的原声**（按成片帧数截齐）：不是配音，也不是模型重建的声音。要换台词 / 换嗓子，
  出片后另配（t2a + 本地合成，见 [local-compose.md](local-compose.md)），别指望这一步改声音。
- 时长由源片决定：源片至少约 4 秒，超过 14 秒只取前 14 秒；不用传时长。
- 要「换人又换场景」走白模换角（[blockout.md](blockout.md)），那条路的声音由 `ref2v` 重新生成。

## 参考帧：要你先画好

参考帧 = **源视频的某一帧，把人换成目标角色之后的整帧图**（同构图、同背景、同姿势，只换人）。
站内应用页会替用户画；开放 API **不替你画**，也不签发站内那种「关键帧免单通行证」（请求里带通行证字段直接 400）——
参考帧按正常价自己生成：

```sh
# ① 源视频换 assetId（≤50MB）；在本机用 ffmpeg 抽出要钉的那一帧（第 0 帧或第 N 秒）
SRC=$(dj upload ./source.mp4 | jq -r '.data.assetId')
ffmpeg -ss 0 -i ./source.mp4 -frames:v 1 ./frame0.png
FRAME0=$(dj upload ./frame0.png | jq -r '.data.assetId')

# ② t2i + 参考图（源帧 + 角色设定图）画参考帧：提示词写清「保持图1的构图、背景、姿势与光线，
#    把画面中<左侧/中间/右侧>的人换成图2的角色」。先 precheck 报价、等用户确认（纪律 1）
dj precheck --model "$IMAGE_MODEL" --capability t2i --params size=<最低价档>
dj generate --request-id <uuid> --model "$IMAGE_MODEL" --capability t2i \
  --reference "$FRAME0,$CHARACTER_BOARD_ASSET" --params-json '{"prompt":"…","size":"<最低价档>"}'
dj task <taskId> --watch     # → 参考帧 assetId = $KEY0（看一眼：人换对了、构图没变，再往下走）
```

两个人时：两人同框就在**同一张**参考帧里都换掉；不同框就各画一张（两张参考帧在源片上至少隔 3 秒，
后一张里必须仍包含前一张换过的人）。最多 2 张。

## 提交

```sh
# 默认只报价（不带 --yes）：把「X 积分 / 成片 N 秒」告诉用户，等确认
dj remake --source "$SRC" --keyframe "$KEY0:0:1@0.5" --pretty
# 确认后：与 generate 一样必须带幂等键（dj uuid 现取并存下来，重试原样复用）
dj remake --source "$SRC" --keyframe "$KEY0:0:1@0.5" --yes --request-id <uuid> \
  --canvas "$CANVAS" --node "$VIDEO_NODE"      # 可选：定向落到一张空视频卡
dj task <taskId> --watch                         # 换人就是一条普通生成任务，查询 / 取消 / 失败退款都同 generate
```

`--keyframe <assetId>[:<帧位>[:<人物>]]`，可重复（最多 2 次）：

| 段 | 写法 | 含义 |
|---|---|---|
| 帧位 | `0`、`72`、`3.5s` | 这张参考帧取自源片的哪一帧：整数 = 第几帧（24fps，0 起），`3.5s` = 第 3.5 秒。缺省 0 |
| 人物 | `1@0.3`、`1@0.3+2@0.7`、`2@0.7,0.4` | `序号@x[,y]`：第几个被换的人（1 起）在这张参考帧画面里的位置，x 为水平（0 最左、1 最右），y 为垂直（0 最上，可省）；x 决定提示词里的「左 / 中 / 右」。多人用 `+` 连 |

只给一张参考帧时人物可省（默认 `1@0.5`：一个人、画面正中）；两张时每张都要写明人物。

```sh
# 两个人分别出现在第 0 帧与第 4 秒：第二张里两人都在
dj remake --source "$SRC" --keyframe "$KEY_A:0:1@0.3" --keyframe "$KEY_B:4s:1@0.3+2@0.7" --lip-sync
```

- `--lip-sync`：跟原声对口型（有对白的片子用）；缺省跟原片动作、不喂音频。
- `--canvas` 与 `--node` 必须成对。
- 完整请求体（字段同 OpenAPI `POST /v1/remakes`）可以用 `-f body.json` 传；`dryRun` / `requestId` 一律由
  `--dry-run` / `--yes` / `--request-id` 决定，文件里的会被忽略。
- 计费：按成片秒数计，**以报价为准**（回执 `credits`；`enabled:false` 表示平台未开计费、本单不扣积分）。
  余额不够照纪律 12 把「换备选 / 充值」摆给用户——换人只有一个档，没有低价备选时就只剩充值。
