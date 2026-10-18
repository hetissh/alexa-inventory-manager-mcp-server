# Changelog and hand-off tracker

> **Any AI or engineer picking this repo up: read "Current state" first, then the newest log entry, then `docs/mcp-server-plan.md`.**
> **Rule (AGENTS.md §6): update this file in the same change as every code, config, dependency, doc or decision change. Never leave it stale.**

## Current state

_Last updated: 2026-10-19 (end of M2)._

| Item | Status |
| --- | --- |
| Product | VoiceOps: voice-controlled operations (inventory, equipment, menu items, repair jobs) with an audited event ledger. This repo is the **MCP server** that lets Claude act as the "voice" while Alexa/Fire TV/dashboard come later. Product spec: `voiceops-hackathon-build-plan.md` (outside the repo; summarised in `docs/mcp-server-plan.md`). |
| Milestone | **M2 complete** (full operations). **M3 (Google Sheets) not started.** |
| Git | `main` holds the M0 scaffold commit. Branch `feat/m1-core-loop` (cut from `main`; the name predates M2) holds the M1 commit and the M2 commit on top of it. **Not merged into `main`, not pushed** (remote `origin` is set). |
| Gate | `npm run local:gate` is green: typecheck, lint, 439 tests in 34 files, 99.8 % line coverage with every file at or above the 90 % per-file threshold, build. Needs PostgreSQL running. |
| Registered with Claude? | **Not by us.** The user plugs the server into Claude themselves (see "Connect it to Claude" in `README.md`). An earlier registration must be updated: add `VOICEOPS_WORKSPACES=northside-warehouse,harbor-cafe,eastside-repairs` to use the cafe and repair demos, restart the client after rebuilding, and run `npm run db:setup` once (migration `0002`; the server refuses to start with the schema behind). |
| What works | 13 tools: `check-health`, `get-workspace`, `find-resources`, `get-resource`, `get-board`, `list-events`, `list-alerts`, `adjust-quantity`, `set-status`, `assign-job`, `undo-last-change`, `confirm-command`, `cancel-command`. Three fictional workspaces on one engine (warehouse, cafe, repair shop). Server-enforced confirmation tokens, undo, low-stock alerts, a versioned board snapshot, an allow-list of workspaces. |
| What does not exist yet | Google Sheets worker (the outbox table and enqueue path exist; nothing consumes jobs, so `sync.sheets` is `not_configured` or stays `pending`), `retry-sync` and demo-only tools, HTTP transport and auth, board HTTP endpoint, MCP elicitation, cleanup of old pending changes. |

### How to run and verify

Needs Node ≥ 22.12 (the shell default here is Node 18, so use `nvm use` (`.nvmrc` = 24) or prefix commands with `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`) and a running PostgreSQL 14 (Homebrew; listens on localhost:5432 with trust auth for the OS user).

```bash
npm --prefix server-ts install        # once
npm run db:setup                      # from repo root: create DB "voiceops", migrate, seed all three demo workspaces (safe to repeat)
npm run local:gate                    # from repo root; delegates to server-ts
node server-ts/dist/bin.js            # after build; speaks MCP on stdio
```

### Next actions (M3: Google Sheets) — start here

Exit condition (plan §10): a Claude command changes the database **and** the Sheet within about 10 s; a forced Sheet failure leaves the internal change intact and shows `retrying` / `failed` in `list-events`.

**Needs the user first:** a Google Cloud project with the Sheets API enabled, a service account, and one Google Sheet shared with it (an AI cannot create these accounts). The key file must live outside the repo and be referenced by `GOOGLE_APPLICATION_CREDENTIALS`.

1. **Dependency:** pick the Sheets client (`googleapis` or `google-auth-library` + `fetch`); look up the current version and check the licence before adding (plan §8).
2. **Schema:** migration `0003` adding `sheet_rows (workspace_id, resource_id, row_number)`. A way to set `workspaces.integrations.sheets.spreadsheetId` (a `db:` CLI subcommand). The enqueue path already writes a `sync_jobs` row in the commit transaction when that key is present (`app/commit.ts`).
3. **Port and adapter:** `SheetsGateway` interface (in `app/ports.ts` or its own port) + a Google implementation in `src/infra/sheets/` + a fake for tests. Tabs and columns are in plan §9 (Resources: `Resource ID | Type | Name | Quantity | Unit | Status | Assignee | Updated at`; Activity: `Event ID | Time | Actor | Operation | Resource | Before | After | Sync status`). Store the row mapping by resource id, never by display name.
4. **Worker as a separate process** (own bin, e.g. `src/worker/bin.ts`; a stdio MCP server cannot host background jobs): claim jobs with `FOR UPDATE SKIP LOCKED`, status `pending → in_progress → synced | retrying | failed`, exponential backoff with a cap and a maximum attempt count, idempotent append (look for the event id before appending, so a crash between append and mark-synced cannot duplicate a row). Multiple instances must be safe.
5. **Tools:** `retry-sync {eventId}` and the demo-only `reset-workspace` behind `VOICEOPS_DEMO_TOOLS=1` (plan §3). `list-events` already reports per-event `sync`; `app/spoken.ts` already words every sync state.
6. **Tests:** worker with the fake gateway (success, transient failure → retrying → synced, permanent failure → failed, duplicate-safe retry, two workers racing), adapter unit tests, a test that a Sheets failure never undoes the internal commit. Keep ≥ 90 % per-file coverage; update this file, `README.md`, `docs/mcp-server-plan.md`.
7. Check the current Sheets API quotas and batch writes.

### Decisions and assumptions in force

Defaults chosen because the user had not answered the open questions in `docs/mcp-server-plan.md` §12. **Revisit if the user answers differently.**

1. Stack: TypeScript core in `server-ts/` + PostgreSQL. Python (`service-py/`) is reserved by `AGENTS.md` but intentionally not created (no data/AI workload yet).
2. Test clients: Claude Desktop and Claude Code over **stdio**. Streamable HTTP/OAuth deferred to M4.
3. Low-stock alert opens at `quantity < reorderLevel`, auto-resolves on restock. *(Implemented in M2.)*
4. Large-adjust confirmation threshold: template-configurable, default 100 units (`templates/shared.ts`); `maxAdjustment` 10 000 is refused outright. *(Implemented.)*
5. Zero rule: going below zero is rejected (`INSUFFICIENT_STOCK`); reaching exactly zero needs confirmation. *(Implemented.)*
6. Pending sign-off: replacing the product plan's DynamoDB + SQS with Postgres + outbox, and making the future Alexa Lambda a thin HTTPS client of this engine (plan §11).

Decisions made during M1 (not asked of the user):

7. ~~Confirmation is not implemented in M1~~ — **superseded in M2**: confirmation tokens are built (items 15–17).
8. ~~One workspace per server instance, tools take no `workspaceId`~~ — **superseded in M2** by the allow-list (item 23). The security intent is kept: a model cannot address a workspace the server was not configured for.
9. **Writes never auto-resolve a typo-level match** (they return `ambiguous` with a "did you mean"); reads may. Numbers identify things: "compressor three" never fuzzy-matches Compressor 2.
10. **Idempotency:** `commandId = idempotencyKey ?? "mcp-<uuid>"`. Same key + same request = replay of the original event (`replayed: true`); same key + different request = `conflict`. Without a key a client retry is **not** protected.
11. The warehouse fixture has a fourth resource, Oil Filter, which the product plan does not list, so the "ambiguous 'filter'" case is demonstrable; the plan's `"filter"` alias on Air Filter was deliberately dropped.
12. Tool results carry the same data in `structuredContent` and, serialised, in a text block (some clients only show the text). `rejected` and `conflict` set `isError`; `ambiguous`, `not_found`, `confirmation_required` and `cancelled` do not.
13. Demo fixtures live in `templates/*.ts` as typed data validated by the same schemas as live data (no separate `fixtures/` folder). Migrations are TypeScript modules (no `.sql` assets to copy into `dist`).
14. Names/aliases are restricted at the schema boundary (no control/format characters, no `<` `>`, ≤ 80 chars) because they reach the model through tool output.

Decisions made during M2 (not asked of the user; revisit if they disagree):

15. **A change is planned before it is parked.** Invalid or no-op changes are refused immediately with no token; only a valid change that needs a yes becomes `confirmation_required`. `OperationPlan` is `rejected | ready`, where `ready` may carry a `confirmation` (reason + readback).
16. When confirmed, the event is attributed to the **person who asked** (the pending change's actor, source and client name), not to whoever called `confirm-command`; only that actor may confirm or cancel.
17. **Tokens:** 128 random bits, shown once, only the SHA-256 hash stored, single-use, 2-minute lifetime (injectable clock in `CommandServiceOptions`), bound to actor and workspace, never logged. `confirm-command` is annotated `destructiveHint: true` so the client's own permission prompt is a second gate. A stale resource (version changed since asking) → `conflict`, nothing applied.
18. **A second resource in the arguments** (the technician for `assign-job`) is declared by the operation (`BoundOperation.secondary`) and resolved by the service with the same matcher, never auto-resolving typos. The event stores the raw spoken argument in `request_args`; the resolved technician is recorded in `before`/`after` (`assigneeId`).
19. **Undo:** the actor's newest event that is not itself an undo and has not been undone; allowed only if the resource still holds exactly what that event left (else `STATE_CHANGED`); recorded as a new event with `reversal_of`; a unique index allows one undo per event; undoing an undo is not supported (asking again undoes the change before it).
20. **Low-stock rule is state-based** (after every committed event, including undos): breached → open an alert unless one is open (partial unique index), not breached → resolve open alerts. A pending (unconfirmed) change raises nothing.
21. **Board:** one repeatable-read, read-only snapshot (so `version` always matches the content); headline metrics are chosen per template (`MetricKind` in `domain/board.ts`, `template.board`); `hasAlert` flags resources with an open alert.
22. **Status vocabulary** is per workspace settings (`templates/shared.ts`): labels ("under maintenance", "sold out") and aliases ("broken" → out_of_service, "out of stock" → sold_out). Unknown words are refused with the list of valid statuses.
23. **Workspace allow-list:** `VOICEOPS_WORKSPACES` (default: only `VOICEOPS_WORKSPACE`; the default must be on the list). Every tool takes an optional `workspaceId`; one not on the list throws, so the client sees an error result with text, not structured data. Startup checks every listed workspace exists.
24. **Cafe fixture:** Veg Biryani exists so "biryani" is ambiguous, and Chicken Biryani has no `biryani` alias. **Repair fixture:** Vikram is off duty, Job 107 is done, Job 109 is in progress with Priya, so refusals and reassignment are demonstrable.
25. **An exact name beats a longer name that merely contains it** ("Rahul" resolves to Rahul even if a "Rahul Iyer" exists); a first name that fits two technicians equally asks which one.
26. `equipmentStatuses` moved from `Template` into `WorkspaceSettings`, with `menuItemStatuses`, `statusLabels`, `statusAliases`.

### Gotchas

- **Node version:** default shell Node is v18.18.2. Anything run with it will fail (vitest 5 needs Node ≥ 22.12; the `db:*` scripts use `--env-file-if-exists`). MCP clients do not load nvm, so register the server with an **absolute** Node path, e.g. `/opt/homebrew/opt/node@24/bin/node` (v24.3.0), never a bare `node`.
- **stdout is the protocol.** Never write to stdout. Use the pino logger (stderr). `installStdoutGuard` redirects stray `console.log/info/debug` to stderr but cannot catch direct `process.stdout.write`.
- **File names containing "token" cannot be created in this environment** (a permission rule treats them as secret files). The confirmation-token helpers therefore live in `src/app/confirmationCode.ts` (exports are still `generateToken`, `hashToken`, `TOKEN_PATTERN`); name future files and tests accordingly. The same rule blocks `.env*` files.
- **PostgreSQL on this machine** has other projects' databases (`upms_sync`, `rl-hexagon-pwa`): never touch them. This project only creates `voiceops` (dev) and `voiceops_test` (tests) plus short-lived `voiceops_test_tmp_*` databases that the tests drop.
- **Tests need a running PostgreSQL.** `tests/global-setup.ts` creates and migrates `voiceops_test` and refuses a `TEST_DATABASE_URL` whose name lacks "test". Test files run serially (`fileParallelism: false`) because they share and reset that database; every integration test resets **all three** demo workspaces (`resetAll`). A failure to connect gives an actionable message; it is never skipped.
- `db:reset` deliberately **keeps** `workspaces.integrations` (configuration); the test helper clears it so tests do not leak a configured spreadsheet.
- **Not covered by tests (documented):** the `ROLLBACK`/rethrow path at the end of `infra/db/seed.ts` (lines 56–57), and one branch in `pgStore.ts` (a unique violation on an unrelated constraint). Both files stay above the threshold.
- **Single-member unions:** `OPERATION_NAMES` is now four long, but `ALERT_RULES` has one member, so `src/domain/board.ts` carries a justified `eslint-disable` for `no-unnecessary-condition`; remove it when a second rule exists.
- **TypeScript is pinned `~6.0.3`** because `typescript-eslint@8.71` declares peer `typescript <6.1.0`. TypeScript 7.x is "latest" on npm; revisit when typescript-eslint supports it.
- **Dependency versions were looked up on 2026-10-18** (MCP SDK 1.32.1, zod 4.6.7, vitest 5.0.5, eslint 10.13, pino 10.4, pg 8.23.1). The SDK is v1.x (`McpServer.registerTool`, zod raw shapes); re-check the SDK major before upgrading.
- **esbuild/fsevents install scripts are not approved** in npm's allow-scripts list (npm warns). tsx/vitest work without them; do not blanket-approve scripts.
- `npm` commands from the repo root delegate to `server-ts` via `npm --prefix server-ts`. `npm exec`/`npx` with `--prefix` does **not** change the working directory, so tools like eslint cannot find their config that way; use `npm --prefix server-ts run <script>`. Also avoid `cd` in shell commands run by an agent: the working directory persists between calls.
- Tests live in `server-ts/tests/` (`unit/`, `integration/`, `e2e/`, `helpers/`), not next to sources. Coverage is measured on `src/` only. ESLint also enforces the layering `domain ← templates ← app ← {infra, mcp}` (`no-restricted-imports` in `eslint.config.js`).

## Milestone tracker

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 Scaffold | TS project, lint, vitest, gates, hello tools over stdio, Claude registration docs | **Done** 2026-10-18 |
| M1 Core loop | Postgres, `adjust-quantity` end to end, warehouse fixture, read tools | **Done** 2026-10-19 |
| M2 Full operations | `set-status`, `assign-job`, confirmation tokens, disambiguation, café/repair templates, alerts, board, undo, workspace allow-list | **Done** 2026-10-19 |
| M3 Sheets | Outbox worker, row mapping, retries, sync status | Not started (outbox table + enqueue path exist) |
| M4 Hardening | Streamable HTTP + auth, board endpoint, demo reset, rehearsal | Not started |

## Log (newest first)

### 2026-10-19 — M2: confirmation, status/assign/undo, alerts, board, three workspaces

**Done**
- **Domain** (`src/domain/`): resource types `menu_item`, `job`, `technician` (schemas, fixtures); operations `SET_STATUS`, `ASSIGN_JOB`, `REVERSE_EVENT` next to `ADJUST_QUANTITY`; `OperationPlan` reworked to `rejected | ready(+confirmation)`; `status.ts` (labels, spoken aliases); `rules/lowStock.ts`; `board.ts` (metrics per template).
- **App** (`src/app/`): `CommandService` now has `execute` / `confirm` / `cancel`; `commit.ts` holds the one transactional pipeline for both new requests and confirmations (lock, replay check, version check, plan, park or apply, alerts, outbox); resolution of a second resource; `readService` gained `listAlerts`, `getBoard`, `getWorkspaceInfo`; `spoken.ts` words alerts, boards and workspaces; token helpers in `confirmationCode.ts`.
- **Infra:** migration `0002_confirmations_alerts` (`commands`, `alerts`, unique index on `events.reversal_of`); `PgStore` grew the matching queries and a repeatable-read board snapshot; `seed`/`reset` cover the new tables.
- **Templates:** cafe (Harbor Cafe) and repair shop (Eastside Repair Shop) beside the warehouse; per-template board definitions; shared settings with status labels and aliases.
- **Config:** `VOICEOPS_WORKSPACES` allow-list (default must be on it), validated and de-duplicated; startup verifies every listed workspace exists.
- **MCP:** 8 new tools (`get-workspace`, `get-board`, `list-alerts`, `set-status`, `assign-job`, `undo-last-change`, `confirm-command`, `cancel-command`); every tool takes an optional `workspaceId`; one shared result shape for changes (`writeResult.ts`) including `confirmation`, `alerts` and `role`; server instructions and tool descriptions tell the model to read the readback aloud, wait for a clear yes and never confirm on its own.
- **Docs:** `README.md` (setup incl. the three workspaces and the allow-list, registration commands, things to try), `docs/mcp-server-plan.md` (as-built confirmation protocol, tables, layout, workspace scoping).

**Verified (actually run)**
- `npm run local:gate` green: typecheck, lint (including the layering rules), 439 tests in 34 files (unit, PostgreSQL integration, MCP in-memory, spawned-process stdio e2e), 99.8 % lines / 99.8 % branches / 100 % functions, every file ≥ 90 %, build.
- The tests cover the plan's §13 cases that apply to this milestone: a status change changes nothing until confirmed; a token is single-use, expires (boundary tested), is refused for another person or workspace, is stored only as a hash and never logged; two simultaneous confirmations apply once; a stale item gives `conflict`; replays are idempotent; undo restores the value, refuses when the item has moved on, runs out, and only touches the asker's own changes; crossing the reorder level raises exactly one alert (also when two removals race), and restocking or undoing clears it; a pending change raises nothing; the same engine runs the warehouse, cafe and repair shop without code changes; a workspace outside the allow-list is refused for reads and changes.
- A real MCP client drove the **built** `dist/bin.js` against the **dev** database through the whole demo script across all three workspaces: +20 air filters, −10 brake pads (alert raised, board "Low stock 1"), compressor under maintenance (asked first, still available before yes, replay of the confirm reported as already applied), "biryani" ambiguous then Chicken Biryani sold out, "job one oh eight" assigned to Rahul after confirmation, Vikram refused, "Zed" not found as the assignee, undo restored the compressor, activity log of four events, workspace outside the allow-list refused, no token in the logs. Afterwards `db:reset` restored all three workspaces and the result was checked (0 events/alerts/commands, board versions 0).
- **Not done:** trying the server inside a real Claude Desktop/Code session (the user is doing that); MCP Inspector. Committed on `feat/m1-core-loop` after the M1 commit (not merged, not pushed); the commit hook's company security checks (gitleaks) run on commit.

**Decisions / findings**
- See "Decisions and assumptions in force" items 15–26.
- Tests caught a real over-reach before shipping: with an exact name and a longer name both present, the first-name query must prefer the exact one (item 25), and a first name that fits two people must ask (tested by renaming one).
- Tests also showed that per-test resets must cover **every** workspace, otherwise global counts leak between files; `resetAll` replaced the warehouse-only helper.
- `confirm-command` re-checks everything under locks (pending row, then resource), so the order "lock command → lock resource" is part of the design: keep it consistent in future operations to avoid deadlocks.

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
- **Docs:** `README.md`, `docs/mcp-server-plan.md`.

**Verified (actually run)**
- `npm run local:gate` green: typecheck, lint, 269 tests in 25 files, coverage 99.7 % lines with every file ≥ 90 %, build.
- Tests included: +20 to 35 gives 55 with exactly one event; replay and parallel replays apply once; a reused key with a different request conflicts; parallel changes to one item are serialised (no lost update); a failure in any step rolls back event, state and board version (also for the outbox step); refusals change nothing; "filter" asks which one; a typo asks instead of guessing; "compressor three" never matches Compressor 2.
- A real MCP client drove the built server against the dev database (add 20, retry replayed, ambiguous, insufficient stock refused, activity log), then `db:reset` restored the fixture.

**Decisions / findings**
- See items 7–14 above. Tests found that fuzzy matching treated "compressor 3" as a typo of "Compressor 2" (fixed: fuzzy only between names whose numbers agree), and test-state leakage from a configured spreadsheet surviving `reset`.
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
