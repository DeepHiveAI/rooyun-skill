# RooYun Skill & MCP

Drive [RooYun](https://www.rooyun.com/?utm_source=github&utm_medium=readme-en), an AI comic-drama and short-drama studio, from Claude Code, Codex, Cursor and other AI coding agents.

> "Turn this script into a storyboard project." The agent creates a RooYun project, breaks the script into character, scene, prop and shot cards, quotes the price, and after you confirm, generates storyboard images and video clips that land back on the canvas.

The result is not a pile of files. It is **an infinite canvas you can keep editing by hand**.

The skill content, prompts and canvas are in Chinese. Agents work fine with it in any language.

[中文说明](README.md) · [Agent access guide (Chinese)](https://www.rooyun.com/developers?utm_source=github&utm_medium=readme-en)

## Install

The easiest way is the official [Agent access page](https://www.rooyun.com/developers?utm_source=github&utm_medium=readme-en) (Chinese): send that page to your AI coding agent and it installs and logs in by itself. The first two options below install straight from rooyun.com and do not need GitHub.

| Option | For | How |
|---|---|---|
| **Remote MCP** | Claude Code, Cursor, Cline and other MCP clients | One URL plus an API token |
| **Skill from rooyun.com** | Claude Code, Codex, WorkBuddy, any agent with a shell | One download command |
| **Claude Code plugin** (optional) | Claude Code users who prefer plugin-managed updates | Install from this repository; same content as the download |

### Remote MCP

Endpoint: `https://www.rooyun.com/api/mcp` (Streamable HTTP), header `Authorization: Bearer <token>`. Create a token at [Profile → API access](https://www.rooyun.com/profile#api).

```bash
claude mcp add --transport http rooyun https://www.rooyun.com/api/mcp --header "Authorization: Bearer <your-token>"
```

See [docs/mcp-clients.md](docs/mcp-clients.md) for Cursor, Codex, Cline and Cherry Studio.

### Skill from rooyun.com

The skill adds local scripts on top of the API: upload local assets, batch-download results and stitch clips locally. Install **either the full `rooyun` skill or the free-form `rooyun-cli`, not both**.

```bash
# Full version (for rooyun-cli use "https://www.rooyun.com/api/skill/bundle?variant=cli")
curl -fL "https://www.rooyun.com/api/skill/bundle" -o rooyun-skill.zip
mkdir -p ~/.claude/skills
unzip -o rooyun-skill.zip -d ~/.claude/skills
```

Restart Claude Code and ask it to log in to RooYun. It runs the login command and opens your browser; click "授权" (Authorize) once and the token is saved to `~/.rooyun/credentials.json`. `scripts/dj.mjs` has no dependencies and needs Node.js 18 or later.

### Claude Code plugin (optional)

Same skill as the download, installed and updated through Claude Code's plugin commands:

```bash
claude plugin marketplace add DeepHiveAI/rooyun-skill
claude plugin install rooyun@rooyun        # or rooyun-cli@rooyun
```

`rooyun-mcp` connects only the remote MCP server and asks for your token on install.

## Billing and safety

Generation spends RooYun credits. The skill requires the agent to show a price quote and wait for your confirmation before every generation, and batch jobs use idempotency keys so retries are not charged twice. Only `dj.mjs` reads the token; you can set a spending cap or revoke it at any time.

## About this repository

This repository is synced automatically from the main RooYun repository; the skill files match `https://www.rooyun.com/api/skill/bundle` exactly. Issues and pull requests are welcome; maintainers port merged changes back to the main repository by hand. The MCP server and the RooYun platform are not part of this repository.

## License and trademark

Code and docs are released under the [MIT License](LICENSE). The "RooYun" name and logo are trademarks of RooYun and are not covered by the license. Please do not publish modified versions under the RooYun name.
