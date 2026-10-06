# Discovery report — pass 1 + baseline

Ranked by risk, not category. Full detail in the sibling files under `.claude/ai-toolkit/context/`.

## 1. Dual-session pipeline retirement (resolved this session, execution pending)
The entire Antigravity/Gemini dual-session model-delegation pipeline (`AGENTS.md`'s "Multi-Model Delegation Workflow", `.agents/rules/model_delegation.md`, `.agents/rules/handoff_commands.md`, `.claude/commands/{plan,review,apply,drop,hold,where}.md`) is being replaced by AI Toolkit's `implementer`/`test-writer`/`traceability-reviewer` (design doc section 7), project-scope only — global `~/.claude/` config is explicitly left untouched per your decision. See `ai-context-audit.md`. Concrete rewrites proposed in Phase 4, not yet applied.

## 2. Bus factor — `src/modules` is single-author
Both existing modules (address-dedup, cartography-watcher) were authored entirely by one contributor (`g611045@...`); `src/components` and `src/app` are similarly skewed (89/97 and 50/54 commits). `src/core` and `src/ui-kit` are the only areas with real shared ownership. See `git-archaeology.md`. No action taken — informational risk.

## 3. Coverage is uneven, not low-effort
Overall line coverage is 46.5%, but concentrated: `modules` (99%), `common` (79%), `types` (86%) are well covered; `services`, `services/engines`, `services/streaming`, `workers`, `binary` (0–9%) are essentially untested. These are exactly the comparison/sync engines flagged as churn hotspots in `git-archaeology.md` (`SpatialComparisonEngine.ts`, `comparisonWorker.ts`, `DbVsFileComparisonEngine.ts`). Per design doc section 5 phase 3, this bootstrap does not generate characterization tests — flagging as the critical untested paths for a human decision on whether/when to backfill.

## 4. No standalone typecheck command
`build` embeds the TypeScript check (passed, 2.5s) but there's no `tsc --noEmit`-equivalent script for a cheap, build-independent level-0 check. See `commands.md`. Open question, not blocking.

## 5. No CI workflow
`.github/workflows` does not exist; all verification is local/branch-based per `testing_branch_workflow.md`. Level 3 (PR/CI, design doc section 6) has nothing to attach to yet. Recorded `not-applicable` for this bootstrap.

## 6. Clean baseline, clean hygiene
751/751 tests passing, zero lint findings, clean build, zero TODO/FIXME/HACK in `src`, zero committed artifacts that should be gitignored (coverage/cache/`.env`/`.next` already correctly ignored — `/graphify-out` was already present in `.gitignore` before Graphify was even installed). No remediation needed.

## 7. Permission-isolation spike result
See manifest `spikes.agent_scoped_hooks` for the outcome of testing whether a `PreToolUse` hook declared in agent frontmatter can reliably isolate `implementer` from `test-writer` by file path, per the mandatory feasibility spike in design doc sections 7 and 12.

## Open questions (collected)
- Glossary: is the recurrence of `padron`/`suid`/`departamento` across db-sync tools and address-dedup coincidental, or worth a shared `src/core/types/` definition? (`glossary.md`)
- No standalone typecheck script — wanted for level-0 hooks, or is build-embedded checking sufficient? (`commands.md`)
- Many stale `feat/*`/`fix/*` local branches past their merge point — routine cleanup candidate, not acted on. (`git-archaeology.md`)
- No LLM key configured on this machine, so Graphify's semantic (doc/image) extraction and community auto-labeling are unavailable; code-structural graph only. Revisit only if doc-linked graph queries are wanted. (`graph-summary.md`)
