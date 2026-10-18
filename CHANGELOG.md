# Changelog and hand-off tracker

> **Any AI or engineer picking this repo up: read "Current state" first, then the newest log entry, then `docs/mcp-server-plan.md`.**
> **Rule (AGENTS.md §6): update this file in the same change as every code, config, dependency, doc or decision change. Never leave it stale.**

## Current state

_Last updated: 2026-10-18 (end of M0)._

| Item | Status |
| --- | --- |
| Product | VoiceOps: voice-controlled operations (inventory, equipment, jobs) with an audited event ledger. This repo is the **MCP server** that lets Claude act as the "voice" while Alexa/Fire TV/dashboard come later. Product spec: `voiceops-hackathon-build-plan.md` (outside the repo; summarised in `docs/mcp-server-plan.md`). |
| Milestone | **M0 complete** (scaffold + two diagnostic tools over stdio). **M1 not started.** |
| Git | Branch `main` with one commit (the M0 scaffold, a root commit). **Not pushed** (remote `origin` is set). Check `git log` and `git status`. |
| Gate | `npm run local:gate` is green: typecheck, lint, 37 tests, 100 % coverage (threshold 90 % per file), build. |
| Registered with Claude? | **No.** The user plugs the server into Claude themselves. See "How to connect" in `README.md`. |
| Business logic | None yet. Only `check-health` and `echo-message` exist. No database, no Sheets, no domain code. |

### How to run and verify

Needs Node ≥ 22.12 (dev tooling) — the shell default here is Node 18, so use `nvm use` (`.nvmrc` = 24) or prefix commands with `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`.

```bash
npm --prefix server-ts install        # once
npm run local:gate                    # from repo root; delegates to server-ts
node server-ts/dist/bin.js            # after build; speaks MCP on stdio
```

### Next actions (M1: core loop) — start here

Exit condition: "Add twenty air filters" through Claude produces exactly one event, 35 → 55, and replaying the command is a no-op.

1. Config: add `DATABASE_URL`, `VOICEOPS_WORKSPACE`, `VOICEOPS_ACTOR_ID` to `server-ts/src/config.ts` (zod). Create local Postgres databases `voiceops` and `voiceops_test` (Homebrew PostgreSQL 14 is installed).
2. DB layer: add `pg` + `kysely` (or equivalent) and SQL migrations for `workspaces`, `resources`, `events`, `commands`, `sync_jobs` (outbox). See plan §5 for constraints (`events.command_id` unique, `workspace_id` on every query).
3. `src/domain/`: zod schemas, operation registry with `adjust-quantity`, `normalize.ts` + `matcher.ts` (plan §6).
4. `src/app/`: `CommandService` (resolve → validate → confirm? → commit in one transaction), `ReadService`, `spoken.ts`.
5. Warehouse template + fixture + `seed`/`reset` CLI (fictional data only).
6. MCP tools (verb-first kebab-case, all hints): `find-resources`, `get-resource`, `adjust-quantity`, `list-events`. Update `SERVER_INSTRUCTIONS` in `src/mcp/server.ts`. Decide whether to keep `echo-message` (diagnostic) or remove it.
7. Tests: unit + integration against a throwaway Postgres DB + MCP in-memory tests; keep ≥ 90 % per-file coverage; run `npm run local:gate`.
8. Update this file and `README.md` when done.

### Decisions and assumptions in force

Defaults chosen because the user had not answered the five open questions in `docs/mcp-server-plan.md` §12 before asking to start M0. **Revisit if the user answers differently.**

1. Stack: TypeScript core in `server-ts/` + Postgres. Python (`service-py/`) is reserved by `AGENTS.md` but intentionally not created (no data/AI workload yet).
2. Test clients: Claude Desktop and Claude Code over **stdio**. Streamable HTTP/OAuth deferred to M4.
3. Low-stock alert opens at `quantity < reorderLevel`, auto-resolves on restock.
4. Large-adjust confirmation threshold: template-configurable, default 100 units.
5. Zero rule: going below zero is rejected; reaching exactly zero needs confirmation.
6. Pending sign-off: replacing the product plan's DynamoDB + SQS with Postgres + outbox, and making the future Alexa Lambda a thin HTTPS client of this engine (plan §11).

### Gotchas

- **Node version:** default shell Node is v18.18.2. Anything run with it will fail (vitest 5 needs Node ≥ 22.12). MCP clients do not load nvm, so register the server with an **absolute** Node path, e.g. `/opt/homebrew/opt/node@24/bin/node` (v24.3.0) — never a bare `node`.
- **stdout is the protocol.** Never write to stdout. Use the pino logger (stderr). `installStdoutGuard` redirects stray `console.log/info/debug` to stderr but cannot catch direct `process.stdout.write`.
- **TypeScript is pinned `~6.0.3`** because `typescript-eslint@8.71` declares peer `typescript <6.1.0`. TypeScript 7.x is "latest" on npm; revisit when typescript-eslint supports it.
- **Dependency versions were looked up on 2026-10-18** (MCP SDK 1.32.1, zod 4.6.7, vitest 5.0.5, eslint 10.13, pino 10.4). The SDK is v1.x (`McpServer.registerTool`, zod raw shapes); re-check the SDK major before upgrading.
- **`server-ts/.env.example` could not be created**: a permission rule in this environment blocks writing `.env*` files. Env vars are documented in `README.md` and `src/config.ts`. Create the file by hand if wanted.
- **esbuild postinstall script is not approved** in npm's allow-scripts list (npm warns). tsx/vitest work without it; do not blanket-approve scripts.
- `npm` commands from the repo root delegate to `server-ts` via `npm --prefix server-ts`. Running `npm exec`/`npx` with `--prefix` does **not** change the working directory, so tools like eslint cannot find their config that way; use `npm --prefix server-ts run <script>`.
- Tests live in `server-ts/tests/` (`unit/`, `e2e/`, `helpers/`), not next to sources. Coverage is measured on `src/` only.

## Milestone tracker

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 Scaffold | TS project, lint, vitest, gates, hello tools over stdio, Claude registration docs | **Done** 2026-10-18 |
| M1 Core loop | Postgres, `adjust-quantity` end to end, warehouse fixture, read tools | Not started |
| M2 Full operations | `set-status`, `assign-job`, confirmation tokens, disambiguation, café/repair templates, alerts, board, undo | Not started |
| M3 Sheets | Outbox worker, row mapping, retries, sync status | Not started |
| M4 Hardening | Streamable HTTP + auth, board endpoint, demo reset, rehearsal | Not started |

## Log (newest first)

### 2026-10-18 — M0: scaffold, diagnostic tools, plan saved

**Done**
- Saved the architecture/build plan to `docs/mcp-server-plan.md` (tool names changed to kebab-case, layout aligned with `AGENTS.md`, `service-py/` reserved).
- Created this tracker; appended §6 "Change log and hand-off protocol" to the user's `AGENTS.md`; added `CLAUDE.md` (imports `AGENTS.md`) and `README.md`.
- Scaffolded `server-ts/`: strict TypeScript (NodeNext ESM, `.js` import extensions), ESLint flat config (strict type-checked, no `any`, no floating promises, no console, import sorting, double-cast ban), Vitest with 90 % per-file thresholds, `local:gate` script. Root `package.json` delegates scripts to `server-ts`.
- Implemented the stdio MCP server: `bin.ts` (entry) → `main.ts` (composition root, graceful shutdown on SIGINT/SIGTERM/stdin close/transport close) → `mcp/server.ts` → `mcp/tools/{checkHealth,echoMessage}.ts`. Supporting modules: `config.ts` (zod env), `logger.ts` (pino → stderr, secret redaction), `stdout-guard.ts`, `lifecycle.ts`, `version.ts`.
- Tools: `check-health` (version, uptime, node version, connected MCP client) and `echo-message` (validated 1–200 char string). Both read-only with all four hints set.
- Tests (37, 100 % coverage): unit tests for every module, in-memory MCP client/server tests, a spawned-process stdio e2e test, and a catalogue test that enforces kebab-case names and explicit hints on every future tool.

**Verified (actually run)**
- `npm run local:gate` green (typecheck, lint, tests + coverage, build) under Node 24.19.0.
- Built `dist/bin.js` probed with raw JSON-RPC over a pipe: initialize, `tools/list` and `tools/call check-health` succeeded, every stdout line was valid JSON, logs appeared only on stderr, exit code 0 on stdin close.
- **Not done:** registering with Claude Code/Desktop, and trying the server inside a real Claude session — the user is doing that. MCP Inspector not run.

**Decisions / findings**
- `AGENTS.md` already existed (user-authored, hybrid Node + Python). Followed it: `server-ts/` layout, kebab-case verb-first tools, all tool hints, ≥ 90 % per-file coverage, `npm run local:gate`. The plan's earlier `snake_case` tool names were replaced.
- Tests caught a real bug: `shutdown()` called `process.exit` twice because closing the server fires `onclose` synchronously and re-entered before the in-flight promise was stored. Fixed by deferring the shutdown body one microtask (`Promise.resolve().then`). Keep this in mind for any future re-entrant lifecycle code.
- Chose npm (not pnpm) because `AGENTS.md` names `npm run local:gate`.
- Committed as the initial commit on `main` (a root commit, so no feature branch was cut); **not pushed**. The commit hook runs company security checks (gitleaks) and passed. Nothing was registered in any Claude config.
