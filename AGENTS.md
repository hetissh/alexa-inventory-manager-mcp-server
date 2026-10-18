# Agent Instructions & Architecture Guidelines (`agent.md`)

This document outlines the strict engineering standards, architectural patterns, and execution rules for AI assistants (Claude and Codex) contributing to this hybrid **Node.js (TypeScript) + Python** Model Context Protocol (MCP) server repository.

---

## 1. Core Architecture & Protocol Standards

- **Zero-Pollution Standard (stdio Transport):** 
  - All communication over `stdio` must be strictly reserved for MCP JSON-RPC messages. 
  - **CRITICAL:** Never write application logs, `console.log`, or `print()` statements to `stdout`. All logs, debugging info, and warnings must be routed to `stderr` or a dedicated file transport to avoid breaking the JSON-RPC message framing stream.
- **Hybrid Service Boundaries:**
  - **TypeScript Core (`/server-ts`):** Acts as the primary MCP protocol bridge facing the host environment (e.g., Claude Desktop, Cursor). Handles strict input validation, routing, and high-level orchestration.
  - **Python Service (`/service-py`):** Encapsulates data processing, AI/ML inference, or heavy numerical workloads. Communication between TypeScript and Python must occur via robust local IPC, secure child processes, or structured gRPC/FastAPI bindings.
- **Primitive Conventions:**
  - **Tools:** Action-oriented, verb-first names (e.g., `fetch-repository-data`, `execute-query`). Every tool must explicitly define tool hints (`readOnlyHint`, `idempotentHint`, `destructiveHint`).
  - **Resources:** Uniform Resource Identifiers (URIs) representing readable state or context files.
  - **Prompts:** Reusable templates designed to guide user workflows or agent actions.

---

## 2. TypeScript / Node.js Engineering Rules

- **Strict Type Safety:** Enable strict mode in `tsconfig.json`. **Never use `any`.** Avoid double-casts (`as unknown as T`) unless a documented third-party library limitation forces it, in which case an inline comment must justify why it is safe.
- **Zod as the Security Boundary:** All incoming tool arguments must be validated using `zod` schemas complete with descriptive field definitions. LLM inputs must never be trusted implicitly.
- **ES Modules & Import Extensions:** Use native ES Modules (`import`/`export`). Relative file imports must explicitly include the `.js` extension (e.g., `import { validatePayload } from "./utils.js";`). Organize imports with external packages first, followed by internal modules.
- **No Floating Promises:** Every promise must be explicitly awaited, returned, handled with `.catch()`, or explicitly discarded using the `void` operator coupled with a one-line explanation comment.
- **Lifecycle Management:** Clean up child processes, timers, active intervals, and open transport connections gracefully when shutdown signals (`SIGINT`, `SIGTERM`) are received.

---

## 3. Python Engineering Rules

- **FastMCP Pattern:** Leverage the official Python `mcp` SDK and `FastMCP` wrapper for rapid, clean, decorator-based tool definitions where appropriate.
- **Type Hints & Docstrings:** Adhere strictly to PEP 8 standards. Every public function must contain comprehensive type hints and descriptive docstrings explaining expected parameters and return contracts.
- **Error Propagation:** Handle runtime failures by raising structured domain exceptions that map cleanly to standard MCP error codes, ensuring the host agent receives an actionable failure message instead of an unhandled stack trace.

---

## 4. AI Assistant Division of Labor (Claude vs. Codex)

- **Claude (Lead Architect & Reviewer):**
  - Use Claude for high-level system architecture design, multi-file refactoring, resolving complex protocol synchronization issues, verifying Zod/Pydantic type parity across the TypeScript-Python bridge, and writing system documentation.
- **Codex (Speed Scaffolder & Code Generator):**
  - Use Codex for rapid boilerplate generation, implementing individual tool functions from specification, writing unit test suites (`vitest` for TS, `pytest` for Python), and mapping JSON-to-interface data structures.

---

## 5. Testing & Quality Gates

- **Code Coverage Thresholds:** Every file must maintain a minimum of **90% code coverage** across lines and branches before merging.
- **Automated Gates:** Run local checks (`npm run local:gate` or equivalent pytest commands) before submitting code. Unhandled schema validation failures or broken protocol handshakes will fail CI pipelines instantly.

---

## 6. Change Log & Hand-off Protocol (MANDATORY)

`CHANGELOG.md` (repo root) is the single source of truth for what has been built, what is next, and why. Any AI assistant or engineer must be able to take over from it without re-deriving context.

- **Before starting work:** read `CHANGELOG.md` ("Current state", then the newest log entry) and `docs/mcp-server-plan.md`.
- **With every change set** (code, config, dependency, doc, or decision): update the "Current state" section and add a dated log entry **in the same change set**. Never leave it stale. Each entry covers: what changed and why, files or areas touched, how it was verified (state exactly what was run; never claim verification that did not happen), decisions and deviations, gotchas and failed approaches, and the concrete next actions.
- Keep the milestone tracker table current. Record open questions and assumptions explicitly, and remove them once resolved.
- Keep entries concise, newest first. Never put secrets, credentials, or client-confidential data in the changelog.
- The product build plan lives in `docs/mcp-server-plan.md`; change it when the architecture changes and note the change in the log.