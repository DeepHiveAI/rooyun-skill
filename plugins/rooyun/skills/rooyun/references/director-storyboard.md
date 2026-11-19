# 导演式拆镜（`dj storyboard-job`）与小说改剧本（`dj adapt`）

站内「剧本卡 → 拆镜头」用的就是这条流水线：先按戏型（对峙、打戏……）定导演手法，再把每场戏拆成
**场 → 片段 → 镜**。片段是生成单位（一段一张分镜视频卡，多镜切换由模型在一次生成里完成）。
旧的 `dj storyboard`（`POST /v1/analyze/storyboard`）**已弃用**，保留至少 30 天，新工程一律走这里。

## 整条链

```sh
# （可选）手上是小说：先改成分集剧本
dj adapt ./novel.txt --title "书名" --episode-sec 90 --pretty           # 只报价（不带 --yes）
dj adapt ./novel.txt --title "书名" --episode-sec 90 --yes --wait --out ./eps   # 用户确认后
#   → ./eps/ep01.txt、ep02.txt …（每集一份【剧本格式】文本）

# 导演式拆镜：一集一个作业
dj storyboard-job ./eps/ep01.txt --canvas "$CANVAS" --video-model "$VIDEO_MODEL" --aspect 9:16 --pretty   # 只报价
dj storyboard-job ./eps/ep01.txt --canvas "$CANVAS" --video-model "$VIDEO_MODEL" --aspect 9:16 \
  --yes --wait --out ./sb-ep01.json                                     # 用户确认后
#   中断了：dj storyboard-job get <jobId> --wait --out ./sb-ep01.json（免费重读）

# 落卡（见下文映射）→ 定嗓 → canvas lint → 报价 → 生成
```

- **不带 `--yes` 只报价**（带 `--dry-run` 同理）：未提交、未扣费。把报价告诉用户、等确认后加 `--yes` 再跑同一条命令。
- `--canvas`：服务端读这张画布上**已有**的角色 / 场景 / 道具设定卡，让镜头文字与之同名同貌。**只读，不落卡**。
  画布上还没有设定卡也照样能拆：结果的 `settings` 就是给你建板用的。
- `--video-model`：镜头按该模型的写法与单镜时长上限设计。用户没点名就用目录里 `default` 标记的视频模型（纪律 12）。
- `--aspect`：成片画幅（如 `9:16`），缺省不假设横竖。
- 幂等：dj 自动生成 `requestId` 并在 stderr 打出来；网络中断重试时原样带 `--request-id <同一个>`，不会重复建作业、重复扣费。

## 计费口径（以 dryRun 报价为准）

- **拆镜**按剧本去空白字数分档计价；报价 = **实扣上限**。提交时按报价预收，结论定下后：
  成功按「实际拆成镜头的字数」结算、差额原路退回；失败无结果 / 中断 / 取消整笔退回；
  失败但有部分结果按站内口径保留预收（内容只给节选，见下）。实付看 `charge.paidCredits` / `refundedCredits`。
- 超出计费上限时报价回 `overLimit:true`：按集拆开分别提交（小说改编的产物天然是逐集的）。
- **小说改编**报价给的是上限 `maxCredits`：按批冻结、按实际用量结算，总扣费不超过它；余额必须 ≥ `maxCredits` 才能开跑。
- 单价随平台价目调整：**别向用户报记忆里的数字**，每次以 `--dry-run` / 不带 `--yes` 的报价为准。

## 并发与失败

- **每账号同时最多 3 个拆镜作业**（与站内共用名额）。撞上返回 429 且 `meta.maxRunning`——处置是等在跑的作业结束，
  不是退避重试；多集剧本排队提交即可。
- 某一场没过结构核对时，流水线会**自动重跑这一场一次**；仍不过就**带标记交付**，不让整单失败：
  看 `result.scenes[].status`——`ok` 通过、`check_failed` 跑完但没过核对、`incomplete` 有阶段没跑完。
  非 `ok` 的场照样能落卡，但落卡前要把它们点名告诉用户（可改剧本这一场后单独重拆）。
- `result.issues[]`（码 + 场 / 镜 + 一句说明）是核对问题清单，`result.skipped[]` 是有意不拍的原文行（旁白注释等），
  都转述给用户，别静默吞掉。

## 结果结构（`storyboard-job get` 的 `data`）

| 字段 | 说明 |
|---|---|
| `status` | `running` → `done` / `failed` / `cancelled` / `discarded`（站内放弃） |
| `stage` / `progress` | 进度（`{phase, done, total}`，按场计） |
| `contentAccess` | `none`（还在跑 / 已取消）· `full`（完整）· `excerpt`（失败未付费的节选：片段 `text` 为空）——**`excerpt` 不能用来落卡** |
| `charge` | `{quotedCredits, status, paidCredits?, billableChars?, refundedCredits?}` |
| `result.settings` | `characters[]`（name / age / identity / look / bio / props / styleKeywords / expressions / shotInjection）、`scenes[]`（name / time / inOut / description / mood / group / palette）、`props[]`（name / description / material / era / wear / usage / exploded / scaleRef） |
| `result.scenes[]` | `{no, heading, type, typeName, status?, segments[]}`；`heading` 是场头（如「旧书店·日·内」） |
| `segments[]` | `{no, durationSec, text, refPick[], refRoles?[], shots[]}`：`text` 是**规范全文**（站内落卡写进视频卡的提示词就是它）；`refPick` 是参考对象名，**顺序即正文里「图1、图2…」的图号顺序**；`refRoles` 给每个名字的类别（character / prop / scene）与取舍档（lead > turning > supporting > scene > prop > other，模型参考图不够时按它保留） |
| `shots[]` | `{sec, cam, picture, endState, cast[], props[]}`：镜级明细，只供核对，**不是落卡单位** |
| `result.missingRefs[]` | `{name, kind?, desc?, segments?}`：剧本里出现、画布与设定里都没有的参考对象，要补建设定板 |

不给：导演阐述、手法包、系统提示词、失败原因码、模型用量与成本——这些是平台内部的，别向用户承诺能拿到。

## 落卡映射（`dj ops <canvasId>`）

顺序仍按纪律 10：**先设定板（并出图）→ 再分镜视频卡**。画布上已有同名设定卡的跳过。

1. `settings.characters[i]` → `createCharacterBoard { name, description: look, age, identity, bio, props, styleKeywords, expressions }`
2. `settings.props[i]` → `createPropBoard { name, description, material, era, wear, usage, exploded, scaleRef }`
3. `settings.scenes[i]` → `createCard { kind:"image", title: name, sceneOf: name, aspectRatio:"16:9", content: description（+「色调：palette.main；点缀：palette.accent」） }`
4. `missingRefs[i]`（`kind` 已知）→ 补建 `createCharacterBoard` / `createPropBoard`（`description: desc`）；`kind` 缺席的只提示用户、别猜类别。
5. 设定板逐板 `t2i` 出图（卡上提示词读回原样提交，纪律 11）——这是第一次报价。
6. 每场一批 `createStoryboard`，**每个 segment 原样作为 createStoryboard 的一张 shot 参数**：

   segment **原样**放进 `shots[].segment`，`prompt` 填同一份 `segment.text`（两者不一致判 400）；
   场级参数 `sceneStatus` 取 `scene.status`，`refLimit` / `durationRange` 取所选视频模型在 `dj models` 里的参考图上限与时长区间：

   ```jsonc
   {"op":"createStoryboard","params":{
     "kind":"video", "layout":"grouped", "sceneName":"<scene.heading>", "aspectRatio":"9:16",
     "sceneStatus":"<scene.status，缺席可不传>",
     "refLimit":<模型参考图上限>, "durationRange":{"min":<模型最短秒>,"max":<模型最长秒>},
     "shots":[{
       "title":"镜01-05",
       "prompt":"<segment.text 原样>",
       "segment":<result.scenes[i].segments[j] 整个对象原样>
     }]
   }}
   ```

   这样落出的视频卡与站内导演式落卡同款（`director-v1` 格式、镜级明细、按 `refPick` 连参考、`check_failed` 场标「需要检查」）。
   `durationSec` 不必传（服务端按逐镜秒数之和取整并夹到 `durationRange`）；连不上设定板的 `refPick` 名字会在 op 结果 `noop` 里点名。
   `contentAccess` 为 `excerpt` 的结果 `text` 为空，不能落卡。

   一场超过 30 段分批落，同一 `sceneName` 会复用同一引用坞与编组。**禁止**自拼 / 改写 `text`、禁止把 `shots[]` 逐镜落成视频卡。
   `dj storyboard-fall` 只认旧 `dj storyboard` 的产物形状，**不能**直接喂 storyboard-job 的结果。
7. 落完跑 `dj canvas lint "$CANVAS"`：op 结果 `noop` 点名的「没有设定板」的名字回到第 4 步补建。

## 与小说改编衔接

- `adapt get` 在 `done`（或 `canceled` 时已落的集）带 `script`：`script.episodes[i].text` 是逐集的【剧本格式】文本，
  与站内「放进画布」的剧本卡逐字同形。**推荐逐集喂给 storyboard-job**：单集篇幅小、失败可单集重来；
  合并的 `script.text` 长篇时会超过拆镜的 6 万字上限。`--out <目录>` 直接写成 `ep01.txt…`。
- 每集剧本也要先落成剧本文本卡（纪律 10 第 ① 步），再拆镜。
- 改编会在用户写作台里自动建一部小说 + 一部剧本，产物可以在站内接着改。
- `status:"paused"`（`pausedReason`：`user` 用户暂停 / `batch_failed` 某批失败 / `budget_exhausted` 余额不够下一批）：
  开放 API 不提供继续 / 重试，**请用户到站内写作台**（响应 `webPath`）处理；`failure.message` 原样转述。
- `qc[]` 是质检提示（「【严重】」「【警告】」分级），只供展示、不影响扣费，转述给用户。
- 选项：`--episode-sec` 60 / 90 / 120；`--density` brisk / standard / dense / condensed（不给 = 按原文自动判定）；
  `--genre-guide` 题材包 id（如 urban-revenge 都市逆袭、rebirth-revenge 重生复仇、xianxia 玄幻仙侠……，填错服务端回 400 并列出全集）。
