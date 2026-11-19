# 各 MCP 客户端接入 RooYun

RooYun 的远程 MCP 服务：

- 地址：`https://www.rooyun.com/api/mcp`
- 传输：Streamable HTTP（无状态，不使用服务端推流）
- 鉴权：OAuth 或令牌。支持 OAuth 的客户端（claude.ai 自定义连接器、Claude Code 等）只填地址，首次连接时在弹出的网页登录并点「授权」，可选权限、设消费上限；其它客户端用请求头 `Authorization: Bearer <令牌>`

令牌在 [个人中心 → API 访问](https://www.rooyun.com/profile#api) 创建，明文只显示一次。下面的 `<你的令牌>` 换成它；能用环境变量的客户端，建议把令牌放进 `ROOYUN_API_TOKEN`，不要写进会提交到 git 的文件。

生成类工具会消耗积分。MCP 服务在初始化时会把工作流纪律（先报价、等确认、幂等键）发给客户端，但最终是否遵守取决于客户端的模型。建议在令牌上设置消费上限。

## Claude Code

```bash
claude mcp add --transport http rooyun https://www.rooyun.com/api/mcp --header "Authorization: Bearer <你的令牌>"
```

也可以不带 `--header`，只填地址：首次连接时 Claude Code 会打开浏览器让你登录 RooYun 并授权（OAuth），令牌由它自己保存和刷新。

或者安装本仓库的 `rooyun-mcp` 插件，安装时按提示填入令牌（保存在系统安全存储里）：

```bash
claude plugin marketplace add DeepHiveAI/rooyun-skill
claude plugin install rooyun-mcp@rooyun
```

## Cursor

写进 `~/.cursor/mcp.json`（全局）或项目里的 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "rooyun": {
      "type": "http",
      "url": "https://www.rooyun.com/api/mcp",
      "headers": { "Authorization": "Bearer <你的令牌>" }
    }
  }
}
```

## Codex

写进 `~/.codex/config.toml`，令牌从环境变量读：

```toml
[mcp_servers.rooyun]
url = "https://www.rooyun.com/api/mcp"
bearer_token_env_var = "ROOYUN_API_TOKEN"
```

## Cline

在 Cline 的 MCP 设置（`cline_mcp_settings.json`）里添加。`type` 必须写成 `streamableHttp`，不写会按旧的 SSE 方式连接：

```json
{
  "mcpServers": {
    "rooyun": {
      "type": "streamableHttp",
      "url": "https://www.rooyun.com/api/mcp",
      "headers": { "Authorization": "Bearer <你的令牌>" },
      "disabled": false
    }
  }
}
```

## Cherry Studio 等图形界面客户端

新建 MCP 服务器，类型选 Streamable HTTP（各版本界面上的叫法可能不同），URL 填 `https://www.rooyun.com/api/mcp`，请求头添加 `Authorization`，值为 `Bearer <你的令牌>`。

## 验证连接

```bash
curl -s https://www.rooyun.com/api/v1/me -H "Authorization: Bearer <你的令牌>"
```

返回 `"ok": true` 和令牌的权限列表，说明令牌可用。

## 有哪些工具

连上之后客户端会通过 `tools/list` 拿到完整清单和每个工具的用法说明，这里只列分组：

| 分组 | 工具 |
|---|---|
| 账号与项目 | `whoami` `list_projects` `create_project` `create_canvas` `list_canvases` |
| 剧本分析 | `start_adaptation` `get_adaptation` `extract_from_script` `start_storyboard_job` `get_storyboard_job` `make_storyboard`（已弃用，改用 `start_storyboard_job`） `rewrite_text` |
| 搭画布 | `read_canvas` `read_node` `apply_canvas_ops` `get_character_voices` `set_character_voice` |
| 爆款复刻与剪映导出 | `analyze_video_for_recreation` `land_recreation` `export_jianying_draft` |
| 多轮创作会话 | `create_conversation` `list_conversations` `read_conversation` `send_message` `delete_conversation` |
| 模型与素材目录 | `list_models` `list_voices` `list_digital_humans` `caption_asset` |
| 体检、报价与生成 | `lint_canvas` `estimate_generation_cost` `start_generation` `start_remake` `list_generations` `get_generation` `cancel_generation` |
| 质检、局部重绘与取件 | `inspect_image` `create_edit_session` `get_edit_session` `list_assets` `get_asset_download_url` `get_wallet` |
| 素材上传与对账 | `create_upload` `complete_upload` `get_asset` `list_ledger` |
| 对标分析 | `resolve_douyin_url` `get_creator` `get_creator_video_report` `archive_creator_video` `analyze_creator` `get_creator_analysis` `analyze_reference` `get_reference_analysis` `adapt_reference` `compare_reference` `build_reference_template` |
| 文案库（需开通相应权益） | `search_copy_library` `get_copy_entry` `list_copy_jobs` `retry_copy_job` |

会扣积分的只有：提交生成、视频换人、剧本分析、小说改编、导演式拆镜、改写、会话每一轮、素材反推、爆款视频分析、博主分析、参考视频拆解。其余工具只读或只改画布。小说改编、导演式拆镜与视频换人都会先免费报价（`dryRun`），确认后才提交。

## 交互界面（支持的宿主）

> 尚未正式上线：界面还在原型确认阶段，下面是接入后的行为说明。

RooYun 的 MCP 服务端实现了 MCP Apps 扩展（规范 2026-01-26，`io.modelcontextprotocol/ui`）。支持它的宿主会在对话里直接显示交互卡片，不用离开对话：

| 卡片 | 出现在哪些工具的结果上 | 能做什么 |
|---|---|---|
| 报价审批卡 | `estimate_generation_cost` 和所有带 `dryRun` 报价的收费工具 | 看明细、合计、可用积分、令牌剩余额度和报价剩余有效时间。**你点了「确认」才会提交**，提交时自动带上报价凭证 `quoteId` |
| 结果卡 | `start_generation` `get_generation` `get_asset_download_url` | 看任务状态，刷新进度，预览和下载产物。失败时显示原因，以及是否已退回冻结的积分 |
| 音色候选卡 | `harvest_character_voices` | 逐个角色试听首镜切出的音色样本，点击绑定 |

各宿主的支持情况（以宿主官方公布为准）：

- **支持**：Claude（网页版、桌面版）、ChatGPT、VS Code GitHub Copilot、Cursor、Goose、Postman、MCPJam 等
- **不支持或未确认**：Claude Code（不支持），以及 Cline、Cherry Studio 等纯文本客户端

不支持的客户端拿到的还是原来的文字结果，用法和以前完全一样。卡片里的「确认」「绑定」只有你亲手点击才会生效，助手不能替你点。卡片不会联网，所有数据都由宿主从工具结果里转交给它。

## MCP 和 Skill 怎么选

- **Skill**（`rooyun` / `rooyun-cli` 插件）能力更全：批量下载、本地抽帧看片、本地拼接成片都靠 `dj.mjs` 在你的电脑上完成，远程 MCP 读不到你的本地文件。MCP 也能上传本地素材（`create_upload` 拿到直传地址，由客户端自己把文件 PUT 上去），前提是客户端能执行命令。
- **MCP** 配置最简单，适合不能跑 shell 命令的客户端。
- 两者用的是同一套开放 API 和同一份工作流纪律，同一个客户端里装一种就够了。
