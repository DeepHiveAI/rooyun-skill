# RooYun Skill & MCP

Drive [RooYun](https://www.rooyun.com/?utm_source=github&utm_medium=readme-en), an AI comic-drama and short-drama studio, from Claude Code, Codex, Cursor and other AI coding agents.

> "Turn this script into a storyboard project." The agent creates a RooYun project, breaks the script into character, scene, prop and shot cards, quotes the price, and after you confirm, generates storyboard images and video clips that land back on the canvas.

The result is not a pile of files. It is **an infinite canvas you can keep editing by hand**.

The skill content, prompts and canvas are in Chinese. Agents work fine with it in any language.

[中文说明](README.md) · [Agent access guide (Chinese)](https://www.rooyun.com/developers?utm_source=github&utm_medium=readme-en)

## Install

| Option | For | How |
|---|---|---|
| **Claude Code plugin** (recommended) | Claude Code users | Two commands, updates with the plugin |
| **Manual skill install** | Codex, WorkBuddy, any agent with a shell | Copy the skill folder |
| **Remote MCP** | Cursor, Cline, Cherry Studio and other MCP clients | One URL plus an API token |

### Claude Code plugin

```bash
claude plugin marketplace add DeepHiveAI/rooyun-skill
claude plugin install rooyun@rooyun
```

On first use the agent runs the login command and opens your browser. Click "授权" (Authorize) on the RooYun page once; the token is saved to `~/.rooyun/credentials.json`.

Install **either `rooyun` or `rooyun-cli`, not both**. `rooyun` is the full guided workflow (script → characters/scenes/props → shots → voices → generation). `rooyun-cli` is the free-form toolbox that sends your prompts verbatim. `rooyun-mcp` connects only the remote MCP server.

### Manual skill install

```bash
git clone https://github.com/DeepHiveAI/rooyun-skill.git
mkdir -p ~/.claude/skills
cp -R rooyun-skill/plugins/rooyun/skills/rooyun ~/.claude/skills/
node ~/.claude/skills/rooyun/scripts/dj.mjs login
```

`scripts/dj.mjs` has no dependencies and needs Node.js 18 or later.

### Remote MCP

Endpoint: `https://www.rooyun.com/api/mcp` (Streamable HTTP), header `Authorization: Bearer <token>`. Create a token at [Profile → API access](https://www.rooyun.com/profile#api).

```bash
claude mcp add --transport http rooyun https://www.rooyun.com/api/mcp --header "Authorization: Bearer <your-token>"
```

See [docs/mcp-clients.md](docs/mcp-clients.md) for Cursor, Codex, Cline and Cherry Studio.

## Billing and safety

Generation spends RooYun credits. The skill requires the agent to show a price quote and wait for your confirmation before every generation, and batch jobs use idempotency keys so retries are not charged twice. Only `dj.mjs` reads the token; you can set a spending cap or revoke it at any time.

## About this repository

This repository is synced automatically from the main RooYun repository; the skill files match `https://www.rooyun.com/api/skill/bundle` exactly. Issues and pull requests are welcome; maintainers port merged changes back to the main repository by hand. The MCP server and the RooYun platform are not part of this repository.

## License and trademark

Code and docs are released under the [MIT License](LICENSE). The "RooYun" name and logo are trademarks of RooYun and are not covered by the license. Please do not publish modified versions under the RooYun name.
