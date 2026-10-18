@AGENTS.md

# Claude Code notes

- Start every session by reading `CHANGELOG.md` ("Current state") and `docs/mcp-server-plan.md`.
- Update `CHANGELOG.md` in the same change as every code, config, dependency or doc change (AGENTS.md §6).
- Dev tooling needs Node ≥ 22.12 and the default shell Node is 18: run `nvm use` (`.nvmrc` = 24) or prefix commands with `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`.
- Run `npm run local:gate` (repo root) before declaring work done.
- Do not register this server in the user's Claude configuration yourself; give them the command (see `README.md`).
