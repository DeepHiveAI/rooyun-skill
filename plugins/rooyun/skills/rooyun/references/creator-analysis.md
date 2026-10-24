# 博主分析 · 抖音视频拿到本地

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：用户要拆解对标账号，或要把抖音链接下到本地看片时（纪律 15）

## 博主分析：把一个对标账号拆成可仿写的东西

用户丢来一条抖音链接说「照这个博主的风格来」，这一节就是那条路。产物有四样：
**账号画像与仿写提示词**、**逐条视频报告**、**ASR 转写全文**、**原始视频文件**。

### 完整流程

> ⚠️ **样本必须由你点名**（纪律 15）。抖音封了主页作品列表接口，服务端自动挑样本
> 那条路拿不到候选池、必然失败。所以 ① 拿 `secUid`、②' 逐条拿 `videoId`，缺一不可。

```sh
# ① 用博主主页链接拿 secUid（列表被封时仍回 200，videos 为空 + videoListUnavailable）
node scripts/dj.mjs creator-resolve "https://www.douyin.com/user/MS4wLjABAAAA..." --pretty

# ②' 向用户要 ≥2 条单条视频链接，逐条解析出 videoId
node scripts/dj.mjs creator-resolve "https://v.douyin.com/xxxxx/" --pretty   # → data.video.videoId

# ② 发起分析：点名 videoIds（默认等到终态；GPU 队列以分钟计，等半小时是正常的）
node scripts/dj.mjs creator-analyze MS4wLjABAAAA... 7xxxxxxxxxxxxxxxxxx 7yyyyyyyyyyyyyyyyyy --pretty
#   响应里的 skippedVideoIds = 你点名了但没进样本的，逐条带原因，要如实转告用户
#   不想等：加 --no-wait，之后用 creator-analysis <jobId> 查

# ③ 读账号画像：赛道、受众、叙事骨架、标题公式，以及 stylePrompt / replicationGuide
node scripts/dj.mjs creator MS4wLjABAAAA... --pretty

# ④ 逐条读报告与转写全文（videoId 取自上一步的 sampleVideoIds）
node scripts/dj.mjs creator-report MS4wLjABAAAA... 7xxxxxxxxxxxxxxxxxx --pretty

# ⑤ 需要原片时才转存（默认不转，转了才有；之后走资产域取文件）
node scripts/dj.mjs creator-archive MS4wLjABAAAA... 7xxxxxxxxxxxxxxxxxx --pretty
node scripts/download.mjs --asset <assetId> --out ./out   # 取文件走 download.mjs
```

拿到 `stylePrompt` 之后的正确用法：把它**当风格底子**，与用户自己的剧情需求合成新的
提示词去生成，而不是原样复制。画像描述的是「这个号怎么拍」，不是「你要拍什么」。

### 五条纪律

1. **读端点有归属门槛**：只能读**本账号发起过分析**的博主与视频。没分析过一律 404，
   与「不存在」同一个响应（防资源探测）。所以顺序永远是先 `creator-analyze`，再读。
2. **分析是异步的，而且慢**：单条视频的 GPU 处理硬超时就有 540 秒，整条链 30–60 分钟很正常。
   `creator-analyze` 默认帮你等；轮询间隔 15 秒起，**打得再密也不会更快**。
3. **`partial` 不是失败**（退出码 0）：逐条报告确实产出了、能读，只是成功样本不足 2 条或
   归纳步失败，没有账号画像。看 `succeededVideoIds` 拿到已成功的那些，别整批丢掉。
4. **同时只能跑一个分析**：GPU 是全站共享的单点，第二个请求会 409。等前一个到终态再发。
   ⚠️ 这个 409 的 `error.code` 是 `invalid_request`（历史包袱，与错误码表里「改参数、别重试」
   的处置**不符**）——按 `message` 识别它，正确处置是**等前一个任务结束后重试**，不是改参数。
5. **原片是 opt-in 的**：不调 `creator-archive` 就不会有任何第三方视频进你的资产库。
   转存要 `assets:write`、把文件取回来要 `assets:read`——**两个 scope 都得勾**，
   漏勾了让用户到 `/profile#api`「编辑」补上即可（`dj login` 签出的令牌默认全权限，不会缺）。

### 两条容易踩的坑

**① 主页作品列表拿不到，这是上游封锁不是故障。** `creator-resolve` 传博主主页链接会回
200 但 `videos: []`，并带 `videoListUnavailable: {reason:"blocked", message}`。
正确处置是拿着照样有效的 `creator.secUid`，去向用户要 ≥2 条单条视频链接（纪律 15）——
**不是**重试、**不是**报告「这个博主没有作品」。`video-url` 传主页链接同理。

**② 单条视频链接里没有 secUid。** 此时 `creator-resolve` 返回 `kind:"video"`，
`creator-archive <secUid> <videoId>` 因此走不通——这不是缺参数要补，而是走错了路：
只想把片子拿到本地就直接用 `video-url`；要发起分析则另外向用户要一次**博主主页**链接换 `secUid`。

`creator-resolve` 的响应里**默认没有播放地址**：抖音直链数周内就失效，读画像与报告只需要 `videoId`。
要把文件长期留在资产库走 `creator-archive`（服务端转存，之后用 `download.mjs --asset <assetId> --out ./out` 取）；
只是想**现在**把视频拿到本地看一眼，用下一节的 `video-url`，不占资产库。

---

## 把抖音视频拿到本地：链接进、直链出、自己下

用户丢来一条抖音链接说「帮我看看这条视频 / 分析一下这个博主最近在拍什么」，不需要发起
平台分析，一条命令拿到视频直链，`curl` 下到本地就能看片、抽帧、转写。**不转存、不花钱**。

```sh
# 单条视频：链接或整段分享口令都行 → 一条直链
node scripts/dj.mjs video-url "https://v.douyin.com/xxxxx/" --pretty

# 博主主页：⚠️ 当前拿不到列表（抖音封了这条上游腿），会回空列表 + videoListUnavailable
#   → 改为向用户要单条视频链接，逐条跑上面那条命令
node scripts/dj.mjs video-url "https://www.douyin.com/user/MS4wLjABAAAA..." --pretty

# 下载：裸 curl 即可，不需要任何防盗链头
curl -L --retry 3 -o 7xxxxxxxxxxxxxxxxxx.mp4 "<playUrl>"
```

拿到本地之后怎么用由你决定：直接看、`ffmpeg` 抽关键帧、送转写——这些都在你本机，
与 RooYun 无关。要让 RooYun 出结构化的账号画像和仿写提示词，才走上一节的 `creator-analyze`。

### 四条纪律

1. **直链拿到就下**：抖音 playUrl 数周内失效，不要存进配置、不要写进文档、不要当长期地址发给别人。
   下次要看重新 `video-url` 一次即可（解析免费）。
2. **主页作品列表当前拿不到**（2026-09-15 起）：抖音封禁了这个接口，响应会是空列表 +
   `videoListUnavailable: {reason:"blocked"}`。**这是上游封锁不是故障，重试没用**——
   如实告诉用户，并请他逐条把要看的视频「分享→复制链接」发过来。
   （即便将来解封，主页也只有最近约 40 条：游客态只开放第一页，「全部作品」从来拿不到。）
3. **别密集打**：解析走的是抖音接口，全站共享出口 IP。连续下载多条时每条间隔 2 秒；
   收到 502 `creator_upstream_failed` 或 503 退避 1–2 分钟再试，连续失败就停手。
4. **图文笔记不行**：链接指向图文笔记会 400（没有视频轨）。换一条视频链接。
5. **单条视频链接别走 `creator-archive`**：它的路径要 `secUid`，而单视频的解析结果里**没有** `secUid`
   （只有作者昵称），凑不出参数、也不必去博主主页找——用户要的是「把视频拿到本地」，`video-url` 一步到位。
   `creator-archive` 只服务「已在 RooYun 分析过、要把原片长期留在资产库」这一种情况。

---

