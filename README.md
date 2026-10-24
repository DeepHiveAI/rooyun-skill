# RooYun Skill & MCP

让 Claude Code、Codex、Cursor 等 AI 编程助手，用一句话驱动 [RooYun](https://www.rooyun.com/?utm_source=github&utm_medium=readme)：AI 漫剧与 AI 短剧的创作工作台。

> 「把这个剧本做成分镜工程」→ Agent 在 RooYun 里建好项目，拆出角色、场景、道具和分镜卡片，报价后生成分镜图和视频，产物自动落回画布。

产出不是一堆散文件，而是**一张你可以接着手工编辑的无限画布**。

[English](README.en.md) · [Agent 接入说明](https://www.rooyun.com/developers?utm_source=github&utm_medium=readme) · [AI 漫剧教程](https://www.rooyun.com/learn?utm_source=github&utm_medium=readme)

---

## 选一种接入方式

最简单的做法是按官网 [Agent 接入](https://www.rooyun.com/developers?utm_source=github&utm_medium=readme) 页操作：把那一页发给你的 AI 编程助手，它会自己装好、自己登录。下面是同样的几种方式，前两种直接从官网安装，不需要 GitHub。

| 方式 | 适合谁 | 怎么用 |
|---|---|---|
| **远程 MCP** | Claude Code、Cursor、Cline 等 MCP 客户端 | 填一个 URL 和一枚令牌 |
| **从官网安装 Skill** | Claude Code、Codex、WorkBuddy 等任何有 shell 的 Agent | 一条命令下载解压 |
| **Claude Code 插件**（可选） | 想用插件方式管理、随插件更新的 Claude Code 用户 | 从本仓库安装，内容与官网下载一致 |

### 1. 远程 MCP

服务地址：`https://www.rooyun.com/api/mcp`（Streamable HTTP），鉴权头 `Authorization: Bearer <令牌>`。令牌在 [个人中心 → API 访问](https://www.rooyun.com/profile#api) 创建。

```bash
claude mcp add --transport http rooyun https://www.rooyun.com/api/mcp --header "Authorization: Bearer <你的令牌>"
```

Cursor、Codex、Cline、Cherry Studio 等客户端的配置见 [docs/mcp-clients.md](docs/mcp-clients.md)。

### 2. 从官网安装 Skill

Skill 比 MCP 多了本地脚本：能上传本地素材、批量下载产物、在本地拼接成片。有完整版和精简版，**二选一安装**（两者都会响应「用 RooYun 生成…」，同时装会抢着触发）：

- **完整版 `rooyun`**：按「剧本 → 角色/场景/道具 → 分镜 → 定嗓 → 生成」的固定流程搭工程，带 15 条工作流纪律。
- **精简版 `rooyun-cli`**：只给能力地图，提示词和先后顺序由你决定，提示词原样提交。

```bash
# 完整版（精简版把地址换成 "https://www.rooyun.com/api/skill/bundle?variant=cli"）
curl -fL "https://www.rooyun.com/api/skill/bundle" -o rooyun-skill.zip
mkdir -p ~/.claude/skills
unzip -o rooyun-skill.zip -d ~/.claude/skills
```

装好后重启 Claude Code，对它说「登录 RooYun」：它会运行登录命令并打开浏览器，你在 RooYun 页面点一次「授权」即可，令牌保存在本机 `~/.rooyun/credentials.json`。之后用 `node ~/.claude/skills/rooyun/scripts/dj.mjs update` 更新。

Codex 等读 `AGENTS.md` 的工具：把 [`AGENTS.snippet.md`](plugins/rooyun/skills/rooyun/AGENTS.snippet.md) 粘进项目的 `AGENTS.md`。完整的安装、权限和环境变量说明见 skill 自带的 [README](plugins/rooyun/skills/rooyun/README.md)。命令行工具 `scripts/dj.mjs` 零依赖，需要 Node.js 18 或更高版本，macOS、Linux、Windows 通用。

### 3. Claude Code 插件（可选）

和官网下载的是同一份 Skill，区别只是用插件命令安装和更新：

```bash
claude plugin marketplace add DeepHiveAI/rooyun-skill
claude plugin install rooyun@rooyun        # 精简版：rooyun-cli@rooyun
```

更新：`claude plugin marketplace update rooyun`，再 `claude plugin update rooyun@rooyun`。

本仓库还提供 `rooyun-mcp` 插件，只接上面的远程 MCP，安装时按提示填入令牌（保存在系统安全存储里）。

也可以不装插件，直接把 [`plugins/rooyun/skills/rooyun/`](plugins/rooyun/skills/rooyun/) 整个目录拷进 `~/.claude/skills/`，效果和从官网安装一样。

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
