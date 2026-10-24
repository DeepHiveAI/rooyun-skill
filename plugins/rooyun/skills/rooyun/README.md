# RooYun Skill · 安装与配置

让 Claude Code / Codex / 任何有 shell 的编程 Agent 用自然语言驱动
[RooYun](https://www.rooyun.com)：建项目与无限画布、把剧本拆成角色/场景/分镜卡片、
调模型生成图片视频音频并自动落回卡片、把产物下载到本地。

产出不是一堆文件，是**一张用户可以接着手工编辑的画布**。

```
rooyun-skill/
├── SKILL.md            # 技能主文件：能力边界 + 登录 + 工作流纪律 + 北极星旅程 + 错误红线
├── references/         # 按需读的细节（主文件末尾有索引表指路，用到哪个读哪个）
│   ├── endpoints.md          # 端点速查 + 响应形状 + 能力词
│   ├── ops-vocabulary.md     # ops 词表 + 各卡型可改字段
│   ├── video-prompt.md       # 视频提示词书写规范（视频生成必读）
│   ├── voice-consistency.md  # 试镜定嗓，同一角色全剧一把嗓子（对白剧必读）
│   ├── blockout.md           # 白模换角
│   ├── assets-and-llm.md     # 素材上传 / 人工介入 / LLM 分析
│   ├── agent-conversations.md# 多轮 Agent 会话
│   ├── creator-analysis.md   # 博主分析 + 抖音视频拿到本地
│   ├── errors.md             # 错误处理详版
│   ├── local-compose.md      # 本地 ffmpeg 拼成片
│   └── reference-video.md    # 看懂一条参考视频：分段实现账 → 三份文件 → 改编落画布
├── scripts/
│   ├── dj.mjs          # 微型客户端 CLI（零依赖，Node ≥ 18）
│   └── download.mjs    # 批量下载 + 完整性报告
├── AGENTS.snippet.md   # Codex / 其他 Agent 的等价说明，可直接粘进你的 AGENTS.md
└── README.md           # 本文件
```

---

## 一、登录（推荐：一条命令 + 点一次「授权」）

不用手动建令牌、不用复制粘贴、不用配环境变量。装好 skill（见「三、安装」）后，让 AI 运行：

```sh
node ~/.claude/skills/rooyun/scripts/dj.mjs login
```

它会自动打开浏览器（没弹出来就点输出里的链接）：登录 RooYun → 点「授权」→ 完成。
AI 再运行一次 `dj.mjs login` 即拿到令牌，自动保存到本机 `~/.rooyun/credentials.json`
（权限 0600；Windows 在 `C:\Users\<你>\.rooyun\`）。**以后每次新会话都自动可用**，macOS / Windows / Linux 同一套。

签出的令牌：全部权限、不设消费限额（仍受钱包余额约束）、365 天有效。
随时可在 <https://www.rooyun.com/profile#api> 查看、改限额或吊销；`dj.mjs logout` 清掉本机凭据。

> **API 访问对所有已登录账号开放**，不需要邀请资格（仅被封禁账号不能授权）。

### 手动创建令牌（备选）

想自己控制权限范围和限额时，到**个人中心 → 配置 → API 访问**（<https://www.rooyun.com/profile#api>）
点「新建令牌」。表单已预填默认值（名称、全选权限、限额 0 = 不限制、90 天），直接点创建即可；
明文只显示一次，用「二、配置环境变量」的方式交给脚本。

### 该勾哪些权限

| Scope | 界面标签 | 什么时候需要 |
|---|---|---|
| `canvas:write` | 画布写入 | 建项目/画布、建卡、连线/断线、改卡、删卡、布局 |
| `projects:read` | 项目读取 | 读项目清单、画布结构与单卡详情（**不含**资产清单） |
| `assets:read` | 资产读取 | 读资产元数据、项目资产清单、下载产物 |
| `assets:write` | 资产写入 | 上传本地图片/视频/音频到自己的资产库 |
| `tasks:read` | 任务查询 | 轮询生成任务状态 |
| `generate` | 提交生成 | 成本预检、提交生成、取消（**唯一会花钱的 scope**） |
| `billing:read` | 账单读取 | 钱包余额与账单流水 |
| `creators:read` | 博主分析读取 | 解析抖音链接、发起博主分析、读画像与转写全文（**不花钱**） |
| `llm` | 模型调用 | 读剧本出结构、改写文案、图文打标、多轮 Agent 会话（**拆解类扣积分**） |
| `radar:read` | 选题雷达读取 | 读订阅的博主、作品与增速、热榜、每日选题日报（**不花钱**） |
| `radar:write` | 选题雷达写入 | 订阅/退订对标博主 |
| `copy:read` | 文案库读取 | 检索别人的爆款口播是**怎么写的**（钩子/结构/CTA），看提取队列进度 |
| `copy:write` | 文案库写入 | 手动导入一条文案、重试失败的提取 |
| `brief:read` | 选题简报读取 | 读每日频道简报：选题 + 可执行性判断 + 对标参考（**不花钱**） |
| `brief:write` | 选题简报写入 | 手动重建当日简报 |

`assets:write` 只让你**往自己的资产库里加东西**：不能删、不能改已有资产
（内容寻址的对象不可变），也不能把资产挂到卡片上（那要 `canvas:write`）。
模型目录 `dj models` 与音色目录 `dj voices` **任何有效令牌都能读**，不需要额外勾权限。

只搭画布不取产物，就别勾「资产读取」。注意 `projects:read` **不覆盖**资产清单——
`GET /v1/projects/{id}/assets` 要的是 `assets:read`。

最后六个（`radar:*` / `copy:*` / `brief:*`）是**选题情报**那条链，与搭画布互不依赖：
只想「今天做什么选题」可以只勾这几个，一张画布都不建；只搭画布则完全不用勾。
三个 read 权限都**不花钱**——它们读的是平台已经替你采集好的数据。

博主分析的**转存原片**是个例外：它要 `assets:write`（写资产、占存储），
而把文件取回来要 `assets:read`——**两个都得勾**，只勾前者会「转存成功但下载 403」。
漏勾了不必重建：到 `/profile#api` 点该令牌的「编辑」补上即可，下一次调用即时生效（设备授权签出的令牌默认已含全部权限）。

要作废时在列表里点「吊销」，**即时生效且不可撤销**，正在用该令牌的脚本会立刻收到 401。

---

## 二、配置环境变量（可选，用了 `dj login` 就不需要）

CI、容器、密钥管理器注入等场景可以改用环境变量，它的优先级**高于**本机凭据文件：

```sh
export ROOYUN_API_TOKEN=dj_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   # macOS / Linux
# Windows PowerShell：$env:ROOYUN_API_TOKEN = "dj_pat_…"；持久化用 setx ROOYUN_API_TOKEN "dj_pat_…"
export ROOYUN_API_BASE=https://www.rooyun.com   # 可选；默认就是它
```

旧名 `DUANJU_API_TOKEN` / `DUANJU_API_BASE` **仍然可用**（新名优先），
改名前配好的环境变量不必改动。

**不要**把令牌写进项目文件、`.env`（除非它已在 `.gitignore` 里）、脚本或任何会被 commit 的地方。
脚本永远不会打印它。

验证：

```sh
node rooyun-skill/scripts/dj.mjs me --pretty
```

看到 userId / 权限 / 限额就说明通了。

---

## 三、安装

### Claude Code

放进个人技能目录（对所有项目生效）：

```sh
mkdir -p ~/.claude/skills
cp -R rooyun-skill ~/.claude/skills/rooyun
```

或只对某个项目生效：

```sh
mkdir -p .claude/skills
cp -R rooyun-skill .claude/skills/rooyun
```

重开一个 Claude Code 会话即可。说「用 RooYun 把这个剧本搭成画布工程」之类的话就会触发。

装完让 AI 运行 `node ~/.claude/skills/rooyun/scripts/dj.mjs login`，在弹出的页面点「授权」，就接好了。

### 精简版：CLI 自由模式（`rooyun-cli`）

本包是**完整版**：按「剧本 → 角色/场景/道具 → 分镜 → 定嗓 → 出片」的固定顺序搭工程，
有 15 条工作流纪律（提示词由平台编译、分镜视频卡只能由分镜派生……）。
如果你想**自己写提示词、自己定顺序、想先出哪张图就出哪张**，装精简版：

```sh
curl -fsSL -o /tmp/rooyun-cli.zip "https://www.rooyun.com/api/skill/bundle?variant=cli"
unzip -o /tmp/rooyun-cli.zip -d ~/.claude/skills    # 落点 ~/.claude/skills/rooyun-cli/
```

精简版只保留四条护钱包/护密钥的铁律（先报价再生成、幂等键防重复扣费、令牌不碰明文、按建议间隔轮询），
其余是一张「想要什么 → 调哪条命令 → 产出什么」的能力地图，提示词逐字提交给模型。
脚本与完整版是同一份，`dj update` 会自动拉精简版的包。

**两个版本二选一安装**：描述都覆盖「用 RooYun 生成…」，同时装会抢着触发。
`dj doctor` 发现两份都在时会提示你只留一份。

### 更新

**每条 API 响应都带线上最新版本号**，本地落后时脚本会在 stderr 提醒一次。看到提醒就跑：

```sh
node ~/.claude/skills/rooyun/scripts/dj.mjs update --pretty
```

不需要令牌，也不必重启 Claude Code——SKILL.md 是会话内实时生效的，脚本从下次调用起用新版。
想先看看会做什么加 `--dry-run`，已是最新时想强制重装加 `--force`。

没有 `unzip` 的环境（多见于 Windows）会打印手工命令，不会假装成功。
也可以随时手工重跑安装命令，`unzip -o` 本身就是覆盖模式：

```sh
curl -fsSL -o /tmp/rooyun-skill.zip https://www.rooyun.com/api/skill/bundle
unzip -o /tmp/rooyun-skill.zip -d ~/.claude/skills
```

> 为什么不是自动更新：裸 skill 目录没有官方更新协议（Claude Code 只对 plugin 提供
> `plugin update`），而静默改写你机器上的文件、静默改变 Agent 的行为规则都不合适。
> 所以做成「自动发现 + 一条命令更新」。

### Codex / 其他 Agent

把 `AGENTS.snippet.md` 的内容粘进你项目的 `AGENTS.md`（或等价的长期指令文件），
并把 `scripts/` 放到 Agent 能执行到的位置。脚本零依赖，`node scripts/dj.mjs --help` 就能跑。

**这种装法的更新要多一步**：粘进 `AGENTS.md` 的是**快照**，不会随分发包更新——
`dj.mjs` 只能更新它自己那一份，改不动你已经粘出去的文字。所以：

1. `node <你放脚本的位置>/dj.mjs version` 看是否落后（脚本内嵌了版本号，
   即使同级没有 `SKILL.md` 也能自报；日常调用落后时也会在 stderr 提醒一次）；
2. 重新下载分发包：`curl -fsSL -o skill.zip https://www.rooyun.com/api/skill/bundle && unzip -o skill.zip`
3. 用新的 `scripts/` 覆盖旧的，**并把新的 `AGENTS.snippet.md` 重新粘一遍**。

第 3 步的后半段最容易漏——漏了的话脚本是新的、纪律还是旧的。
`dj update` 在这种布局下**会拒绝执行**并打印上面这几条命令（它不敢猜该覆盖哪个目录，
猜错就会在无关位置凭空造一个 `rooyun/`，而你真正在用的那份纹丝不动）。

---

## 四、命令行速查

```sh
# 用函数而不是变量：zsh 不对变量做单词拆分
dj() { node ~/.claude/skills/rooyun/scripts/dj.mjs "$@"; }

dj me --pretty                                  # 令牌自省：scope 与限额余量
dj models --capability i2v --pretty             # 模型目录与单价
dj voices --q 温暖少女 --pretty                  # 音色目录（配音前挑嗓子）
dj projects create "深夜便利店" --pretty         # 建项目（含首画布）
dj ops <canvasId> -f batch.json --pretty        # 执行 ops 批次（1–50 个，整批原子）
dj canvas list <projectId> --pretty            # 列项目下的全部画布（接着上次做，先跑这个）
dj canvas structure <canvasId> --pretty         # 读回结构（拿 version / nodeId / assetIds）
dj node <canvasId> <nodeId> --pretty            # 详读单卡（正文全文 / 可写参数 / 上下游）
dj upload ./ref.png --pretty                    # 上传本地素材换 assetId
dj precheck -f quote.json --pretty              # 报价（花钱前必做）
dj uuid                                         # 生成幂等键
dj generate --request-id <uuid> --model <id> --capability t2i \
   --params-json '{"prompt":"…"}' --canvas <c> --node <n>
dj task <taskId> --watch --pretty               # 轮询到终态（自带退避）
dj wallet --pretty ; dj ledger --token-id self --pretty

# 多轮 Agent 会话（服务端持有历史，你只持有 conversationId；每轮扣积分，先报价）
dj agents --pretty                              # Agent 目录：conversational / stagesPerTurn
dj chat new --agent agent.pet-rewrite --pretty  # 开一段会话（不扣钱；回执 meta 带一轮报价）
dj chat send <conversationId> --request-id <uuid> "再活泼一点" \
   [--attach-file a.txt,b.md] [--ref <artifactId>] [--regenerate] --pretty
dj chat history <conversationId> --after-seq <N> --pretty   # 增量拉历史
dj chat show <conversationId> --pretty          # 元信息 + 最近一轮全文（meta.estimatedTurnCredits = 一轮报价）
dj chats --pretty                               # 列会话（含网页端建的）——上下文丢了用它
dj chat delete <conversationId> --pretty        # 删掉整段会话（硬删、不可撤销，删前先跟用户确认）

# 博主分析：解析 → 发起（默认等到终态）→ 读画像/报告 → 按需取原片
dj creator-resolve "https://v.douyin.com/xxxxx/" --pretty
dj video-url "https://v.douyin.com/xxxxx/" --pretty      # 单条视频 → 视频直链，curl 下到本地做对标分析（不转存）
dj creator-analyze <secUid> --pretty             # 加 --no-wait 只提交不等
dj creator-analysis <jobId> --pretty             # 查一次进度
dj creator <secUid> --pretty                     # 账号画像 + 仿写提示词
dj creator-report <secUid> <videoId> --pretty    # 单条报告 + 转写全文
dj creator-archive <secUid> <videoId> --pretty   # 转存原片 → assetId
node ~/.claude/skills/rooyun/scripts/download.mjs --asset <assetId> --out ./out   # 取原片文件

node ~/.claude/skills/rooyun/scripts/download.mjs --project <projectId> --out ./out --pretty
```

默认输出是原始 JSON 信封（便于机器解析），加 `--pretty` 看人类可读版。
完整帮助：`dj.mjs --help`、`download.mjs --help`。

---

## 五、本地开发 / 私有部署

指向自己的实例即可（注意端口要对应你实际在跑的那个）：

```sh
export ROOYUN_API_BASE=http://127.0.0.1:3000
```

---

## 六、常见问题

**`403 insufficient_scope`** — 令牌缺该端点要求的权限。`message` 会点名是哪个 scope。
去 `/profile#api` 点该令牌的「编辑」勾上它，即时生效、不必重建；用 `dj login` 授权签出的令牌默认已含全部权限。

**`402 token_limit_exceeded`** — 这枚令牌的消费限额用尽，**和账户余额无关，充值不解决**。
去设置页调额度或换一枚令牌。它与 `402 insufficient_credits`（账户余额空了，去充值）
是两个完全相反的处置，别按状态码合并处理。

**下载拿到 0 字节 / 302 没跟随** — 手写 curl 时必须带 `-L`。签名地址只有 60 秒有效期。
用 `download.mjs` 就不用操心（它手动跟随且不会把令牌转发给存储域）。

**`asset_not_in_cloud`** — 不是 id 错了。RooYun 是本地优先架构，真相在用户浏览器里，
API 看到的是云端副本：没推上云的编辑、超 50 MB 的资产、还在上传队列里的，API 都看不见。
请用户在原设备打开画布让它完成同步，或直接导出。

**写入了但浏览器里看不到** — 用户已经开着的画布未必会自动发现 API 的写入（取决于站点版本），**让他刷新页面**最稳。
更好的做法是按 SKILL.md 的纪律 2，优先在 Agent 自己创建的画布上工作。

**机器可读契约** — `curl -s https://www.rooyun.com/api/v1/openapi.json`（OpenAPI 3.1，无需鉴权）。
要写自己的调用代码时以它为准。
