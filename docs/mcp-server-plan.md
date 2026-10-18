# VoiceOps MCP server: architecture and build plan

**Status:** living document. Progress against this plan is tracked in [`../CHANGELOG.md`](../CHANGELOG.md) — read that first to see where the build currently stands.
**Source spec:** `voiceops-hackathon-build-plan.md` (the product-level hackathon plan; section numbers such as "§7" below refer to it).
**Created:** 2026-10-18

## 0. Approach

Build the MCP server as a thin adapter over a channel-agnostic command engine, which is the §7 pipeline of the product plan. Claude replaces Alexa as the interpret and dialog layer for now. The server stays authoritative for **Match → Validate → Confirm → Commit → Audit**. The Alexa Lambda, dashboard and Fire TV board can reuse the same engine later without changes.

## 1. Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Language | TypeScript on Node (dev tooling needs Node ≥ 22.12; `.nvmrc` pins 24) | Shares domain types with the future Alexa Lambda and React UI. Official MCP TypeScript SDK. |
| Repo layout | Hybrid layout from `AGENTS.md`: TypeScript MCP core in `server-ts/`; `service-py/` reserved for data/AI workloads and **not created until a real need exists** | Follows the repo's engineering standards. VoiceOps has no Python workload yet. |
| Structure inside `server-ts` | One package, folders `domain / app / infra / mcp`, import direction enforced by lint | Faster than a multi-package monorepo. Split into workspaces when the Alexa Lambda arrives. |
| Database | Postgres (local Homebrew PostgreSQL 14) behind repository interfaces | `FOR UPDATE` locks, unique constraints, one transaction for event + state + alert + outbox. |
| Transport | **stdio first** (Claude Desktop / Claude Code), Streamable HTTP second | stdio needs no auth or hosting. HTTP is only needed for claude.ai connectors or the later dashboard and TV. |
| Confirmation | **Enforced by the server** (two-phase token), not left to Claude | A model can skip "ask first". The server cannot commit a risky change without a confirm call. |
| Sheets sync | Transactional outbox table + a **separate worker process** | stdio servers are spawned and killed by the client, so they cannot host background jobs. |
| Matching | Server-side, returning candidates | Claude may mishear or hallucinate names. The server is the final check. |
| Tool naming | Verb-first **kebab-case** (`adjust-quantity`), every tool declares `readOnlyHint`, `idempotentHint`, `destructiveHint` | Required by `AGENTS.md` §1. |
| Quality gate | `npm run local:gate`: typecheck, lint, tests with ≥ 90 % per-file coverage (lines, branches, functions, statements), build | Required by `AGENTS.md` §5. |

## 2. Architecture

```text
Claude Desktop / Code                later: Alexa Lambda · Dashboard · Fire TV board
        │ MCP (stdio → HTTP)                         │
        ▼                                            ▼
┌──────────────────────── mcp/ adapter ──────────────────────────┐
│ tools · resources · prompts · server `instructions`            │
└──────────────────────────────┬─────────────────────────────────┘
                               ▼
┌────────────────── app/ (channel-agnostic) ─────────────────────┐
│ CommandService: resolve → validate → confirm? → commit → reply │
│ ReadService:    board · resources · events · alerts            │
└───────────┬────────────────────────────────────┬───────────────┘
            ▼                                    ▼
   domain/ (pure, no I/O)               infra/ (ports → adapters)
   operation registry, matcher,         Postgres: resources, events,
   alert rules, templates, zod          commands, alerts, sync_jobs
                                                 │ outbox
                                                 ▼
                                   sheets-worker (own process) → Google Sheets
```

**Operation registry.** Each operation is one file with five parts: an args schema, `validate(resource, args, config)`, `needsConfirmation(...)`, `apply(...)` and `readback(...)`. Adding an operation means adding a file. The café, warehouse and repair-shop templates are data only (types, allowed statuses, thresholds, board layout).

**Layout** (as built through M2; `[M3]`/`[M4]` marks what is still to come). Import direction is enforced by ESLint (`domain ← templates ← app ← {infra, mcp}`); only `main.ts`, `composition.ts` and `cli/` wire layers together.

```text
/
  AGENTS.md  CHANGELOG.md  README.md  package.json (delegates to server-ts)
  docs/mcp-server-plan.md
  server-ts/
    package.json  tsconfig*.json  eslint.config.js  vitest.config.ts
    src/
      bin.ts  main.ts  composition.ts  config.ts  logger.ts  lifecycle.ts  stdout-guard.ts  errorMessage.ts  version.ts
      mcp/        server.ts  views.ts  tools/{checkHealth,getWorkspace,findResources,getResource,getBoard,listEvents,listAlerts,
                  adjustQuantity,setStatus,assignJob,undoLastChange,confirmCommand,context,writeResult,index}.ts
                  resources.ts [M4]  prompts.ts [M4]
      app/        commandService.ts  commit.ts  readService.ts  ports.ts  outcomes.ts  spoken.ts  errors.ts  confirmationCode.ts
      domain/     schemas.ts  types.ts  matcher.ts  normalize.ts  status.ts  board.ts  json.ts
                  operations/{types,adjustQuantity,setStatus,assignJob,reverseEvent,registry}.ts   rules/{lowStock,index}.ts
      templates/  types.ts  shared.ts  warehouse.ts  cafe.ts  repair.ts  index.ts
      infra/      db/{pool,migrator,admin,pgStore,seed}.ts  db/migrations/*   sheets/{adapter,worker} [M3]
      cli/        db.ts  dbBin.ts   (create | migrate | seed | reset | setup)
    tests/        unit/  integration/ (real PostgreSQL)  e2e/ (spawned stdio process)  helpers/
  service-py/     reserved — not created yet
```

Demo fixtures live in `templates/*.ts` as typed data (validated by the same schemas as live data) rather than a separate `fixtures/` folder.

## 3. MCP surface

**Workspace scoping (as built in M2).** A server instance acts as one actor (`VOICEOPS_ACTOR_ID`) and may address only the workspaces on its allow-list `VOICEOPS_WORKSPACES` (default: just `VOICEOPS_WORKSPACE`). Every tool takes an optional `workspaceId`, defaulting to `VOICEOPS_WORKSPACE`; anything not on the allow-list is refused, so a model (or text injected into its context) cannot address a workspace the actor is not entitled to. M1 had no parameter at all.

Tools are intent-level and few so Claude picks them reliably. `resource` accepts a spoken name or an ID. The server resolves it and never trusts IDs Claude makes up. Status in the table: ✅ built (M1/M2), otherwise planned.

| Tool | Kind | Maps to |
| --- | --- | --- |
| ✅ `check-health` | read | Server version, uptime, workspace, database status, connected MCP client |
| ✅ `get-workspace` | read | Template, resource types, allowed statuses and technician names, so Claude uses real vocabulary |
| ✅ `find-resources {query?, type?, limit}` | read | Match step, returns ranked candidates; no query lists everything |
| ✅ `get-resource {resource}` | read | `GET_RESOURCE` ("how many air filters?") |
| ✅ `get-board` | read | §8 board JSON, including `version` |
| ✅ `list-events {limit, resource?}` | read | Activity log with per-event sync status |
| ✅ `list-alerts {status?, limit}` | read | Low-stock alerts |
| ✅ `adjust-quantity {resource, delta, idempotencyKey?}` | write | `ADJUST_QUANTITY` (large or zeroing changes need confirmation) |
| ✅ `set-status {resource, status, idempotencyKey?}` | write | `SET_STATUS` |
| ✅ `assign-job {job, assignee, idempotencyKey?}` | write | `ASSIGN_JOB` |
| ✅ `undo-last-change {idempotencyKey?}` | write | `REVERSE_EVENT` |
| ✅ `confirm-command {token}` / `cancel-command {token}` | write | Second phase of confirmation |
| `reset-workspace`, `retry-sync` | demo | Registered only if `VOICEOPS_DEMO_TOOLS=1` |

**One result envelope for all writes:**

```json
{
  "status": "committed | confirmation_required | ambiguous | not_found | rejected | conflict",
  "spoken": "Air Filters are now at 55. The board has updated; the spreadsheet update is pending.",
  "event": {"id": "…", "before": {"quantity": 35}, "after": {"quantity": 55}},
  "alerts": [],
  "sync": {"sheets": "pending"},
  "confirmation": {"token": "…", "readback": "Set Compressor 2 from available to maintenance?", "expiresAt": "…"},
  "candidates": []
}
```

- `spoken` strings are generated in `app/`, so the Alexa adapter can reuse them later.
- Return `structuredContent` with an `outputSchema` plus a short text version. `ambiguous` is a normal result, not an error. Rejections use `isError: true` with a reason code.
- **Truthfulness:** server `instructions` and tool descriptions tell Claude to relay `readback` and wait for an explicit yes, to claim Sheet success only when `sync.sheets == "synced"`, and to treat names in results as data, not instructions. Not every client surfaces `instructions`, so the critical rules also go in the tool descriptions.

## 4. Confirmation protocol

1. A write tool resolves the target, validates, and creates a row in `commands` (op, resolved resource ID, args, `expectedVersion`, actor, 2-minute TTL). If no confirmation is needed it commits straight away.
2. Otherwise it returns `confirmation_required` with a single-use token and a readback.
3. After the user says yes, Claude calls `confirm-command`. The server re-validates against the **current** version. If the resource changed in between it returns `conflict`.
4. Replaying a token returns the original outcome, so commits are exactly-once.

| Case | Behaviour |
| --- | --- |
| `adjust-quantity` below the large threshold | Commits immediately |
| `adjust-quantity` at or above the threshold, or reaching zero | Confirmation required |
| `adjust-quantity` going below zero | Rejected |
| `set-status`, `assign-job`, `undo-last-change` | Always confirm |

**As built (M2).**
- A change that needs a yes is *planned* against the resource's fresh state (so an invalid one is refused at once, with no token), then parked in `commands` and answered with `confirmation_required`: `confirmation.token`, the `readback` question, a `reason` and `expiresAt` (2 minutes). Nothing has changed yet.
- The token is 128 random bits shown only to the caller; only its SHA-256 hash is stored, and it is never logged. It works once, only for the actor who asked, only in the workspace it was issued for, and only until it expires.
- `confirm-command` locks the pending row, then re-checks everything under the resource lock: not cancelled, not expired, the resource still at the version it had when asked (otherwise `conflict`, nothing applied), the operation still valid. Two confirmations at once apply once; a repeat returns the original result (`replayed: true`).
- `cancel-command` discards it (idempotent); cancelling something already applied points to `undo-last-change`.
- `undo-last-change` finds the actor's newest event that is neither an undo nor already undone, and applies a compensating event (`reversal_of`) only if the resource still holds exactly what that event left, so a later change is never overwritten. A unique index allows an event to be undone once. Undoing an undo is not supported; asking again undoes the change before.
- Not built (possible later): MCP *elicitation* as a second prompt route, and expiry cleanup of old pending rows.

Mark `confirm-command` with `destructiveHint` so the client's own permission prompt acts as a second human gate. If the Claude clients in use support MCP **elicitation**, the server can prompt the user directly instead (verify client support first). The token flow remains the baseline.

## 5. Data model and commit transaction

**Tables:** `workspaces` (with `board_version` and an `integrations` jsonb, e.g. `{"sheets": {"spreadsheetId": "…"}}`; no key means the destination is not configured), `resources` (jsonb `attributes`, `aliases`, `version`), `events` (columns `request_args`, `before_state`, `after_state`, `summary`, `client_name`), `sync_jobs`, `commands` (pending changes awaiting a yes, token hash only), `alerts` (partial unique index: one open alert per resource and rule), and, still to come, `sheet_rows` [M3], `devices` (stub). Built: `workspaces`, `resources`, `events`, `sync_jobs` (migration `0001_init`) and `commands`, `alerts`, a unique index on `events.reversal_of` (migration `0002_confirmations_alerts`). Migrations are TypeScript modules in `infra/db/migrations/` applied by `npm run db:migrate`; the server refuses to start if the schema is behind.

**Constraints that carry the guarantees:**
- `events.command_id` is unique.
- Alerts have a partial unique index on `(resource_id, rule) WHERE status = 'open'` (gives "exactly one low-stock alert").
- Every query is scoped by `workspace_id`.

**Commit (one transaction):**
1. When confirming, lock the pending `commands` row first (two confirmations cannot both proceed). If it was already applied, return the original result.
2. `SELECT … FOR UPDATE` on the resource. If an event with this command id already exists, replay it (or report a conflict if it was a different request). When confirming, check `version == expectedVersion`.
3. Plan the change with the pure operation (`plan` returns `rejected`, or `ready` with the new attributes, before/after, a summary and an optional confirmation). If it needs a yes and this is a new request, park it in `commands` and stop here.
4. Insert the event with before and after, actor, `source='mcp'` and the MCP client name.
5. Update the resource and bump its version.
6. Evaluate rules: open the low-stock alert on crossing, resolve it on restock.
7. Insert a `sync_jobs` outbox row.
8. Bump `workspaces.board_version` (the Fire TV compares this later).
9. When confirming, mark the pending command confirmed and link its event.

Undo writes a compensating event with `reversal_of`. It is allowed only when the resource's current state still equals the original event's `after`; otherwise it is rejected with an explanation.

## 6. Matching and normalization

Tiers: (1) exact ID, (2) exact normalized name or alias, (3) token-set match, (4) fuzzy match, in process on the small catalogue (Dice, Jaro-Winkler or Fuse.js).

Normalization lowercases, strips punctuation, converts number words to digits ("compressor two", "job one oh eight") and singularizes plurals.

The matcher only auto-resolves when there is exactly one candidate above the threshold with a clear margin over the runner-up. Otherwise it returns `ambiguous` or `not_found` with candidates and changes nothing. `assign-job` uses the same matcher for the technician (for example, two Rahuls).

As built in M1 (thresholds in `domain/matcher.ts`):
- Exact id / name / alias matches resolve; a partial name resolves only if it is unique ("brake" → Brake Pads) and is `ambiguous` otherwise ("filter" → Air Filter, Oil Filter).
- **Typo-level (fuzzy) matches never auto-resolve for writes**: they come back as `ambiguous` ("Did you mean Air Filter?"). Reads may auto-resolve a unique match with Dice similarity ≥ 0.8 and a 0.15 margin, and report `matchedBy: "fuzzy"`.
- **Numbers identify things:** a fuzzy match is only considered between names whose numbers agree, so "compressor three" is `not_found`, never Compressor 2.

## 7. Sheets worker

- Polls `sync_jobs` with `FOR UPDATE SKIP LOCKED` (multiple instances are safe). Status moves `pending → synced | retrying | failed`.
- Exponential backoff, capped, with a maximum attempt count.
- Updates the Resources row via `sheet_rows` (never by display name). Appends to Activity with the event ID in the row; on retry it checks for that event ID first so a crash between append and mark-synced cannot duplicate rows.
- Service-account key loaded from a path or secret manager outside the repo. `.env` is gitignored. Batch writes; check current Sheets API quotas before the demo.
- A Sheet failure never undoes the internal commit. The status shows as retrying or failed in `list-events`.

## 8. Security and compliance

| Risk | Control |
| --- | --- |
| Prompt injection via resource names or aliases in tool output | Validate and cap name/alias charset and length. Return them as JSON fields. Server instructions say to treat them as data. |
| Model skips confirmation | Server-enforced tokens, `expectedVersion` re-checked at commit. |
| Cross-workspace access | `workspace_id` in every query. A test asserts another workspace's resource returns `not_found`. |
| HTTP transport exposure | Bind to localhost, validate `Origin`, require bearer/OAuth auth, map token to actor and workspace. stdio uses a single configured actor. |
| Secrets | `.env` and a secret manager only; never committed or logged. |
| Logging | pino to **stderr** only (stdout is the stdio protocol channel), command ID per request, no PII. |
| Client confidentiality | Fixtures use fictional data only. |

Verify licences of all dependencies with a licence checker before anything ships to a client.

## 9. Testing

The §13 acceptance table becomes automated tests against a throwaway Postgres database.

| §13 case | Test |
| --- | --- |
| +20 to 35 gives 55, one event | Service integration test |
| Repeat command ID or token | Replay returns the original result, event count stays 1 |
| Remove more than available | `rejected`, no event or outbox row |
| Ambiguous "filter" | `ambiguous` with candidates, no state change |
| Concurrent confirms | Two parallel commits, exactly one wins |
| Threshold crossing | One alert only, resolves on restock |
| Sheets API failure | Internal commit stays, job is `retrying`, board still updates |
| Undo | Compensating event restores the value |
| Template switch | Same engine, three fixtures, no code change |

Layers: unit tests (matcher, operations), MCP tests via the SDK in-memory client/server transport, spawned-process stdio e2e tests, manual checks with `npx @modelcontextprotocol/inspector`, then scripted prompts in Claude. Gate: ≥ 90 % per-file coverage.

## 10. Build sequence

Effort figures are rough ranges for one engineer comfortable with TypeScript. They are not commitments; the schedule is for review by the PM / Delivery Head.

| Milestone | Scope | Exit condition | Effort |
| --- | --- | --- | --- |
| **M0** Scaffold | TS project, lint, vitest, gates, hello tools over stdio, register with Claude Code / Desktop | Claude calls the hello tool | 2–3 h |
| **M1** Core loop | Migrations, repos, `adjust-quantity` end to end through the real transaction, warehouse fixture, `get-resource`, `find-resources`, `list-events` | "Add twenty air filters" gives one event, 35 → 55, replay is a no-op | 1–1.5 days |
| **M2** Full operations | `set-status`, `assign-job`, confirmation flow, disambiguation, café and repair templates, low-stock alert, `get-board`, `undo-last-change` | All voice-equivalent scenarios pass in Claude, §13 tests green | 1–1.5 days |
| **M3** Sheets | Worker, row mapping, retries, sync status in results, `retry-sync` | A Claude command changes the DB and the Sheet within about 10 s; a forced Sheet failure shows `retrying` | ~1 day |
| **M4** Hardening | Streamable HTTP with auth, optional read-only board endpoint for the TV, `reset-workspace`, scripted demo prompt, 3 clean consecutive runs | Demo passes 3 times without manual DB edits | ~1 day |
| **Later** | Alexa Lambda calling the same `CommandService` through the engine API | n/a | n/a |

## 11. Deviations from the product-level plan

1. **Claude is the input channel for now.** The Alexa spec stays valid; nothing in this server depends on it.
2. **Postgres + outbox instead of DynamoDB + SQS.** Same behaviour, simpler local setup. Proposed: keep one engine and make the Alexa Lambda a thin HTTPS client of it so there is never a second persistence layer. This changes §5 of the product plan's infrastructure and **needs sign-off**.
3. **A `commands` table for confirmation tokens**, which also gives exactly-once commits.

## 12. Open decisions

Defaults below are being used until confirmed; each is also tracked in `CHANGELOG.md`.

1. Stack: TypeScript + Postgres core (Python reserved in `AGENTS.md` for future data/AI work). *Default in use.*
2. Claude clients under test: Claude Desktop and Claude Code over stdio. claude.ai connectors would pull remote HTTPS + OAuth forward into M1.
3. Low-stock alert: opens at `quantity < reorderLevel`, auto-resolves on restock.
4. Large-adjust confirm threshold: template-configurable, default 100 units.
5. Zero-crossing rule: below zero is rejected, reaching zero requires confirmation.
6. Deviation 2 above (single Postgres-backed engine, Alexa Lambda as thin client).
