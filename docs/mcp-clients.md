# 各 MCP 客户端接入 RooYun

RooYun 的远程 MCP 服务：

- 地址：`https://www.rooyun.com/api/mcp`
- 传输：Streamable HTTP（无状态，不使用服务端推流）
- 鉴权：请求头 `Authorization: Bearer <令牌>`

令牌在 [个人中心 → API 访问](https://www.rooyun.com/profile#api) 创建，明文只显示一次。下面的 `<你的令牌>` 换成它；能用环境变量的客户端，建议把令牌放进 `ROOYUN_API_TOKEN`，不要写进会提交到 git 的文件。

生成类工具会消耗积分。MCP 服务在初始化时会把工作流纪律（先报价、等确认、幂等键）发给客户端，但最终是否遵守取决于客户端的模型。建议在令牌上设置消费上限。

## Claude Code

```bash
claude mcp add --transport http rooyun https://www.rooyun.com/api/mcp --header "Authorization: Bearer <你的令牌>"
```

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

## MCP 和 Skill 怎么选

- **Skill**（`rooyun` / `rooyun-cli` 插件）能力更全：上传本地素材、批量下载、本地拼接成片都靠 `dj.mjs` 在你的电脑上完成，远程 MCP 读不到你的本地文件。
- **MCP** 配置最简单，适合不能跑 shell 命令的客户端。
- 两者用的是同一套开放 API 和同一份工作流纪律，同一个客户端里装一种就够了。
