# Changelog and hand-off tracker

> **Any AI or engineer picking this repo up: read "Current state" first, then the newest log entry, then `docs/mcp-server-plan.md`.**
> **Rule (AGENTS.md §6): update this file in the same change as every code, config, dependency, doc or decision change. Never leave it stale.**

## Current state

_Last updated: 2026-10-20 (M3 verified live against real Google Sheets; M4 first slice committed locally)._

| Item | Status |
| --- | --- |
| Product | VoiceOps: voice-controlled operations (inventory, equipment, menu items, repair jobs) with an audited event ledger. This repo is the **MCP server** that lets Claude act as the "voice" while Alexa/Fire TV/dashboard come later. Product spec: `voiceops-hackathon-build-plan.md` (outside the repo; summarised in `docs/mcp-server-plan.md`). |
| Milestone | **M2 complete.** **M3 (Google Sheets) is done:** verified live on 2026-10-20 against the user's real Google Sheet (see the 2026-10-20 log entry for exactly what was and was not covered; it was driven by an MCP client script, not yet by a Claude session). **M4 (hardening) is started:** the read-only live-board web server, its page and the demo script are built and tested; the Streamable HTTP MCP transport with auth is **not started** (waiting on a decision from the user, see "Next actions"). |
| Git | `main` holds the M0 scaffold commit. Branch `feat/m1-core-loop` (cut from `main`; the name predates M2) holds the M1, M2 and M3 commits plus a docs commit and **is pushed to `origin/feat/m1-core-loop` up to the M3 commit** (2026-10-19); the docs commit `b21b0a3` after it is committed locally but **not pushed**. **The M4 board-server work is committed locally on top of it and not pushed** (push only when the user asks). `main` is **not** pushed and nothing is merged into it; `origin/main` does not exist. |
| Gate | `npm run local:gate` is green (2026-10-19, with the board server): typecheck, lint, 674 tests in 51 files, 99.85 % statements / 99.39 % branches / 100 % functions with every file at or above the 90 % per-file threshold, build. Needs PostgreSQL running. |
| Registered with Claude? | **Not by us.** The user plugs the server into Claude themselves (see "Connect it to Claude" in `README.md`). An earlier registration must be updated: add `VOICEOPS_WORKSPACES=northside-warehouse,harbor-cafe,eastside-repairs` to use the cafe and repair demos, restart the client after rebuilding, and run `npm run db:setup` once (the server refuses to start with the schema behind). M3 adds no migration. |
| What works | **Live board:** `npm run board` serves each allowed workspace's board as a page (`/board/<id>`) and JSON (`/workspaces/<id>/board`, ETag = board version) on `127.0.0.1:8787`, read-only, polling, with a stale banner when the server goes away (details: README "Live board", plan §8a). 14 tools (15 with demo tools): the 13 from M2 plus `retry-sync` (and the demo-only `reset-workspace`). Three fictional workspaces on one engine. Server-enforced confirmation tokens, undo, low-stock alerts, a versioned board snapshot, an allow-list of workspaces. **Spreadsheet sync:** `npm run sheets -- connect|check|disconnect` and a separate worker process (`npm run worker`) that rewrites the Resources tab and appends the Activity tab, in batches, with locking, backoff, retries and visible failures. Exercised against an in-memory spreadsheet **and live against a real Google Sheet** (warehouse workspace only; the cafe and repair workspaces are not connected to a sheet). |
| What does not exist yet | Live proof of sheets for the cafe and repair workspaces (same code path; no sheets exist for them), real Sheets API quota figures, the Streamable HTTP **MCP** transport and its auth (only needed for claude.ai connectors; not started), a Fire TV-specific layout or a push channel (the board polls), MCP elicitation, cleanup of old pending changes, back-fill of pre-connection history into Activity, three rehearsals of the demo script by a person. |

### How to run and verify

Needs Node ≥ 22.12 (the shell default here is Node 18, so use `nvm use` (`.nvmrc` = 24) or prefix commands with `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`) and a running PostgreSQL 14 (Homebrew; listens on localhost:5432 with trust auth for the OS user).

```bash
npm --prefix server-ts install        # once
npm run db:setup                      # from repo root: create DB "voiceops", migrate, seed all three demo workspaces (safe to repeat)
npm run local:gate                    # from repo root; delegates to server-ts
node server-ts/dist/bin.js            # after build; speaks MCP on stdio
npm run worker                        # after build; the spreadsheet sync worker (needs Google credentials, see docs/google-sheets-setup.md)
VOICEOPS_WORKSPACES=northside-warehouse,harbor-cafe,eastside-repairs npm run board   # after build; the live board on http://127.0.0.1:8787/
```

### Next actions — start here

**1. M3 follow-ups (small; the live check itself is done, see the 2026-10-20 entry).**
   - The user should move the service-account key out of `~/Downloads` (for example to `~/.config/voiceops/`, `chmod 600`), then create `server-ts/.env` by hand with `GOOGLE_APPLICATION_CREDENTIALS=<new absolute path>` so `npm run worker` and `npm run sheets` work without passing it on the command line. An AI cannot write `.env*` here and must never read the key. The assistant ran the live check by passing the key's path in the environment of each command only (no `.env` exists yet).
   - Look up the real Sheets API quotas in the Cloud console and note them (the docs site was blocked here).
   - Optional: a real Claude session drives a change that reaches the sheet; connect the other two workspaces to their own sheets; try the "unshare the sheet" failure (a 403 path; the live failure test used a nonexistent sheet id, a 404 path).

**2. Rest of M4 (hardening).** Built: the live-board web server, its page and `docs/demo-script.md` (see the 2026-10-19 M4 log entry). Still open:
   - **Streamable HTTP MCP transport with auth** (bearer/OAuth, `Origin` validation, bind to localhost, token → actor and workspace). It is only needed if the user wants **claude.ai connectors** (which need public HTTPS and OAuth) or a dashboard that calls tools; Claude Desktop and Claude Code work over stdio today. **Ask the user whether they want it before building it.**
   - Three clean consecutive rehearsals of `docs/demo-script.md` by a person (tick the checklist there); note any failing step in a log entry.
   - Optional MCP elicitation as a second approval route; clean-up of expired pending changes.
   - Tidy the branch: rename `feat/m1-core-loop` and merge to `main` only when the user says so; push `b21b0a3` and the M4 commit only when asked.
   - Later: the Alexa adapter calling the same `CommandService`; a Fire TV layout for the board (the page and JSON contract are the starting point).

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

Decisions made during M3 (not asked of the user; revisit if they disagree):

27. **The Resources tab is a snapshot rewritten from the database**, not per-row edits, so there is no `sheet_rows` table (a deviation from plan §9's "update the matching row"). It is complete, self-healing and keyed by resource id; the cost is one whole-tab write per cycle and a ~900-resource limit on a default tab. Hand edits to the tab are overwritten by design.
28. **Batches per workspace under a session-level advisory lock** (`pg_try_advisory_lock(727275, hashtext(workspace))`): one worker at a time per workspace, the workspace state is read *after* the lock (so a later writer always writes later state), all due jobs of the workspace are claimed together (one Resources write + one Activity append per cycle), and a dead worker's lock vanishes with its connection. `FOR UPDATE SKIP LOCKED` was not needed.
29. **Activity is append-only and idempotent:** read the event ids present, append only the missing ones, last, after the Resources write. A retry after a lost acknowledgement adds no duplicate.
30. **Error classes:** `SheetsError(retryable)`. Retryable: 408/429/5xx, a 403 that mentions rate limits/quota, and anything unclassified (dropped connections). Permanent (fail at once, message says what to fix): 401, 403 access denied, 404, 400, missing credentials. Backoff 2 s doubling to 60 s, 8 attempts, 60 s lease for abandoned jobs (`DEFAULT_SYNC_OPTIONS`); polling interval via `VOICEOPS_SYNC_POLL_MS`.
31. **An extra last `Details` column** on Resources (price, job description, reorder level); the plan's eight columns are unchanged and Activity is exactly the plan's eight. Times are ISO 8601 UTC.
32. **Google client:** `@googleapis/sheets` 18.1.1 (Apache-2.0, ~0.8 MB, Node ≥ 22) rather than `googleapis` (~246 MB); credentials via Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`), scope `spreadsheets` only. Cells are written `RAW` so nothing is parsed as a formula.
33. **The MCP server never touches Google or the key file;** only the worker and the `sheets` CLI do.
34. **Demo tool `reset-workspace`** exists only with `VOICEOPS_DEMO_TOOLS=true` *and* a local database (checked before connecting), requires an explicit `confirm: true`, is flagged `destructiveHint`, and only resets demo workspaces on the allow-list.
35. `list-events` and `get-board` show `syncError`; `get-workspace` shows the sync backlog (pending / retrying / failed), so a worker that is not running is visible.

Decisions made during M4 (not asked of the user; revisit if they disagree):

36. **The board is its own process** (`npm run board`), not part of the stdio MCP server, for the same reason as the worker: the MCP server's lifetime belongs to the Claude client. It reuses `createServices`, so it reads exactly what `get-board` reads.
37. **Read-only, same allow-list.** GET/HEAD only; serves only `VOICEOPS_WORKSPACES`; the response (`http/boardResponse.ts`) is a deliberately smaller DTO than the MCP view: no actors, no command or event ids, no operation or source.
38. **Safe by default, explicit to widen.** Binds to `127.0.0.1`; on a loopback bind the `Host` header must be `localhost`, `127.0.0.1` or `[::1]` (DNS-rebinding defence, `hostAllowList`); any other `VOICEOPS_BOARD_HOST` makes `VOICEOPS_BOARD_TOKEN` mandatory (config refuses to start). The token is compared in constant time on SHA-256 digests; the page takes it from the URL **fragment** (`#token=…`), so it is never sent to a server or logged. The page, script and stylesheet carry no data and need no token.
39. **Polling with ETags, not SSE or websockets:** the board version is the ETag, a poll costs one tiny `304`, and it works on any browser including a TV's. Revisit if a push channel is wanted.
40. **The page script is plain ES2017 with no framework, no inline script, and `textContent` only** (a CSP forbids anything else); a static test fails the build if `innerHTML`/`eval`/arrow functions etc. appear in it. It keeps the last good board on failure and shows an amber "Offline: showing the last update from …" banner.
41. **Streamable HTTP MCP transport deferred** until the user confirms they want claude.ai connectors; it is a different, larger security surface (OAuth, public HTTPS) than the board.

### Gotchas

- **Node version:** default shell Node is v18.18.2. Anything run with it will fail (vitest 5 needs Node ≥ 22.12; the `db:*` scripts use `--env-file-if-exists`). MCP clients do not load nvm, so register the server with an **absolute** Node path, e.g. `/opt/homebrew/opt/node@24/bin/node` (v24.3.0), never a bare `node`.
- **stdout is the protocol.** Never write to stdout. Use the pino logger (stderr). `installStdoutGuard` redirects stray `console.log/info/debug` to stderr but cannot catch direct `process.stdout.write`.
- **File names containing "token" cannot be created in this environment** (a permission rule treats them as secret files). The confirmation-token helpers therefore live in `src/app/confirmationCode.ts` (exports are still `generateToken`, `hashToken`, `TOKEN_PATTERN`); name future files and tests accordingly. The same rule blocks `.env*` files.
- **PostgreSQL on this machine** has other projects' databases (`upms_sync`, `rl-hexagon-pwa`): never touch them. This project only creates `voiceops` (dev) and `voiceops_test` (tests) plus short-lived `voiceops_test_tmp_*` databases that the tests drop.
- **Tests need a running PostgreSQL.** `tests/global-setup.ts` creates and migrates `voiceops_test` and refuses a `TEST_DATABASE_URL` whose name lacks "test". Test files run serially (`fileParallelism: false`) because they share and reset that database; every integration test resets **all three** demo workspaces (`resetAll`). A failure to connect gives an actionable message; it is never skipped.
- `db:reset` deliberately **keeps** `workspaces.integrations` (configuration); the test helper clears it so tests do not leak a configured spreadsheet.
- **Pushing to GitHub:** `origin` is the SSH address `git@github.com:hetissh/alexa-inventory-manager-mcp-server.git`, and this repo's local git config sets `core.sshCommand` to use `~/.ssh/id_ed25519_second` (the key that is registered with the GitHub user `hetissh`; the default `id_ed25519` is not, so a plain SSH push fails with "Permission denied (publickey)"). The assistant's own shell has no SSH key or stored HTTPS login and GitHub is blocked in the in-app browser, so pushes run from the user's terminal (the assistant can type the push into a terminal tab for the user to watch). HTTPS pushes need a personal access token, not the account password. A pre-push hook runs the company gitleaks check.
- **Google's documentation site (`developers.google.com`) is blocked by org policy in the build environment**, so the Sheets API quotas and console steps could not be checked against the source; the setup guide is written from knowledge, not verified, and the quotas must be read from the Cloud console.
- **A key file path needs a `.env` the user creates** (`server-ts/.env`, loaded by `npm run worker` / `npm run sheets` via `--env-file-if-exists`); an AI cannot write `.env*` here. The key itself must never be pasted anywhere or read by an assistant.
- **Worker tests need a clock ahead of the database's:** jobs are stamped with the database's `now()`, so `realClock()` in `tests/helpers/sync.ts` starts a minute ahead of real time.
- **vitest 5 mocks used with `new`** must be function expressions, not arrows (see `tests/unit/googleClient.test.ts`).
- **Not covered by tests (documented):** the `ROLLBACK`/rethrow path at the end of `infra/db/seed.ts` (lines 56–57), one branch in `pgStore.ts` (a unique violation on an unrelated constraint), and a few defensive branches in `http/boardServer.ts` (fallbacks for a missing method, URL or Host header, which Node always supplies for server requests, and an `undefined` check kept only to narrow a type). All files stay above the threshold.
- **The board needs the allow-list too:** `npm run board` serves only `VOICEOPS_WORKSPACES` (default: just `VOICEOPS_WORKSPACE`), so name all three workspaces to see the cafe and repair boards; otherwise their URLs say 404. There is no `.env.example` (an AI cannot create `.env*` files here); the user creates `server-ts/.env` if they want these set permanently.
- **Board page tests run the browser script in `node:vm` with a tiny fake DOM** (`tests/unit/boardPage.test.ts`), not a real browser. The page was also looked at in the in-app browser (below), but there is no automated browser test.
- **Tests that need a Host header or a method `fetch` will not send** use `tests/helpers/http.ts` (`node:http`, one connection per request).
- **`cd` in a shell call persists** (it moved the working directory to `server-ts/` twice during M4): use absolute paths or `git -C`/`npm --prefix`, never `cd`. BSD `sed -i` needs a suffix argument on macOS; prefer the edit tool or Python for in-place edits.
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
| M3 Sheets | Outbox worker, retries, sync status, `retry-sync` | **Done 2026-10-20** (built 2026-10-19; verified live against a real Google Sheet on 2026-10-20) |
| M4 Hardening | Streamable HTTP + auth, board endpoint, rehearsal (demo reset tool already exists) | **Started 2026-10-19:** board server and page built and tested, demo script written; Streamable HTTP + auth not started (needs the user's decision); three rehearsals pending |

## Log (newest first)

### 2026-10-20 — M3 verified live against real Google Sheets

**What was done**
- The user set up Google as in `docs/google-sheets-setup.md` (project, Sheets API, service account, JSON key kept in `~/Downloads`, one blank Sheet shared with the service account as Editor) and gave the sheet URL, the service account's email and the key file's absolute path. The key's contents were never read or shown; only Google's client library reads it. No `.env` exists yet: the path was passed as `GOOGLE_APPLICATION_CREDENTIALS` in the environment of each command.
- `npm run sheets -- connect northside-warehouse <url>` succeeded (created the tabs, wrote the current state); `sheets check` said reachable and writable. The worker ran as `npm run worker`. Changes were made by a throwaway MCP client script that spawns the built `dist/bin.js` against the dev database (it lives in `/tmp`, not in the repo). The sheet was read back through the Sheets API (read-only scope) to see what was actually written.

**Verified live (actually run)**
- **(a) Change reaches the sheet.** Add 20 Air Filter: Resources row showed 55 and Activity gained a row with before/after and sync status; later changes (Oil Filter +5, Brake Pads −10) did the same. Commit-to-"spreadsheet synced" time, from the event's `createdAt` to the worker's log line, with the worker idle-polling at 1 s: **3.8 s, 2.8 s, 2.5 s** (three samples; target was about 10 s). `list-events` showed `pending` right after the change and `synced` a few seconds later.
- **(b) Failure leaves the change intact.** With the integration temporarily pointed at a nonexistent sheet id (set by SQL on the dev database, then restored), the change was committed and the board showed the new quantity, the event went to `failed` at once with "The spreadsheet was not found. Check its id and that it still exists.", the worker logged that it was giving up, and after restoring the id, `retry-sync` for that event turned it `synced`. This exercised a 404 (permanent error) path. **Not exercised live:** a 403 after un-sharing the sheet, and the retryable/backoff path (429/5xx) against real Google (covered only with the fake).
- **(c) Backlog.** With the worker stopped, a change left `get-workspace` showing `spreadsheetSync: pending 1`; starting the worker cleared it to 0 and the rows appeared in the sheet. The worker also stopped cleanly on SIGTERM (exit 0) three times.
- Afterwards the dev database was reset to fixtures (`db:reset`, which keeps the sheet connection) and the workspace reconnected so the Resources tab shows the fixture values again.

**Not verified / caveats**
- Not driven by a real Claude session (a script played the client), and the worker was only run for minutes, not hours.
- The real Sheets API quotas were not looked up. The Google docs site is blocked here; read them from the Cloud console.
- The Activity tab still holds the five rows from these tests (events that no longer exist after the reset). The worker only appends, so the user can delete those rows by hand; they do not affect later syncing.
- The sheet's sharing settings were not inspected: the shared link ends in `?usp=sharing` (what Google appends to any share link). The user should confirm it is shared only with the service account and not "anyone with the link" (the setup guide says so).
- The key file's permissions (`chmod 600`) could not be checked by the assistant (listing the file was blocked); `chmod` printing nothing is normal, it only prints on error. The key sits in `~/Downloads`; recommended to move it (see Next actions).

**Decisions / findings**
- M3 is marked done on this evidence. Nothing in the code changed: the live run found no defects.
- `retry-sync` takes an `eventId` (not a workspace); find it with `list-events`. The change tools take the resource as `resource`, not `target`.

**Next actions**: see "Next actions" item 1 (move the key, create `.env`, quotas), then the rest of M4.

### 2026-10-19 — M4 (first slice): live-board web server, page and demo script

**Done**
- **Board server** (`server-ts/src/http/`): `boardServer.ts` (node:http routes: `/workspaces/{id}/board` JSON with ETag/304, `/board/{id}` page, `/board/assets/board.{js,css}`, `/health`, `/` redirect, `/favicon.ico`; GET/HEAD only; Host allow-list on loopback binds; optional bearer token; CSP and other security headers; generic error bodies; request logging without query strings), `boardResponse.ts` (the smaller DTO), `boardPage.ts` (HTML shell, dark high-contrast CSS, ES2017 script), `main.ts` (`startBoardServer`: config, services, listen, graceful SIGINT/SIGTERM shutdown), `bin.ts` (process entry).
- `src/loopback.ts` (shared loopback check). **Config:** `VOICEOPS_BOARD_HOST` / `_PORT` / `_TOKEN` / `_POLL_MS`; a non-loopback host requires a token. Logger redacts `boardToken`. ESLint: `src/http` may not import `infra`, `mcp`, `pg` or the MCP SDK. npm scripts `board` and `board:dev` (also at the repo root).
- **Docs:** `docs/demo-script.md` (new), README ("Live board", env vars, `board` command, layout), `docs/mcp-server-plan.md` (§8a, layout, §10 progress, §12), this file.

**Verified (actually run)**
- `npm run local:gate` green: typecheck, lint, **674 tests in 51 files** (105 new), 99.85 % statements / 99.39 % branches / 100 % functions, every file ≥ 90 %, build.
- New tests: the page script in a fake DOM (first render, 304, redraw, sections hiding, stale banner and recovery, 401/404/500/network error messages, token from the fragment and never in the URL, hostile text rendered as text, no `innerHTML`/`eval`/modern syntax, no inline script in the shell); the response mapper (shape, ISO dates, nothing about who or how); the server against real PostgreSQL over real HTTP (JSON, ETag/304/`*`, HEAD, 405 with `Allow`, allow-list, unknown workspace, bad ids, 503 and 500 with generic bodies, token cases including wrong length and wrong scheme, token checked before existence, Host check including spoofed names, `/` redirect, CSP and security headers, 404/400/204, query strings kept out of logs, a reply that cannot be sent is logged and the server stays up); the process (serves and stops on SIGTERM and releases the port, loopback Host check, token flag and no token in logs, allow-list, double stop, port in use, bad config, no token on a network bind, unreachable database, schema behind); the entry point (exit 0 / 1); config rules.
- Looked at by hand in the in-app browser against the dev database: the warehouse board (alert banner, highlighted low-stock row, maintenance chip), the cafe (struck-through sold-out item), the repair shop (assignees); each page updated within about 3 s of a change; after Ctrl-C of the server the page kept its last board and showed the amber offline banner. The dev database was reset afterwards.
- **Not verified:** a real Fire TV or other TV browser (only the ES2017/no-framework constraint and the in-app browser), a network-wide bind with a token from a second device, the board under load or over hours, the demo script run end to end by a person (the three rehearsals), the Streamable HTTP MCP transport (not built).

**Decisions / findings**
- See decisions 36–41. The new tests passed against the server without product fixes; the failures along the way were mistakes in the tests themselves (a wrong fixture expectation, a substring check that matched "resources" for "source", a wrong expected title, lint rules on mocks). One product change came out of testing: the Host allow-list rule was extracted into `hostAllowList()` so it can be tested without binding a network-wide port (which would also trigger macOS's firewall prompt).
- A favicon route (`204`) and a guard that turns an unparseable request target into `400` were added (browsers always ask for `/favicon.ico`; an unparseable target such as `//` would otherwise end as a `500`); both are tested.

**Next actions**
1. Ask the user whether they want the Streamable HTTP MCP transport with auth (claude.ai connectors) before building it.
2. Push `feat/m1-core-loop` (the docs commit and this slice are local only) only when the user asks.
3. M3 live verification when Google credentials arrive; then the three rehearsals.

### 2026-10-19 — M3: spreadsheet sync (built; live verification pending)

**Done**
- **Ports and rows** (`src/app/`): `SheetsGateway`, `SyncQueue` and friends (`syncPorts.ts`), `SheetsError`, pure row builders for both tabs (`sheetRows.ts`), `syncWorker.ts` (batch per workspace, backoff, lease takeover, polling loop that survives failed cycles), `syncService.ts` (`retry`).
- **Infra:** PostgreSQL queue with the per-workspace advisory lock (`pgSyncQueue.ts`), `setSheetsIntegration`, store additions (`listEventsByIds`, `requeueSync`, `getSyncBacklog`, `syncError` on events), the Google gateway with error classification (`infra/sheets/googleGateway.ts`) over a small `SheetsApi`, and the real client adapter (`googleClient.ts`, RAW writes, Sheets scope only). No migration was needed.
- **Processes and CLI:** `src/worker/{main,bin}.ts` (separate process, clean shutdown on SIGINT/SIGTERM), `src/cli/sheets*.ts` (`connect` proves access, creates the tabs, writes the current state, then enables syncing; `check`; `disconnect`; accepts a sheet URL or id), npm scripts `sheets` / `worker` / `worker:dev` (also at the repo root).
- **MCP:** tools `retry-sync` and the gated `reset-workspace`; `list-events` / `get-board` carry `syncError`; `get-workspace` carries the backlog; server instructions explain pending → synced and retry-sync.
- **Config:** `VOICEOPS_SYNC_POLL_MS`, `VOICEOPS_DEMO_TOOLS`; `GOOGLE_APPLICATION_CREDENTIALS` is read by Google's library only.
- **Docs:** `docs/google-sheets-setup.md` (what the user must do and hand over, commands, troubleshooting, limits), `README.md`, `docs/mcp-server-plan.md` §7 as built.

**Verified (actually run)**
- `npm run local:gate` green: typecheck, lint (layering rules included), 569 tests in 45 files, 99.8 % lines / 99.8 % branches / 100 % functions, every file ≥ 90 %, build.
- Against an in-memory spreadsheet and real PostgreSQL: a burst of changes is written once (one Resources write, one Activity append) and every job ends `synced`; a retryable failure marks the update `retrying` with the reason and a 2 s backoff that doubles, is capped, and ends in `synced` or, after 8 attempts, `failed`; a non-retryable failure fails at once; unclassified errors retry; a lost acknowledgement does not duplicate an Activity row; a disconnected workspace fails with a clear message; `retry-sync` requeues and then succeeds; a held workspace lock makes another worker report `busy`; two racing workers write each change exactly once; a job abandoned by a dead worker is taken over after its lease; the polling loop syncs new work, survives a failing cycle and stops on abort; the worker process syncs and shuts down on SIGTERM and refuses a bad config, an unreachable database and a schema that is behind; the CLI connects, checks, disconnects and refuses bad input, and does not connect when the sheet cannot be reached; the gateway creates only missing tabs and headers, writes header + rows then clears the tail, and classifies errors; the Google client adapter sends RAW values, `INSERT_ROWS` and only the Sheets scope.
- The **real** Google client library, with no credentials: `npm run sheets -- connect northside-warehouse <fake id>` printed "Google credentials are not set up: point GOOGLE_APPLICATION_CREDENTIALS at the service-account key file." and left the dev database unconnected. The root `npm run sheets` / `npm run worker` scripts forward their arguments.
- **Not verified:** anything against real Google Sheets (no credentials exist yet), the ~10 s end-to-end target, real Sheets API quotas, the setup guide's console steps (the Google docs site was blocked), the worker as a long-running process over hours, MCP Inspector, a real Claude session. Committed on `feat/m1-core-loop` after the M2 commit (not merged, not pushed); the commit hook's company security checks (gitleaks) run on commit.

**Decisions / findings**
- See decisions 27–35. The big one: the Resources tab is a rewritten snapshot, so no `sheet_rows` table and no row-mapping bugs, at the cost of a whole-tab write per cycle.
- Per-workspace advisory locking replaced the plan's `SKIP LOCKED` claim: two workers could otherwise write older state over newer state with no later job to repair it.
- Testing needed a clock ahead of the database's (jobs are stamped by Postgres); a hidden source of "idle" results until found.

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
