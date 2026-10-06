# Commands

Evidence: `package.json` scripts (root). No CI config found (`.github/workflows` absent) — commands below are evidenced by `package.json` only, not cross-checked against CI.

| Capability | Command | Source |
|---|---|---|
| dev | `npm run dev` (runs `modules:routes` first via `predev`) | package.json:6-7 |
| build | `npm run build` (runs `modules:routes` first via `prebuild`) | package.json:8-9 |
| lint | `npm run lint` (`eslint`) | package.json:13 |
| typecheck | not declared as a script | open question |
| test (unit) | `npm test` / `npm run test:coverage` — Vitest | package.json:15,17 |
| test (e2e) | `npm run test:e2e` — Playwright | package.json:18 |
| static analysis | `npm run doctor` (`react-doctor`) | package.json:14 |
| graph | `npm run graph` / `npm run graph:serve` — project already has its own `scripts/generate-dependency-graph.cjs`, separate from Graphify | package.json:21-22 |
| generated routes check | `npm run modules:routes:check` | package.json:11 |

## Open questions
- No dedicated `typecheck` script (e.g. `tsc --noEmit`) found in package.json. `AGENTS.md` and `.agents/rules/testing_branch_workflow.md` list the local gauntlet as lint → test → build → doctor; typecheck is presumably covered implicitly by `build` (Next.js type-checks during build). Confirm whether a standalone typecheck command is wanted for level-0 hooks.
- No CI workflow file exists under `.github/workflows`. All commands above are evidenced from scripts only; `testing_branch_workflow.md` describes a branch-based local+testing-branch gauntlet instead of CI. Level 3 (PR/CI) in the leveled-verification model (design doc section 6) has no CI to hook into yet — record as `not-applicable` for now.
- Test suite duration not yet measured (requires running the suite — delegated to baseline phase, section 5 of design doc, since the orchestrator does not execute tests itself per project policy).
