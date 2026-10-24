# RooYun Skill & MCP

让 Claude Code、Codex、Cursor 等 AI 编程助手，用一句话驱动 [RooYun](https://www.rooyun.com/?utm_source=github&utm_medium=readme)：AI 漫剧与 AI 短剧的创作工作台。

> 「把这个剧本做成分镜工程」→ Agent 在 RooYun 里建好项目，拆出角色、场景、道具和分镜卡片，报价后生成分镜图和视频，产物自动落回画布。

产出不是一堆散文件，而是**一张你可以接着手工编辑的无限画布**。

[English](README.en.md) · [Agent 接入说明](https://www.rooyun.com/developers?utm_source=github&utm_medium=readme) · [AI 漫剧教程](https://www.rooyun.com/learn?utm_source=github&utm_medium=readme)

---

## 选一种接入方式

| 方式 | 适合谁 | 怎么用 |
|---|---|---|
| **Claude Code 插件**（推荐） | 用 Claude Code 的人 | 两条命令装好，以后随插件更新 |
| **手动安装 Skill** | Codex、WorkBuddy 等任何有 shell 的 Agent | 把 skill 目录拷进技能目录 |
| **远程 MCP** | Cursor、Cline、Cherry Studio 等 MCP 客户端 | 填一个 URL 和一枚令牌 |

### 1. Claude Code 插件

```bash
claude plugin marketplace add DeepHiveAI/rooyun-skill
claude plugin install rooyun@rooyun
```

装好后对 Claude 说「用 RooYun 把这个剧本搭成画布工程」。第一次使用时，它会运行登录命令并打开浏览器，你在 RooYun 页面点一次「授权」即可，令牌保存在本机 `~/.rooyun/credentials.json`。

本仓库提供三个插件，**`rooyun` 和 `rooyun-cli` 二选一**（两者都会响应「用 RooYun 生成…」，同时装会抢着触发）：

| 插件 | 内容 |
|---|---|
| `rooyun` | 完整版：按「剧本 → 角色/场景/道具 → 分镜 → 定嗓 → 生成」的固定流程搭工程，带 15 条工作流纪律 |
| `rooyun-cli` | 精简版：只给能力地图，提示词和先后顺序由你决定，提示词原样提交 |
| `rooyun-mcp` | 只接远程 MCP 服务，安装时填入令牌，适合想用 MCP 工具而不是 skill 的人 |

更新：

```bash
claude plugin marketplace update rooyun
claude plugin update rooyun@rooyun
```

### 2. 手动安装 Skill

Skill 在 [`plugins/rooyun/skills/rooyun/`](plugins/rooyun/skills/rooyun/)（精简版在 [`plugins/rooyun-cli/skills/rooyun-cli/`](plugins/rooyun-cli/skills/rooyun-cli/)），把整个目录拷进你的技能目录：

```bash
git clone https://github.com/DeepHiveAI/rooyun-skill.git
mkdir -p ~/.claude/skills
cp -R rooyun-skill/plugins/rooyun/skills/rooyun ~/.claude/skills/
node ~/.claude/skills/rooyun/scripts/dj.mjs login
```

Codex 等读 `AGENTS.md` 的工具：把 [`AGENTS.snippet.md`](plugins/rooyun/skills/rooyun/AGENTS.snippet.md) 粘进项目的 `AGENTS.md`。完整的安装、权限和环境变量说明见 skill 自带的 [README](plugins/rooyun/skills/rooyun/README.md)。

命令行工具 `scripts/dj.mjs` 零依赖，需要 Node.js 18 或更高版本，macOS、Linux、Windows 通用。

### 3. 远程 MCP

服务地址：`https://www.rooyun.com/api/mcp`（Streamable HTTP），鉴权头 `Authorization: Bearer <令牌>`。令牌在 [个人中心 → API 访问](https://www.rooyun.com/profile#api) 创建。

```bash
claude mcp add --transport http rooyun https://www.rooyun.com/api/mcp --header "Authorization: Bearer <你的令牌>"
```

Cursor、Codex、Cline、Cherry Studio 等客户端的配置见 [docs/mcp-clients.md](docs/mcp-clients.md)。

---

## 能做什么

- **搭工程**：建项目和画布，建角色设定板、场景卡、道具板、分镜视频卡，连线、改卡、自动布局。
- **读剧本出结构**：剧本拆成角色、场景、道具和逐镜分镜，改完再落回画布。
- **生成内容**：文生图、图生图、图生视频、首尾帧、参考图生视频、数字人口播、配音、音乐、音效、视频高清、视频转白模，产物自动落回指定卡片。
- **角色一致性**：定妆照作为参考图贯穿全剧；试镜定嗓，同一角色全剧一把嗓子。
- **白模换角**：把一段现成视频转成白模，再让新角色复刻它的动作、走位和运镜。
- **对标分析**：解析一条参考视频的分镜结构和叙事功能，改编成同结构、不同内容的新段落。
- **选题情报**：读每日选题简报、订阅对标博主看增速、检索文案库里的爆款写法。这一类只读，不扣积分。
- **取产物和对账**：批量下载、完整性核对、查余额和账单。

做不到的事情（比如用 API 直接拼出成片）在 [SKILL.md](plugins/rooyun/skills/rooyun/SKILL.md) 开头写明了，Agent 会提前告诉你。

## 计费与安全

- 生成类操作会消耗 RooYun 积分。**skill 要求 Agent 每次生成前先报价，等你确认后才提交**；批量生成带幂等键，重试不会重复扣费。
- 令牌只由 `dj.mjs` 自己读写，Agent 不接触明文。可以在 [个人中心](https://www.rooyun.com/profile#api) 随时查看、设消费上限或吊销。
- 价格以生成前显示的为准，可在 [价格说明](https://www.rooyun.com/learn/pricing?utm_source=github&utm_medium=readme) 查看计费方式。

## 仓库结构

```
.
├── .claude-plugin/marketplace.json   # Claude Code 插件市场清单
├── plugins/
│   ├── rooyun/                       # 完整版 skill 插件
│   ├── rooyun-cli/                   # 精简版 skill 插件
│   └── rooyun-mcp/                   # 远程 MCP 插件
├── server.json                       # MCP Registry 登记信息
├── docs/mcp-clients.md               # 各 MCP 客户端配置
└── examples/                         # 示例剧本与提示词
```

## 关于这个仓库

- 本仓库由 RooYun 主仓库自动同步生成，skill 内容与 `https://www.rooyun.com/api/skill/bundle` 下载到的完全一致。
- 欢迎提 Issue 和 PR。PR 会由维护者手工合回主仓库，再随下一次同步出现在这里，所以合并后不会立刻显示为「已合并」。
- 远程 MCP 服务端和 RooYun 平台本身不在本仓库中。

## 许可证与商标

代码和文档以 [MIT 许可证](LICENSE) 发布。

「RooYun」名称和 logo 是 RooYun 的商标，不在 MIT 授权范围内。你可以修改和再分发本仓库的代码，但请不要以 RooYun 的名义发布修改版，或让人误以为是官方版本。
