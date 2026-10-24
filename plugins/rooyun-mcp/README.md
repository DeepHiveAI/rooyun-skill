# RooYun MCP

把 [RooYun](https://www.rooyun.com/?utm_source=github&utm_medium=plugin-readme) 的远程 MCP 服务（`https://www.rooyun.com/api/mcp`）接进 Claude Code：建项目和画布、读剧本出结构、报价、生成图片视频、质检、下载产物、查账。

- 安装时按提示填入 RooYun API 令牌（在 https://www.rooyun.com/profile#api 创建）。令牌保存在系统安全存储里，不写进配置文件。
- 生成会消耗 RooYun 积分。服务端会把「先报价、等确认」的工作流纪律下发给客户端，建议同时在令牌上设置消费上限。
- 需要上传本地素材、批量下载或本地拼接成片时，改用 `rooyun` 或 `rooyun-cli` skill 插件：远程 MCP 读不到你电脑上的文件。

## 安装

```bash
claude plugin marketplace add DeepHiveAI/rooyun-skill
claude plugin install rooyun-mcp@rooyun
```

Connects Claude Code to the RooYun remote MCP server so any session can create canvases, break down scripts, quote and run image or video generation, check results and download assets. You enter your RooYun API token once when installing.

隐私政策：https://www.rooyun.com/privacy · 用户协议：https://www.rooyun.com/terms
