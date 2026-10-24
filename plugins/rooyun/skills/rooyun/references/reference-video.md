# 看懂一条参考视频：从「分段实现账」到可执行的画布

> RooYun Skill 参考文档 · 主文件：[SKILL.md](../SKILL.md)
> **何时读**：用户给了一条爆款/对标视频，要「照着它做一条」「换个产品/主播/垂类复刻」「拆一下它为什么火」

## 一句话原则

**看懂一条片子 = 说清它每一段在对观众做什么、靠什么做到、复刻时什么能换什么不能换。**
不是「这条视频很燃很有节奏感」——那是观感，不可复现。是「第 3 镜用一句反常识的话开信息缺口，
第 5–9 镜把痛点推到观众自己身上，第 15 镜产品带着证据物登场」——这是实现账，能照着做。

平台的 `reference-analyze` 已经把最重的活干了（切镜、转写、结构层 + 画面层两道多模态分析），
你拿到的是**逐镜头的结构化账本**。你的工作是三件：读懂它、写下它、把它变成画布。

## 第一步：拿账本

```sh
# 默认等到终态（5–15 分钟），stdout 是完整信封；--out 把 result.account 单独落成 JSON 方便反复读
dj reference-analyze "https://v.douyin.com/xxxx/" --out ./ref/account.json --timeline-md ./ref/TIMELINE.md
# 中断了就续查
dj reference-analysis <jobId>
```

一个账号可以 1 条在跑 + 最多 3 条排队：要拆多条对标就一次发完（用 `--no-wait` 拿 jobId），平台按账号串行消化，
每条 5–15 分钟；排队满时返回 409 `reference_job_active`，`meta.activeJobId` 是在跑的那条，`dj reference-analyze`
会自动转为等它（等完记得重发本条）。

拿到后**先看 `result.reliability` 与 `result.diagnostics`，再看内容**——这决定你能信到什么程度：

| 看什么 | 意味着什么 |
|---|---|
| `reliability.function.level` + `issues[]` | 由可计算信号算出：hook 不在开头、turn 在前 10% 或多于 3 个、cta 不在尾部、连续 escalate 过长、结构层缺坏段占位、后段敷衍、未经画面确认的 proof。`issues` 逐条说该复核哪几段——**先复核这些段，其余功能序列拿来看骨架**。上限只到 `medium`：没有人工标注基准 |
| `reliability.dimensions[]` 某维度 `signal: "low-signal"` | 这个维度从不进 adaptable、却在 > 70% 的段里被标 preserve——模型对它一刀切、没有区分力（`vertical` 常见如此）。「换主播能不能做」这类判断别只看 `presenter` 的 preserve 计数，先看它是不是 low-signal；`unassessed` = 模型两边都没提过这个维度 |
| `reliability.proofUnverified[]` | 判了 proof 但该镜没有画面描述——证据物只凭台词。生产里帧预算只覆盖约 12–16 个镜，这个列表常常不空；**复刻前亲自看这几秒**：`dj reference-frames <jobId> --shots 15,17,18`（一条命令把这几镜拼成一张网格图） |
| `reliability.dialogue` | `timed` 逐镜台词可靠 / `untimed` 只有全文、逐镜 `dialogue` 不可用 / `none` 无人声 |
| `segments[].sourceSpans` | 这一段由哪几个原始切镜合并而来（无帧短镜并入相邻有帧镜后才有）；要对回原片镜号/秒数就用它 |
| `transcriptSource: "dashscope"` | 台词按镜归属可靠，`dialogue` 能直接用 |
| `transcriptSource: "whisper"` | 台词没有时间戳，各镜 `dialogue` 全空；结构层看过全文所以 `function/intent` 仍可信，但「这句话在哪一镜说的」你得自己听片确认 |
| `shotsWithoutFrames: [...]` | 这些镜头没有画面证据（帧预算覆盖不到），`visual` 为空、`confidence` ≤ 0.4——**不是缺陷，是系统拒绝编造**。要描述它们就自己去看这几秒。没有帧的短镜（< 3 s）已并入相邻有帧镜头（每镜最多吸收 4 s；`rawShotCount` 是合并前的镜数），首镜 hook 基本都有帧 |
| `visualFailures: [...]` | 有帧但画面层调用失败的镜头，同上处置 |
| `missingStructureIndices: [...]` | 结构层漏了的镜（用 `setup` 占位、`confidence` 0.1），要复核 |
| `structure.degeneration.flagged: true` | 后半段的 `intent` 明显变短/置信度滑坡，后半段要多疑 |

`spine` 是整片一句话骨架；`segments[]` 按镜号，每镜的字段语义见
[endpoints.md](endpoints.md) 的 `reference-analysis` 一行。

## 第二步：读懂它——用「功能序列」看片，不用「内容」看片

把 `segments[].function` 按顺序列出来，你会看到这条片子的**骨架**，例如：

```
hook hook setup setup escalate escalate escalate turn proof proof proof escalate turn proof proof cta close
```

问自己三个问题：

1. **钩子在哪、靠什么开的缺口**——看 `hook` 段的 `intent` 与 `dialogue`。是反常识陈述？数字悬念？未完成的承诺？
2. **张力怎么推上去的**——`setup → escalate → turn` 的节奏。连续多少段 escalate 才 turn？turn 打破的是哪个预期？
3. **证据物是什么**——`proof` 段的 `visual`。没有证据物的「proof」是可疑的（判据要求能指出证据物）。

`adaptable` / `preserve` 是复刻决策的直接输入：**换掉 preserve 里的维度，那一段的 function 就不成立了**。
所以「换主播」能不能做，看有多少段把 `presenter` 放在 preserve 里；「换产品」同理看 `product`——
但先查 `reliability.dimensions` 里该维度是不是 `low-signal`：是的话这个计数没有信息量，要你自己看片判断。

`confidence` 低的段别硬用——低置信本身是有用信息，说明帧稀疏或无人声，需要你亲自看那几秒（见下节）。

### 亲眼看画面：`dj reference-frames`

账本里的 `visual` 是平台侧模型看帧写的文字，而帧预算覆盖不到所有镜头。**凡是你要下判断的地方，
就自己看一眼**——这条命令在你本机抽帧并拼成一张网格图，配一份「格子 → 秒 → 镜号 → 台词」的图例：

```sh
# 复核 proofUnverified 那几镜：各取中点一帧，拼成概览图
dj reference-frames <jobId> --shots 15,17,18,21,22,23,25
# 看清某一镜里究竟发生了什么：按 2fps 密集抽这一镜
dj reference-frames <jobId> --shot 15 --fps 3
# 按台词定位（在账本 dialogue 里模糊匹配）
dj reference-frames <jobId> --around "兔血冻干"
# 按秒区间
dj reference-frames <jobId> --range 40-48
```

产物默认落 `./ref-frames/<jobId>/`：`tile.png`（网格图，**先看它**）、`tile.md`（图例）、`frame-NNN.png`、
`source.mp4`（原片，只下一次；直链数周失效，留着后续命令用 `--video` 复用）。

**看图的纪律**：图上看到的是**事实**，账本里的 `visual` 是**模型说的**；两者冲突时以你看到的为准，
并在 `ANALYSIS.md` 里注明「模型说 X，实际画面是 Y」。这正是「事实与推断分开」在这条链路上的落点。

## 第三步：写下来——三份文件，事实与推断分开

分析要能被下一个会话（或下一个人）直接接着用，所以落成文件，不留在对话里：

- **`ANALYSIS.md`**：整片模型。这条片子在对观众做什么、为什么有效、哪些系统贯穿全片（同一个人物？同一个证据物反复出现？）。
  写「它做了什么」时引用镜号与秒数；写「它为什么有效」时明确标出这是你的推断。
- **`TIMELINE.md`**：按镜号/时间的实现账。`--timeline-md` 会生成骨架（每镜一行：时间、功能、台词、画面、可换/必保），
  你在每镜下面补两样东西：**这一镜服务于哪句台词/哪个动作**，以及**复刻时保留什么、重设计什么**。
- **`PROGRESS.md`**：当前在做什么、还有哪几镜没看清、下一步。对话被打断后从这里续。

**纪律：看到的与推断的必须分开写。** `visual` 是模型看帧写的，你没看过帧之前它是「模型说」，不是「事实」；
对 `confidence` 低于 0.5 的镜头、以及 `reliability.proofUnverified` 里的每一镜，
先 `dj reference-frames <jobId> --shots …` 看过再决定信不信。

## 第四步：变成画布——按变换维度改编，再走既有流程

**先让平台改一版，再在它基础上打磨**——改编规则（哪段能换、哪段换了就垮）服务端会逐段执行，
比你逐条对照 `adaptable`/`preserve` 更不容易漏：

```sh
dj reference-adapt <jobId> --presenter "30 岁女兽医" --product "冻干鸡肉粒" \
  --brief "结尾改成关注引导" --duration 60 --script-md ./ref/SCRIPT.md
```

**拿到产物第一眼看 `verdict`，不是看台词写得好不好：**

- `adaptable`：这条参考片撑得起你的诉求，往下走。
- `strained`：**至少一个维度过半的段都拒绝更换**——这份产物会是自相矛盾的混合稿，
  别拿去用。`warnings[]` 已经点名是哪个维度，照它办：**换一条本来就符合新诉求的对标片，
  或者把那个维度从这次变更里去掉。**

真机实测的样子：拿一条萌宠（养猫）参考片要求改成养狗垂类，`vertical` 在 26/29 段是必保维度，
产物里 22 段仍在讲猫、只有 3 段讲狗，产品名一半兔血一半鸭肉。端点没错——它逐段照规则执行了，
错的是「拿一条结构建立在养猫之上的片子去改养狗」这个诉求本身。

**别只看 `conflictCount`**：它数的是**段**不是维度，同一段撞两个维度只记一次，
分不清「一个维度全线被拒」和「两个维度各拒一半」——前者该换片，后者该去掉那一个维度，处置正好相反。
逐维度的落点在 `dimensionOutcomes[]`（换了几段 / 被拒几段 / 拒绝率）。

`verdict` 是 `adaptable` 之后，再看这两处：

- **`conflicts[]` 非空的段**：你要求换的维度被这一段标成了「换掉就垮」，所以**没换**。
  告诉用户这件事，并说明这一段需要**重新设计**而不是替换——别假装改过了。
- **`diagnostics.fallbackIndices`**：模型漏写、按原片兜底的段号，那几段要你自己补。

产物本身：`adaptation.segments[]` 与参考片**一一对应**，`function`/`intent` 原样保留
（这就是「同一套结构」），`dialogue`/`visualBrief` 是新的。

`--script-md` 直接产出可粘进剧本文本卡的分段文案。下面这套人工对照规则仍然有效——
它是你复核平台改编结果、以及在没有 adapt 时手工改编的依据：

- 在 adaptable 里的维度：按用户诉求换，`function` 与 `intent` 原样保留（这就是「同一套结构，不同的片子」）。
- 在 preserve 里的维度：不换；用户坚持要换，就告诉他**这一段的功能会失效**，需要重新设计而不是替换。
- `dialogue` 在 preserve 里的段（钩子句、金句、CTA 指令）：改编时保留句式与信息缺口的位置，换名词不换结构。

## 第五步：验收——成片的结构真的复刻住了吗

片子做完，别只凭感觉说「像」。把**自己的成片**按同一套管线拆一遍，再与参考片做结构 diff：

```sh
# 成片在资产库里（画布产物或你上传的），拿它的 assetId 拆一遍
dj reference-analyze --asset <成片assetId>
# 拆完拿两个 jobId 对比（纯计算，不花钱）
dj reference-compare <参考片jobId> <成片jobId>
```

重点看两行：

- **`functionSequence.missing`**：参考片有、成片一次都没出现的功能。丢了 `proof` 就是把「证据」
  这一环整个漏了——这比一致率数字本身更有指导意义。
- **`preserveKept[].status: "dropped"`**：参考片标「换掉就垮」的维度，成片没当回事。

`verdict` 是提示**不是门禁**：它只比叙事结构，不比观感、画质、像不像同一个人拍的。
结构保住不等于片子好，结构跑偏也可能是你有意改的。**成片仍然要你亲自看完**——
这条纪律不因为有了机器判定而放宽。

---

改编完的结果是一份新的「段落清单」：每段的功能、意图、要说的话、要看到的画面。**这就是分镜的输入**——
接下来走 SKILL.md 北极星旅程第 2 步起的既有流程：剧本文本卡 → 角色/场景/道具板 → `createStoryboard kind:"video"`。
每一段的 `visual`（可复现的画面行为）就是那一镜提示词的画面部分，`intent` 帮你决定景别与节奏。

**边界**：这条链路只管「内容是什么」。字幕样式、转场、卡点、调色这些是剪辑工具的事，账本里没有、
你也不要往分镜里塞——出片后交给剪映。

## 常见误判

- **把 `visual` 空串当成失败去重跑**：不是。看 `shotsWithoutFrames`，那是帧预算问题，重跑结果一样。
- **把 escalate 串当成没结构**：口播带货片中段连续 5–10 段 escalate 是正常形态，看 turn 落在哪。
- **把没有证据物的段当 proof**：判据要求能指出证据物；模型偶尔仍会把口头断言判成 proof，`intent` 里没提到具体证据时降级看待。
- **拿主页链接来拆**：拆解对象是一条视频，主页链接会 400；要拆博主整体风格用 `creator-analyze`。
