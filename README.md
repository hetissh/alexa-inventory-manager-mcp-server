# VoiceOps MCP server

An MCP server that exposes the VoiceOps command/event engine (inventory, equipment, jobs, audited events) as tools, so Claude can act as the voice interface while Alexa, the Fire TV board and the dashboard are built later.

- Progress and next steps: [`CHANGELOG.md`](CHANGELOG.md)
- Architecture and build plan: [`docs/mcp-server-plan.md`](docs/mcp-server-plan.md)
- Engineering rules for contributors and AI assistants: [`AGENTS.md`](AGENTS.md)

**Status:** milestone M1 (core loop). Claude can look up stock, add or remove units with a full audit trail and idempotent retries, and read the activity log, against a local PostgreSQL database. Confirmation flows, more operations and the spreadsheet sync arrive in M2 and M3.

## Prerequisites

- Node ≥ 22.12 (`.nvmrc` pins 24). Your default shell Node may be older: run `nvm use`.
- PostgreSQL 14+ running locally (Homebrew: `brew services start postgresql@14`).
- npm (a lockfile is committed).

## Set up and develop

```bash
nvm use
npm --prefix server-ts install
npm run db:setup          # creates the "voiceops" database, applies migrations, seeds the demo workspace
npm run local:gate        # typecheck + lint + tests (>= 90% per-file coverage) + build
```

`db:setup` is safe to repeat. The demo data is fictional ("Northside Operations": Air Filter 35, Oil Filter 20, Brake Pads 12, Compressor 2 available).

| Command (from the repo root, or `npm --prefix server-ts run <name>`) | What it does |
| --- | --- |
| `db:setup` | create the database if missing, migrate, seed the demo workspace |
| `db:migrate` | apply pending schema migrations |
| `db:seed` | add anything missing from the demo workspace; never overwrites live data |
| `db:reset` | **deletes** the demo workspace's events and resources and restores the fixture (local databases only) |
| `build`, `typecheck`, `lint`, `test`, `test:coverage`, `local:gate` | the usual |

The tests use their own database, `voiceops_test`, created automatically on the first run. It must have "test" in its name because the tests delete data. Override with `TEST_DATABASE_URL`.

## Configuration

Environment variables, read by the server process (never commit real values; the defaults are for local development only):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://localhost:5432/voiceops` | PostgreSQL connection string. May contain a password: keep it out of logs and the repo. |
| `VOICEOPS_WORKSPACE` | `northside-warehouse` | The one workspace this server instance reads and writes. |
| `VOICEOPS_ACTOR_ID` | `manager-1` | Who changes made through this server are attributed to in the activity log. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. Logs go to **stderr** only; stdout carries MCP JSON-RPC. |
| `VOICEOPS_ALLOW_REMOTE_RESET` | unset | Set to `1` to let `db:reset` run against a non-local database. |

For the CLI commands, a `.env` file in `server-ts/` is loaded if present (it is gitignored).

## Connect it to Claude

Build first (`npm --prefix server-ts run build`) and make sure PostgreSQL is running and `npm run db:setup` has been done. Always use an **absolute** Node path: Claude does not load nvm, so a bare `node` may resolve to an old version. On this machine a stable path is `/opt/homebrew/opt/node@24/bin/node`.

**Claude Code** (run from the repo root):

```bash
claude mcp add voiceops -- /opt/homebrew/opt/node@24/bin/node "$PWD/server-ts/dist/bin.js"
```

Add `--scope user` to make it available in every project, and `-e VOICEOPS_ACTOR_ID=your-name` (before the `--`) to change who changes are attributed to. Check with `claude mcp list`, or `/mcp` inside a session.

**Claude Desktop**: edit `~/Library/Application Support/Claude/claude_desktop_config.json`, then quit and reopen the app:

```json
{
  "mcpServers": {
    "voiceops": {
      "command": "/opt/homebrew/opt/node@24/bin/node",
      "args": ["/ABSOLUTE/PATH/TO/REPO/server-ts/dist/bin.js"],
      "env": { "VOICEOPS_ACTOR_ID": "manager-1" }
    }
  }
}
```

Server logs for Claude Desktop appear in `~/Library/Logs/Claude/mcp-server-voiceops.log`. If the server fails to start (database down, schema behind, workspace missing) the log says exactly what to fix.

Rebuild (`npm --prefix server-ts run build`) and restart the client after any code change: clients keep the old process alive.

## Try it

Ask Claude, in a session that has the server connected:

1. "Use voiceops check-health." (confirms the database and shows which client connected)
2. "What do we have in stock?" then "How many air filters are there?"
3. "Add twenty air filters." Expect: Air Filter is now at 55; one entry in the activity log.
4. "Remove ten from the filter." Expect a question: Air Filter or Oil Filter? Nothing changes until you answer.
5. "Remove twenty brake pads." Expect a refusal: only 12 in stock.
6. "Show me the recent changes."
7. "Add twenty air filters, using idempotency key demo-add-filters-1", then say it again. The second time it reports the request was already applied and the stock does not change.

Reset the demo data any time with `npm run db:reset`.

## Tools (M1)

| Tool | Type | Purpose |
| --- | --- | --- |
| `check-health` | read | Server version, uptime, workspace, database status, connected client |
| `find-resources` | read | Search by name; with no query, list everything with quantities and statuses |
| `get-resource` | read | Look up one item by the name people use ("compressor two") |
| `adjust-quantity` | change | Add (positive) or remove (negative) units; optional `idempotencyKey` for safe retries |
| `list-events` | read | Activity log: who, when, before/after values, spreadsheet sync state |

Changes of 100+ units, or ones that would leave zero stock, are refused for now (confirmation arrives in M2).

## Layout

```text
AGENTS.md  CHANGELOG.md  CLAUDE.md  README.md  package.json (delegates to server-ts)
docs/mcp-server-plan.md
server-ts/        TypeScript MCP server (src/, tests/)
service-py/       reserved by AGENTS.md for data/AI workloads; not created yet
```

Inside `server-ts/src`: `domain/` (pure rules), `templates/` (demo data), `app/` (command and read services, ports), `infra/` (PostgreSQL), `mcp/` (tools). ESLint enforces the dependency direction.
