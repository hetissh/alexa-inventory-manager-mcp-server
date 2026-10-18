# Changelog and hand-off tracker

> **Any AI or engineer picking this repo up: read "Current state" first, then the newest log entry, then `docs/mcp-server-plan.md`.**
> **Rule (AGENTS.md §6): update this file in the same change as every code, config, dependency, doc or decision change. Never leave it stale.**

## Current state

_Last updated: 2026-10-19 (end of M1)._

| Item | Status |
| --- | --- |
| Product | VoiceOps: voice-controlled operations (inventory, equipment, jobs) with an audited event ledger. This repo is the **MCP server** that lets Claude act as the "voice" while Alexa/Fire TV/dashboard come later. Product spec: `voiceops-hackathon-build-plan.md` (outside the repo; summarised in `docs/mcp-server-plan.md`). |
| Milestone | **M1 complete** (core loop). **M2 not started.** |
| Git | `main` holds the M0 scaffold commit. M1 is committed on branch `feat/m1-core-loop` (cut from `main`; **not merged, not pushed**; remote `origin` is set). Continue M2 on top of that branch, or merge it into `main` first. |
| Gate | `npm run local:gate` is green: typecheck, lint, 269 tests in 25 files, 99.7 % line coverage with every file at or above the 90 % per-file threshold, build. Needs PostgreSQL running. |
| Registered with Claude? | **Not by us.** The user plugs the server into Claude themselves. See "Connect it to Claude" in `README.md`. A registration made for M0 still works (the defaults point at the local `voiceops` database) but the client must be restarted after a rebuild. |
| What works | Tools `check-health`, `find-resources`, `get-resource`, `adjust-quantity`, `list-events` against a local PostgreSQL database with the fictional "Northside Operations" warehouse (Air Filter 35, Oil Filter 20, Brake Pads 12, Compressor 2 available). `adjust-quantity` is transactional (event + state + board version + outbox together), idempotent by `idempotencyKey`, and never guesses a name. |
| What does not exist yet | Confirmation tokens (large or zero-stock changes are refused for now), `set-status`, `assign-job`, undo, low-stock alerts, board/`get-board`, café and repair templates, Google Sheets worker (the outbox table and enqueue path exist but nothing consumes jobs), HTTP transport. |

### How to run and verify

Needs Node ≥ 22.12 (the shell default here is Node 18, so use `nvm use` (`.nvmrc` = 24) or prefix commands with `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`) and a running PostgreSQL 14 (Homebrew; listens on localhost:5432 with trust auth for the OS user).

```bash
npm --prefix server-ts install        # once
npm run db:setup                      # from repo root: create DB "voiceops", migrate, seed (safe to repeat)
npm run local:gate                    # from repo root; delegates to server-ts
node server-ts/dist/bin.js            # after build; speaks MCP on stdio
```

### Next actions (M2: full operations) — start here

Exit condition: all voice-equivalent scenarios from the product plan pass through Claude (set equipment status with confirmation, assign a job, low-stock alert, undo, switch workspace), and the §13 acceptance table is covered by automated tests.

1. **Schema:** migration `0002` adding `commands` (confirmation tokens: id, workspace, actor, operation, resolved resource id, args, `expected_version`, status, result, `expires_at`) and `alerts` (partial unique index on `(workspace_id, resource_id, rule) WHERE status='open'`). Extend `RESOURCE_TYPES` (`menu_item`, `job`, `technician`), `TEMPLATE_IDS` (`cafe`, `repair`), `OPERATION_NAMES`, and the DB `source` check if needed.
2. **Confirmation flow:** the seam already exists: `OperationPlan.kind === 'needs_confirmation'` (with a `readback`) is turned into a `rejected / CONFIRMATION_UNSUPPORTED` outcome in `app/commandService.ts` `commit()`. Replace that with: create a `commands` row + single-use token (TTL 2 min, `expectedVersion`), return `confirmation_required`; add `CommandService.confirm/cancel` and MCP tools `confirm-command` / `cancel-command` (`destructiveHint: true`); re-validate against the current version at confirm (`conflict` if changed); replay of a token returns the original outcome. Update `SERVER_INSTRUCTIONS` and the `adjust-quantity` tool description (remove the "currently refused" sentence).
3. **Operations** (one file each in `domain/operations/`, register in `registry.ts`): `SET_STATUS` (always confirm), `ASSIGN_JOB` (always confirm; technician resolved with the same matcher), `REVERSE_EVENT` (always confirm; allowed only if current state still equals the event's `after`; compensating event with `reversal_of`). Tools: `set-status`, `assign-job`, `undo-last-change`.
4. **Rules and reads:** low-stock rule evaluated inside the commit transaction (open on `quantity < reorderLevel`, auto-resolve on restock; exactly one open alert); tools `list-alerts`, `get-board` (plan §8 contract incl. `version` = `workspaces.board_version`), `get-workspace`; include `alerts` in the write envelope.
5. **Workspaces:** café and repair templates (`templates/`), `VOICEOPS_WORKSPACES` allow-list and an optional validated `workspaceId` tool parameter (see decision below), seed all templates.
6. **Tests:** §13 acceptance cases (concurrent confirms: exactly one wins; threshold crossing: exactly one alert; undo; template switch), keep ≥ 90 % per-file coverage, update this file, `README.md` and `docs/mcp-server-plan.md`.

### Decisions and assumptions in force

Defaults chosen because the user had not answered the open questions in `docs/mcp-server-plan.md` §12 when asking to start. **Revisit if the user answers differently.**

1. Stack: TypeScript core in `server-ts/` + PostgreSQL. Python (`service-py/`) is reserved by `AGENTS.md` but intentionally not created (no data/AI workload yet).
2. Test clients: Claude Desktop and Claude Code over **stdio**. Streamable HTTP/OAuth deferred to M4.
3. Low-stock alert opens at `quantity < reorderLevel`, auto-resolves on restock. *(Not built yet; `reorderLevel` is stored and shown.)*
4. Large-adjust confirmation threshold: template-configurable, default 100 units (`templates/warehouse.ts` `settings`); `maxAdjustment` 10 000 is refused outright. *(Implemented in `domain/operations/adjustQuantity.ts`.)*
5. Zero rule: going below zero is rejected (`INSUFFICIENT_STOCK`); reaching exactly zero needs confirmation. *(Implemented.)*
6. Pending sign-off: replacing the product plan's DynamoDB + SQS with Postgres + outbox, and making the future Alexa Lambda a thin HTTPS client of this engine (plan §11).

Decisions made during M1 (not asked of the user; revisit if they disagree):

7. **Confirmation is not implemented in M1.** Changes that need it are refused with `CONFIRMATION_UNSUPPORTED` and change nothing. This keeps the safety property without building the token flow early (it is M2 step 2).
8. **One workspace and one actor per server instance** (`VOICEOPS_WORKSPACE`, `VOICEOPS_ACTOR_ID`); tools take no `workspaceId`, so a model cannot address workspaces the actor is not entitled to. M2 adds an allow-list.
9. **Writes never auto-resolve a typo-level match** (they return `ambiguous` with a "did you mean"); reads may. Numbers identify things: "compressor three" never fuzzy-matches Compressor 2.
10. **Idempotency:** `commandId = idempotencyKey ?? "mcp-<uuid>"`. Same key + same request = replay of the original event (`replayed: true`); same key + different request = `conflict`. Without a key a client retry is **not** protected.
11. **The warehouse fixture has a fourth resource, Oil Filter**, which the product plan does not list, so the "ambiguous 'filter'" acceptance case is demonstrable; the plan's `"filter"` alias on Air Filter was deliberately dropped (it would make "filter" unambiguous).
12. Tool results carry the same data in `structuredContent` and, serialised, in a text block (some clients only show the text). `rejected` and `conflict` set `isError`; `ambiguous` and `not_found` do not.
13. Demo fixtures live in `templates/*.ts` as typed data validated by the same schemas as live data (no separate `fixtures/` folder). Migrations are TypeScript modules (no `.sql` assets to copy into `dist`).
14. Names/aliases are restricted at the schema boundary (no control/format characters, no `<` `>`, ≤ 80 chars) because they reach the model through tool output.

### Gotchas

- **Node version:** default shell Node is v18.18.2. Anything run with it will fail (vitest 5 needs Node ≥ 22.12; the `db:*` scripts use `--env-file-if-exists`). MCP clients do not load nvm, so register the server with an **absolute** Node path, e.g. `/opt/homebrew/opt/node@24/bin/node` (v24.3.0), never a bare `node`.
- **stdout is the protocol.** Never write to stdout. Use the pino logger (stderr). `installStdoutGuard` redirects stray `console.log/info/debug` to stderr but cannot catch direct `process.stdout.write`.
- **PostgreSQL on this machine** has other projects' databases (`upms_sync`, `rl-hexagon-pwa`): never touch them. This project only creates `voiceops` (dev) and `voiceops_test` (tests) plus short-lived `voiceops_test_tmp_*` databases that the tests drop.
- **Tests need a running PostgreSQL.** `tests/global-setup.ts` creates and migrates `voiceops_test` and refuses a `TEST_DATABASE_URL` whose name lacks "test". Test files run serially (`fileParallelism: false`) because they share and reset that database. A failure to connect gives an actionable message; it is never skipped.
- `db:reset` deliberately **keeps** `workspaces.integrations` (configuration); the test helper clears it so tests do not leak a configured spreadsheet.
- **Not covered by tests (documented):** the `ROLLBACK`/rethrow path at the end of `infra/db/seed.ts` (lines 55–56) only runs when a database statement fails mid-seed, which is hard to provoke. Coverage for that file is still above the threshold.
- **TypeScript is pinned `~6.0.3`** because `typescript-eslint@8.71` declares peer `typescript <6.1.0`. TypeScript 7.x is "latest" on npm; revisit when typescript-eslint supports it.
- **Dependency versions were looked up on 2026-10-18** (MCP SDK 1.32.1, zod 4.6.7, vitest 5.0.5, eslint 10.13, pino 10.4, pg 8.23.1). The SDK is v1.x (`McpServer.registerTool`, zod raw shapes); re-check the SDK major before upgrading.
- **`server-ts/.env.example` could not be created**: a permission rule in this environment blocks writing `.env*` files. Env vars are documented in `README.md` and `src/config.ts`. Create the file by hand if wanted.
- **esbuild/fsevents install scripts are not approved** in npm's allow-scripts list (npm warns). tsx/vitest work without them; do not blanket-approve scripts.
- `npm` commands from the repo root delegate to `server-ts` via `npm --prefix server-ts`. `npm exec`/`npx` with `--prefix` does **not** change the working directory, so tools like eslint cannot find their config that way; use `npm --prefix server-ts run <script>`. Also avoid `cd` in shell commands run by an agent: the working directory persists between calls.
- Tests live in `server-ts/tests/` (`unit/`, `integration/`, `e2e/`, `helpers/`), not next to sources. Coverage is measured on `src/` only. ESLint also enforces the layering `domain ← templates ← app ← {infra, mcp}` (`no-restricted-imports` in `eslint.config.js`).

## Milestone tracker

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 Scaffold | TS project, lint, vitest, gates, hello tools over stdio, Claude registration docs | **Done** 2026-10-18 |
| M1 Core loop | Postgres, `adjust-quantity` end to end, warehouse fixture, read tools | **Done** 2026-10-19 |
| M2 Full operations | `set-status`, `assign-job`, confirmation tokens, disambiguation, café/repair templates, alerts, board, undo | Not started |
| M3 Sheets | Outbox worker, row mapping, retries, sync status | Not started (outbox table + enqueue path exist) |
| M4 Hardening | Streamable HTTP + auth, board endpoint, demo reset, rehearsal | Not started |

## Log (newest first)

### 2026-10-19 — M1: PostgreSQL core loop, `adjust-quantity` end to end

**Done**
- **Domain** (`src/domain/`): zod schemas for resources, workspaces and events (names validated against hidden-text/markup), spoken-name normalisation (`two` → `2`, `one oh eight` → `108`, plurals), a tiered matcher (id → name/alias → partial name → fuzzy) that returns `resolved | ambiguous | not_found` and never guesses, an operation registry with `ADJUST_QUANTITY` (limits, insufficient stock, confirmation rules).
- **App** (`src/app/`): `CommandService` (resolve → bind arguments → lock → replay check → plan → write event + state + board version + outbox in one transaction), `ReadService`, ports (`Store`, `TransactionStore`), `spoken.ts` sentences (so a future Alexa adapter says the same things).
- **Infra** (`src/infra/db/`): `pg` pool, TypeScript migrations with an advisory lock, `0001_init` (workspaces, resources, events, sync_jobs), `PgStore`, seeding, and `ensureDatabase`/`dropDatabase`. Startup fails fast if Postgres is unreachable, the schema is behind, or the workspace is missing, with the fix in the message.
- **CLI** (`npm run db:setup|create|migrate|seed|reset`); `reset` refuses non-local databases unless `VOICEOPS_ALLOW_REMOTE_RESET=1`.
- **MCP** (`src/mcp/`): tools `check-health` (now also reports workspace and database), `find-resources`, `get-resource`, `adjust-quantity`, `list-events`; shared output views; updated server instructions. The M0 `echo-message` tool was removed.
- **Config:** `DATABASE_URL`, `VOICEOPS_WORKSPACE`, `VOICEOPS_ACTOR_ID` (zod; defaults for local dev; errors never echo the connection string); `databaseUrl` etc. are redacted in logs.
- **Lint:** import-direction rules between layers; verified by adding deliberate violations (all three were rejected) and removing them.
- **Local databases created:** `voiceops` (dev, migrated and seeded) and `voiceops_test`.
- **Docs:** `README.md` (setup, config, connecting Claude, things to try), `docs/mcp-server-plan.md` (as-built layout, workspace-scoping decision, matcher rules, data model notes).

**Verified (actually run)**
- `npm run local:gate` green: typecheck, lint, 269 tests in 25 files (unit, PostgreSQL integration, MCP in-memory, spawned-process stdio e2e), coverage 99.7 % lines / 99.6 % branches / 100 % functions with every file ≥ 90 %, build.
- Those tests include: +20 to 35 gives 55 with exactly one event; replay and parallel replays apply once; a reused key with a different request conflicts; parallel changes to one item are serialised (no lost update); a failure in any step rolls back event, state and board version (also for the outbox step); refusals change nothing; "filter" asks which one; a typo asks instead of guessing; "compressor three" never matches Compressor 2.
- A real MCP client (SDK `Client` + `StdioClientTransport`) drove the **built** `dist/bin.js` against the **dev** database: tool list, health, listing, lookup, add 20 (35 → 55, replayed on retry), ambiguous "filter", insufficient stock refused, zero-stock change refused as needing confirmation, activity log with one event. Afterwards the dev database was reset to the fixture (`db:reset`) and checked (35/20/12, 0 events).
- **Not done:** trying the server inside a real Claude Desktop/Code session (the user is doing that); MCP Inspector. Committed on branch `feat/m1-core-loop` (not merged into `main`, not pushed); the commit hook's company security checks (gitleaks) run on commit.

**Decisions / findings**
- See "Decisions and assumptions in force" items 7–14. The most consequential: confirmation deferred to M2 (refuse instead), single workspace per server instance, writes never auto-resolve typos.
- Tests found a real design hazard before it shipped: fuzzy matching treated "compressor 3" as a typo of "Compressor 2". Fixed by only fuzzy-matching names whose numbers agree.
- Tests also caught test-state leakage (a configured spreadsheet surviving `reset`); the test helper now clears integrations.
- A typed result for every outcome (no exceptions for expected cases) made the MCP mapping and tests simple; keep that pattern for new operations.

### 2026-10-18 — M0: scaffold, diagnostic tools, plan saved

**Done**
- Saved the architecture/build plan to `docs/mcp-server-plan.md` (tool names changed to kebab-case, layout aligned with `AGENTS.md`, `service-py/` reserved).
- Created this tracker; appended §6 "Change log and hand-off protocol" to the user's `AGENTS.md`; added `CLAUDE.md` (imports `AGENTS.md`) and `README.md`.
- Scaffolded `server-ts/`: strict TypeScript (NodeNext ESM, `.js` import extensions), ESLint flat config (strict type-checked, no `any`, no floating promises, no console, import sorting, double-cast ban), Vitest with 90 % per-file thresholds, `local:gate` script. Root `package.json` delegates scripts to `server-ts`.
- Implemented the stdio MCP server: `bin.ts` (entry) → `main.ts` (composition root, graceful shutdown on SIGINT/SIGTERM/stdin close/transport close) → `mcp/server.ts` → tools. Supporting modules: `config.ts` (zod env), `logger.ts` (pino → stderr, secret redaction), `stdout-guard.ts`, `lifecycle.ts`, `version.ts`.
- Tools: `check-health` and `echo-message` (the latter removed in M1). Both read-only with all four hints set.
- Tests: unit tests for every module, in-memory MCP client/server tests, a spawned-process stdio e2e test, and a catalogue test that enforces kebab-case names and explicit hints on every tool.

**Verified (actually run)**
- `npm run local:gate` green under Node 24.19.0.
- Built `dist/bin.js` probed with raw JSON-RPC over a pipe: initialize, `tools/list` and `tools/call check-health` succeeded, every stdout line was valid JSON, logs appeared only on stderr, exit code 0 on stdin close.

**Decisions / findings**
- `AGENTS.md` already existed (user-authored, hybrid Node + Python). Followed it: `server-ts/` layout, kebab-case verb-first tools, all tool hints, ≥ 90 % per-file coverage, `npm run local:gate`. The plan's earlier `snake_case` tool names were replaced.
- Tests caught a real bug: `shutdown()` called `process.exit` twice because closing the server fires `onclose` synchronously and re-entered before the in-flight promise was stored. Fixed by deferring the shutdown body one microtask (`Promise.resolve().then`). Keep this in mind for any future re-entrant lifecycle code.
- Chose npm (not pnpm) because `AGENTS.md` names `npm run local:gate`.
- Committed as the initial commit on `main` (a root commit, so no feature branch was cut); not pushed. The commit hook runs company security checks (gitleaks) and passed.
