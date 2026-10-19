# VoiceOps MCP server

An MCP server that exposes the VoiceOps command/event engine (inventory, equipment, menu items, repair jobs, audited events, alerts, a live board) as tools, so Claude can act as the voice interface while Alexa, the Fire TV board and the dashboard are built later.

- Progress and next steps: [`CHANGELOG.md`](CHANGELOG.md)
- Architecture and build plan: [`docs/mcp-server-plan.md`](docs/mcp-server-plan.md)
- Engineering rules for contributors and AI assistants: [`AGENTS.md`](AGENTS.md)

**Status:** milestone M3 (spreadsheet sync) is built and tested against an in-memory stand-in for the spreadsheet; it has **not yet been run against real Google** (that needs the credentials described in [`docs/google-sheets-setup.md`](docs/google-sheets-setup.md)). Across three demo workspaces (warehouse, cafe, repair shop) Claude can look things up, add or remove stock, change a status, assign a job and undo. Anything risky waits for the user's explicit yes before it is applied. Every change is recorded with before/after values, low stock raises an alert by itself, and a versioned board snapshot is available for a future screen. A background worker copies every change to a Google Sheet (setup in [`docs/google-sheets-setup.md`](docs/google-sheets-setup.md)).

## Prerequisites

- Node ≥ 22.12 (`.nvmrc` pins 24). Your default shell Node may be older: run `nvm use`.
- PostgreSQL 14+ running locally (Homebrew: `brew services start postgresql@14`).
- npm (a lockfile is committed).

## Set up and develop

```bash
nvm use
npm --prefix server-ts install
npm run db:setup          # creates the "voiceops" database, applies migrations, seeds the three demo workspaces
npm run local:gate        # typecheck + lint + tests (>= 90% per-file coverage) + build
```

`db:setup` is safe to repeat, and **you must re-run it after pulling a new milestone**: the server refuses to start when the schema is behind and says so. The demo data is fictional:

| Workspace id | Business | Contents |
| --- | --- | --- |
| `northside-warehouse` | Northside Operations (warehouse) | Air Filter 35, Oil Filter 20, Brake Pads 12, Compressor 2 (available) |
| `harbor-cafe` | Harbor Cafe | Chicken Biryani ₹260, Veg Biryani ₹220, Lime Soda ₹80, Masala Dosa ₹120, Filter Coffee ₹60 (INR) |
| `eastside-repairs` | Eastside Repair Shop | Jobs 107 (done), 108, 109 (in progress, Priya), 110; technicians Rahul, Priya, Arjun, Vikram (off duty) |

| Command (from the repo root, or `npm --prefix server-ts run <name>`) | What it does |
| --- | --- |
| `db:setup` | create the database if missing, migrate, seed the demo workspaces |
| `db:migrate` | apply pending schema migrations |
| `db:seed` | add anything missing from the demo workspaces; never overwrites live data |
| `db:reset` | **deletes** the demo workspaces' events, pending changes, alerts and resources and restores the fixtures (local databases only) |
| `sheets -- <connect\|check\|disconnect> <workspace> [sheet]` | connect a workspace to a Google Sheet (see [`docs/google-sheets-setup.md`](docs/google-sheets-setup.md)) |
| `worker` | run the spreadsheet sync worker (build first); leave it running |
| `build`, `typecheck`, `lint`, `test`, `test:coverage`, `local:gate` | the usual |

The tests use their own database, `voiceops_test`, created automatically on the first run. It must have "test" in its name because the tests delete data. Override with `TEST_DATABASE_URL`.

## Configuration

Environment variables, read by the server process (never commit real values; the defaults are for local development only):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://localhost:5432/voiceops` | PostgreSQL connection string. May contain a password: keep it out of logs and the repo. |
| `VOICEOPS_WORKSPACE` | `northside-warehouse` | The workspace used when a tool call does not name one. |
| `VOICEOPS_WORKSPACES` | just `VOICEOPS_WORKSPACE` | Comma-separated **allow-list** of workspaces tools may address. Anything else is refused. Set it to all three ids to use the cafe and repair demos. |
| `VOICEOPS_ACTOR_ID` | `manager-1` | Who changes are attributed to in the activity log. Only this person can confirm or undo what they asked for. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. Logs go to **stderr** only; stdout carries MCP JSON-RPC. |
| `VOICEOPS_ALLOW_REMOTE_RESET` | unset | Set to `1` to let `db:reset` run against a non-local database. |
| `GOOGLE_APPLICATION_CREDENTIALS` | unset | Absolute path of the Google service-account key file (**a secret: keep it outside the repo**). Read by the sync worker and the `sheets` command only, never by the MCP server. |
| `VOICEOPS_SYNC_POLL_MS` | `1000` | How often the sync worker looks for work when idle (100 to 60000). |
| `VOICEOPS_DEMO_TOOLS` | `false` | `true` registers the demo-only `reset-workspace` tool. Refused unless the database is local. |

For the CLI commands, a `.env` file in `server-ts/` is loaded if present (it is gitignored).

## Connect it to Claude

Build first (`npm --prefix server-ts run build`) and make sure PostgreSQL is running and `npm run db:setup` has been done. Always use an **absolute** Node path: Claude does not load nvm, so a bare `node` may resolve to an old version. On this machine a stable path is `/opt/homebrew/opt/node@24/bin/node`.

**Claude Code** (run from the repo root):

```bash
claude mcp add voiceops -e VOICEOPS_WORKSPACES=northside-warehouse,harbor-cafe,eastside-repairs -- /opt/homebrew/opt/node@24/bin/node "$PWD/server-ts/dist/bin.js"
```

Add `--scope user` to make it available in every project, and `-e VOICEOPS_ACTOR_ID=your-name` to change who changes are attributed to. If you registered an earlier milestone, remove it first (`claude mcp remove voiceops`). Check with `claude mcp list`, or `/mcp` inside a session.

**Claude Desktop**: edit `~/Library/Application Support/Claude/claude_desktop_config.json`, then quit and reopen the app:

```json
{
  "mcpServers": {
    "voiceops": {
      "command": "/opt/homebrew/opt/node@24/bin/node",
      "args": ["/ABSOLUTE/PATH/TO/REPO/server-ts/dist/bin.js"],
      "env": {
        "VOICEOPS_WORKSPACES": "northside-warehouse,harbor-cafe,eastside-repairs",
        "VOICEOPS_ACTOR_ID": "manager-1"
      }
    }
  }
}
```

Server logs for Claude Desktop appear in `~/Library/Logs/Claude/mcp-server-voiceops.log`. If the server fails to start (database down, schema behind, workspace missing) the log says exactly what to fix.

Rebuild (`npm --prefix server-ts run build`) and restart the client after any code change: clients keep the old process alive.

## Try it

Ask Claude, in a session that has the server connected. The wording does not have to be exact.

**Warehouse**
1. "Use voiceops check-health." (confirms the database and shows which client connected and which workspaces you can use)
2. "What do we have in stock?" then "How many air filters are there?"
3. "Add twenty air filters." Applied at once: Air Filter is now at 55, one entry in the activity log.
4. "Remove ten from the filter." Claude asks: Air Filter or Oil Filter? Nothing changes until you answer.
5. "Remove ten brake pads." Stock drops to 2, below the reorder level of 5: the answer includes a low-stock alert, and the board shows "Low stock 1".
6. "Mark compressor two under maintenance." Claude reads back "Mark Compressor 2 as under maintenance (currently available)?" and waits. Say yes and it is applied; say no and nothing changes.
7. "Undo my last change." Claude asks first, then puts the compressor back.
8. "Add two hundred oil filters." Large changes ask for approval too.

**Cafe** (say "in the cafe"): "Mark biryani sold out." Claude asks which biryani; "Chicken Biryani" then asks you to confirm.

**Repair shop** (say "in the repair shop"): "Assign job one oh eight to Rahul." Asks, then assigns. "Assign job 110 to Vikram" is refused (he is off duty).

**Spreadsheet** (after setting it up as in [`docs/google-sheets-setup.md`](docs/google-sheets-setup.md) and starting `npm run worker`): "Add twenty air filters." Claude says the spreadsheet update is *pending*; the row appears in the sheet within a few seconds; "show me the recent changes" then reports it as *synced*. Stop the worker, make a change, and `get-workspace` shows it waiting; start the worker and it clears.

Say any change twice with an idempotency key ("using key demo-1") and the second time it reports the request was already applied. Reset the demo data any time with `npm run db:reset`.

## Tools

| Tool | Type | Purpose |
| --- | --- | --- |
| `check-health` | read | Server version, uptime, default workspace, allowed workspaces, database status, connected client |
| `get-workspace` | read | What a workspace contains, allowed statuses, which stock changes need approval |
| `find-resources` | read | Search by name; with no query, list everything with quantities, statuses and assignments |
| `get-resource` | read | Look up one thing by the name people use ("compressor two", "job one oh eight") |
| `get-board` | read | The live board: headline numbers, every resource, open alerts, latest changes, one versioned snapshot |
| `list-events` | read | Activity log: who, when, before/after values, spreadsheet sync state |
| `list-alerts` | read | Open (or resolved) alerts, such as low stock |
| `adjust-quantity` | change | Add or remove units; large or zeroing changes ask first |
| `set-status` | change | Equipment (available / under maintenance / out of service) or menu item (available / sold out); always asks first |
| `assign-job` | change | Give a job to an active technician; always asks first |
| `undo-last-change` | change | Reverse your most recent change with a compensating event; always asks first |
| `confirm-command` | change | Apply a waiting change after the user said yes (single-use token, about two minutes, only for the person who asked) |
| `cancel-command` | change | Discard a waiting change |
| `retry-sync` | change | Try a failed or retrying spreadsheet update again |
| `reset-workspace` | demo only | Restore a demo workspace's starting data (only with `VOICEOPS_DEMO_TOOLS=true`, local databases only) |

Every tool takes an optional `workspaceId`; every change tool takes an optional `idempotencyKey`. `list-events` and `get-board` show each change's spreadsheet state (`not_configured`, `pending`, `retrying`, `synced`, `failed`) and, when it failed, why.

## Spreadsheet sync

Every committed change queues a job in the same database transaction. A separate **worker process** (`npm run worker`) turns the queued jobs into Google Sheets writes: it rewrites the workspace's **Resources** tab from the database and appends the new rows to the **Activity** tab, retrying with backoff on temporary problems and giving up (visibly) on ones a retry cannot fix. A failing spreadsheet never undoes or blocks a change. Run the worker whenever the MCP server is in use; if it is not running, updates stay *pending* and `get-workspace` shows the backlog. See [`docs/google-sheets-setup.md`](docs/google-sheets-setup.md) for the one-off Google setup, the commands and troubleshooting.

## Layout

```text
AGENTS.md  CHANGELOG.md  CLAUDE.md  README.md  package.json (delegates to server-ts)
docs/mcp-server-plan.md
server-ts/        TypeScript MCP server (src/, tests/)
service-py/       reserved by AGENTS.md for data/AI workloads; not created yet
```

Inside `server-ts/src`: `domain/` (pure rules and operations), `templates/` (the three demo workspaces), `app/` (command and read services, ports), `infra/` (PostgreSQL), `mcp/` (tools). ESLint enforces the dependency direction.
