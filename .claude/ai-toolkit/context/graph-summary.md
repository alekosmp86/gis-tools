# Graph summary

Built with Graphify 0.9.57, `--code-only` (no LLM key configured on this machine, so docs/images were skipped per Graphify's own fallback — code AST extraction needs no API key, consistent with design doc 4.1's "no API calls for the code" requirement). Full detail: `graphify-out/GRAPH_REPORT.md` (gitignored, local only). Query a specific area with `graphify query "<question>"` rather than loading the report.

- 3349 nodes, 8236 edges, 172 communities over 159 code files (229 more cached/unchanged from a prior extraction).
- Community naming used raw hub identifiers (no `graphify label` pass — that also needs an LLM key); treat hub names as pointers, not final labels.

## Main modules and relations (from `structure.md` + hub nodes)
- **`src/app/modules.registry.ts`** — composition root; the only file allowed to import a module. Hub node confirms it sits at the center of module wiring.
- **`src/modules/address-dedup/`** — largest single cluster by hub count (`handlers.ts`, `types.ts`, `PgAddressRepository.ts`, `PgRemovalRepository.ts`, `dedupClient.ts`, `removal.ts`, `DedupDashboard.tsx`, `DedupResultsView.tsx`, `SuidMappingStep.tsx`, `dedupLabels.ts`, `groupFilters.ts`, `summaryView.ts`). Matches `structure.md`'s api/domain/services/data/ui split.
- **`src/modules/cartography-watcher/`** — second module cluster (`handlers.ts`, `types.ts`, `WatcherDashboard.tsx`, `WatcherOrchestrator.ts`, `watcherOrchestration.test.ts`). Reference implementation per `AGENTS.md`.
- **Legacy sync tools (`src/core`/`src/components`/`src/services`)** — `SpatialComparisonEngine.ts`, `SpatialGeometryComparator.ts`, `ShapefileParser.ts`, `SqlScriptBuilder`, `SqlPatchDrawer.tsx`, `SqlExecutionModal.tsx`, `comparison.ts`, `db.ts`, `DbConfig` form the db-sync / comparison engine cluster — the pre-module code the modular-monolith convention explicitly does not retrofit.
- **Spatial rendering** — `ViewportFeatureIndex.ts`, `useViewportFeatureWindow.ts`, `useVectorChunkStream.ts`, `MapPopupPresenter.ts`, `mapConstants.ts` — map viewport/windowing concerns, separate from the sync engines.
- **Tooling/build** — `generate-module-routes.cjs`, `generate-dependency-graph.cjs` (the project's own pre-existing graph tool, separate from Graphify), `modules.registry.ts`.

## Open questions
- No LLM key is configured, so semantic (doc/image) extraction and community auto-labeling are unavailable on this machine. Purely code-structural graph (AST) is sufficient for the toolkit's navigation use case; revisit only if doc-linked queries are wanted later.
