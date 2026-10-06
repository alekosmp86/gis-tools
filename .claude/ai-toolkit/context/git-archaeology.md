# Git archaeology

Evidence: `git log --name-only` (full history, 279 commits), `git log --format=%ae` per top-level directory, `git branch -a`.

## Churn hotspots (commit count per file, all history)
1. `docs/README.md` — 42
2. `AGENTS.md` — 25
3. `src/app/tools/db-shapefile-sync/page.tsx` — 20
4. `src/types/comparison.ts` — 19
5. `src/app/tools/db-csv-sync/page.tsx` — 19
6. `src/components/tools/db-csv-sync/CsvUploader.tsx` — 17
7. `.agents/handoff/TO_ORCHESTRATOR.md` — 16 (working artifact, not production code)
8. `src/components/tools/db-shapefile-sync/ShapefileUploader.tsx` — 14
9. `src/types/gis.ts` — 13
10. `src/hooks/useSuidMappingForm.ts` — 13

`src/types/comparison.ts`, `src/types/gis.ts` and the sync-tool pages/components are the real code hotspots — candidates for extra scrutiny (test coverage, review depth) on any future change.

## Bus factor per top-level area (distinct commit authors)
| Area | alekosmp86@gmail.com | g611045@net.in.iantel.com.uy |
|---|---|---|
| `src/modules` | 0 | 25 |
| `src/core` | 5 | 7 |
| `src/ui-kit` | 7 | 5 |
| `src/components` | 8 | 89 |
| `src/app` | 4 | 50 |
| `docs` | 7 | 64 |

**Risk**: `src/modules` has a bus factor of 1 (only `g611045@...` has ever touched it — both existing modules, address-dedup and cartography-watcher, were authored by a single contributor). `src/components` and `src/app` are heavily skewed the same way. `src/core` and `src/ui-kit` are the only areas with meaningfully shared ownership.

## Commit conventions
Conventional commits, consistently applied: `feat(scope):`, `fix(scope):`, `docs(scope):`, `test(scope):`, `perf(scope):`, `build:`. Scopes are mostly module/tool names (`address-dedup`, `handoff`, `issues`, `map`). A few early commit subjects carry a stray UTF-8 BOM character before the type (cosmetic, not functional — noted in `repo-hygiene.md`).

## Branches
279 commits on `main`/`testing` plus ~35 topic branches (`feat/*`, `fix/*`, `feature/*`), most already merged per the conventional-commit trail reaching `main`. Consistent with `.agents/rules/testing_branch_workflow.md` ("every branch cuts from main"; `testing` is disposable staging).

## Open questions
- Many `feat/*`/`fix/*` branches past their apparent merge point remain in the local branch list. Not a toolkit blocker — flagged only as routine hygiene (candidate for `git branch -d` cleanup), not acted on here per the non-destructive rule.
