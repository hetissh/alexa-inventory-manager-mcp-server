# VoiceOps MCP server

An MCP server that exposes the VoiceOps command/event engine (inventory, equipment, jobs, audited events) as tools, so Claude can act as the voice interface while Alexa, the Fire TV board and the dashboard are built later.

- Progress and next steps: [`CHANGELOG.md`](CHANGELOG.md)
- Architecture and build plan: [`docs/mcp-server-plan.md`](docs/mcp-server-plan.md)
- Engineering rules for contributors and AI assistants: [`AGENTS.md`](AGENTS.md)

**Status:** milestone M0. The server runs and exposes two diagnostic tools (`check-health`, `echo-message`). Business tools arrive in M1+.

## Prerequisites

- Node ≥ 22.12 (`.nvmrc` pins 24). Your default shell Node may be older: run `nvm use`.
- npm (a lockfile is committed).
- PostgreSQL 14+ is needed from M1 onwards, not for M0.

## Develop

```bash
nvm use
npm --prefix server-ts install
npm run local:gate        # typecheck + lint + tests (>= 90% per-file coverage) + build
```

Other scripts (run from `server-ts/` or via `npm --prefix server-ts run <name>`): `build`, `typecheck`, `lint`, `test`, `test:coverage`.

## Configuration

Environment variables (loaded by the host process; never commit real values):

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. Logs go to **stderr** only; stdout carries MCP JSON-RPC. |

To load a local `.env` (gitignored): `node --env-file=.env server-ts/dist/bin.js`.

## Connect it to Claude

Build first (`npm --prefix server-ts run build`). Always use an **absolute** Node path: Claude does not load nvm, so a bare `node` may resolve to an old version. On this machine a stable path is `/opt/homebrew/opt/node@24/bin/node`.

**Claude Code** (run from the repo root):

```bash
claude mcp add voiceops -- /opt/homebrew/opt/node@24/bin/node "$PWD/server-ts/dist/bin.js"
```

Add `--scope user` to make it available in every project. Check with `claude mcp list`, or `/mcp` inside a session.

**Claude Desktop**: edit `~/Library/Application Support/Claude/claude_desktop_config.json`, then quit and reopen the app:

```json
{
  "mcpServers": {
    "voiceops": {
      "command": "/opt/homebrew/opt/node@24/bin/node",
      "args": ["/ABSOLUTE/PATH/TO/REPO/server-ts/dist/bin.js"],
      "env": { "LOG_LEVEL": "info" }
    }
  }
}
```

Server logs for Claude Desktop appear in `~/Library/Logs/Claude/mcp-server-voiceops.log`.

**Try it:** ask Claude "Use the voiceops check-health tool" and "Use voiceops echo-message with 'hello'". `check-health` also reports which MCP client connected.

Rebuild (`npm --prefix server-ts run build`) and restart the client after any code change: clients keep the old process alive.

## Layout

```text
AGENTS.md  CHANGELOG.md  CLAUDE.md  README.md  package.json (delegates to server-ts)
docs/mcp-server-plan.md
server-ts/        TypeScript MCP server (src/, tests/)
service-py/       reserved by AGENTS.md for data/AI workloads; not created yet
```
