# DB vs DB Sync — "Full Replace" mode (wipe + reload)

> **Scope**: `db-db-sync` tool only. Legacy code, extended in place; NOT a new module.
> **Status**: Spec v2 (mode chosen up front; supersedes the "wipe button in step 4" draft).

## 1. Goal

Once source (DB 1) and target (DB 2) tables are set, the user picks how to sync:

- **Comparar (default, existing workflow)**: SUID mapping -> sync parameters -> discrepancies -> patches.
- **Reemplazo completo (new)**: no comparison. The target table is emptied and reloaded with every
  row of the source, so it holds exactly the same data.

## 2. Approach (decided)

1. New wizard step "Modo de sincronización" right after DB 2 connects. Mode is page state.
   The steps array is built per mode:
   - compare: DB 1, DB 2, Modo, SUID mapping, sync params, results (unchanged behaviour).
   - replace: DB 1, DB 2, Modo, "Mapeo de columnas" (see AC-8), "Reemplazo completo" (final step).
2. Replace step runs a client-orchestrated workflow, in this order (order matters for safety):
   1. User sees the destructive confirmation, types `schema.table`, enters the target password.
   2. Fetch ALL source rows (all columns, via existing `DatabaseStreamReader`; empty
      `fieldsToCompare` selects all columns) with progress. Nothing is touched in the target yet.
   3. Build INSERT statements (reuse `SqlScriptBuilder`; geometry via its PostGIS expression using
      the target column types/SRID) for the columns present in BOTH tables (by name).
   4. Script = `DELETE FROM "schema"."table";` as the FIRST statement + all INSERTs, executed
      with the existing `executeSqlInChunks` (500 per request, each request its own transaction).
      Because the DELETE shares chunk 1 with the first 499 INSERTs, a failure in chunk 1 rolls the
      wipe back and the target is intact.
   5. Result summary: source rows fetched, rows inserted, errors; rows count must be reported
      honestly (inserted vs source).
3. No comparison engine, no pairing: byte-identical duplicate source rows ARE inserted (the old
   "wipe in step 4" design would have dropped them).
4. Non-atomicity beyond chunk 1 is accepted and stated in the UI: if a later chunk fails the target
   is partially loaded; re-running Full Replace is idempotent (deletes again and reloads).
5. `DELETE` without `WHERE` or `CASCADE` (a future FK fails loudly instead of emptying other tables). `DELETE` is used because the target role typically has no table-wipe privilege beyond `DELETE`.

## 3. Acceptance criteria

- **AC-1** After DB 2 connects, a mode step offers two clearly described options, "Comparar" and
  "Reemplazo completo"; "Comparar" is preselected and its flow is unchanged (no regression).
- **AC-2** Choosing "Reemplazo completo" removes the SUID-mapping / sync-parameter / results steps and
  shows only the replace step; switching the mode back restores the compare steps.
- **AC-3** The replace step is visually destructive (danger theme, warning icon) and shows prominently
  source `host:port/db schema.table` and the target `host:port/db schema.table` that will be emptied,
  plus the sentence that ALL rows of the target will be deleted.
- **AC-4** The run button stays disabled until the user typed the exact target `schema.table`
  (case-sensitive; empty schema shown/used as `public`) AND entered a non-empty password.
- **AC-5** The UI states that the wipe is not atomic past the first 500-statement batch and that a
  re-run is safe.
- **AC-6** The target is not modified before all source rows are fetched and the INSERT script is built
  (a fetch/build failure leaves the target untouched and shows the error).
- **AC-7** The first statement sent is `DELETE FROM "<schema>"."<table>";` (quotes in identifiers
  doubled, empty schema -> `public`, no WHERE, no CASCADE), in the same first batch as the first INSERTs.
- **AC-8** (v2.1, replaces name-matching) Column mapping step in replace mode, between the mode step
  and the replace step. Source and target tables commonly differ in column names and schema (first real
  use: source `public.wcdma` in the hg DB -> target `coverage.technology_3g` in the dev DB).
  For every TARGET column the user picks a SOURCE column or "no mapear". Same-name columns are
  prefilled. Target columns that are NOT NULL and have no DB default must be mapped (or given a fixed
  default value, as the existing sync-parameters NOT NULL defaults do) before continuing; others may be
  left unmapped (omitted from the INSERT). Source columns not mapped are shown as ignored. INSERTs use
  the mapping (source value -> target column). Geometry: a mapped geometry column is written with the
  PostGIS expression honouring target type/SRID, as the existing patch INSERTs do. Fetch only the mapped
  source columns. The mapping step must show target column types and flag obvious type conflicts
  (informational).
- **AC-9** Progress is shown for fetch, build and execute phases; the UI stays responsive on large
  tables (no long blocking main-thread loop).
- **AC-10** Final summary shows source rows, rows inserted, error count and error messages; a mismatch
  between source rows and inserted rows is flagged as a warning, not success.
- **AC-11** The mode choice does not affect the other tools (db-shapefile-sync, db-csv-sync).
- **AC-12** (v2.2) The Full Replace run lives in a module-level store outside React components
  (survives in-app navigation). Leaving the page and coming back shows live progress of the run in
  progress, or its final result (done/failed) until the user dismisses it. The password is never kept
  in the store state.
- **AC-13** While a run is in progress, a second run cannot be started from anywhere (the store
  rejects it; the start button is disabled/hidden when the store says running), including after
  navigating away and back.
- **AC-14** Whenever the store is not idle, the db-db-sync page renders a run panel (reading ONLY from
  the store: source/target labels captured at start, live progress, final summary or error) instead
  of the wizard, so the wizard cannot be navigated while a run is active, also after navigating to
  another page in the app and back. The panel offers a "Cerrar" action only when the run is done or
  failed; it resets the store to idle and returns to the wizard. The `beforeunload` confirmation is
  registered by the store while running (not by a mounted component), so the tab-close prompt fires
  even when the db-db-sync page is not mounted. The previous component-level lock
  (`onRunningChange`, `isReplaceRunning`) is removed.
- **AC-15** The confirmation text mentions that closing the tab or losing the connection interrupts the
  run and can leave the target partially loaded (re-running is safe).
- **AC-16** (v2.3) Sequence reset. The confirmation screen has a checkbox "Reiniciar secuencias del
  destino", CHECKED by default. The sequences are those feeding TARGET columns that are NOT mapped from the
  source (their column default is `nextval('<seq>'::regclass)`, taken from the already-loaded column
  metadata: no new API). When checked, one `SELECT setval('"<schema>"."<seq>"'::regclass, 1, false);` per
  sequence (identifiers quoted/doubled, then the whole qualified name placed in a text literal with single
  quotes doubled; an unqualified name is qualified with the target schema) is
  emitted immediately after the DELETE, so the DELETE and the resets are the first statements of batch 1
  (same transaction; `setval` is not transactional). Only sequences with `mapped === false` get the start
  reset; mapped ones never do. The screen lists the sequences that will be reset and, separately, all that
  will be adjusted. A default that cannot be parsed is skipped and listed as a warning.
- **AC-16b** Sequence repair (always). Every discovered sequence (mapped or not, one entry per sequence with
  its `columns`) is repaired in its own request after the replace and before ANALYZE, in every outcome that
  touched the DB (success, failed first batch, later-batch failure or rejection); a first-call rejection
  attempts the repair, swallows its failure and rethrows the original error. Per sequence:
  `SELECT setval('<seq>'::regclass, GREATEST(COALESCE(max over columns, 0) + 1,
  COALESCE(pg_sequence_last_value('<seq>'::regclass) + 1, 1)), false);` on a single line. The role needs
  `UPDATE` on the sequence and `SELECT` on the table. The execute API returns `selectResults`. Failure appends
  `No se pudieron ajustar las secuencias: <detail>`, errorCount + 1, `sequencesAdjusted` empty.
  Limitation: `pg_sequence_last_value` is NULL for a never-used sequence, so a START above max+1 can be
  lowered to max+1 (relevant only for a shared sequence); not transactional.
- **AC-17** After a run with zero errors, `ANALYZE "<schema>"."<table>";` is sent as its own request. If it
  fails (e.g. the user is not the table owner) the run stays DONE and the summary shows a warning that
  statistics were not refreshed. It is not attempted after a failed/partial run.
- **AC-18** The final summary lists one line per adjusted sequence (`sequencesAdjusted`: next id, plus a note when it was reset to 1) and the ANALYZE outcome
  (ok / not executed / failed with message). Inserted-row accounting stays correct with the extra
  header statements (statements before the first INSERT are DELETE + N start resets, not just 1).
  Known limits (documented, review round 1): (a) a sequence that ALSO feeds another table is reset too, so
  that table's next ids can collide: the checkbox text warns about it (detecting it needs ownership info
  from a new API, deferred); (b) an unqualified default (`nextval('seq'::regclass)`) is assumed to live in
  the TARGET table's schema, a wrong guess fails loudly and rolls back batch 1; (c) `GENERATED ... AS
  IDENTITY` columns have no `column_default` and are not reset; (d) `setval` needs `UPDATE` on the
  sequence (not ownership): if it fails, batch 1 rolls back (target intact) and the user unticks the checkbox (the label says
  so).
- **AC-17 note** (PostgreSQL 11): `ANALYZE` run by a role that is neither the table owner nor a superuser
  only emits a WARNING and still returns success, and the execute route does not surface notices. The summary
  therefore says "ANALYZE enviado" and never claims the statistics were refreshed.
- **AC-19** (decision) No client-side timeout/abort is added: aborting a fetch does not cancel the server
  transaction, so a re-run could interleave with the still-running batch (duplicates). The hung-run
  limit stays documented.

## 4. Expected files

Existing, changed: `src/app/tools/db-db-sync/page.tsx` (mode state, per-mode steps),
`src/components/tools/db-sync-common/execution/SqlExecutionForm.tsx` + modal CSS (only if reusing
the destructive section; leave default behaviour identical).

New (suggested, implementer may adjust within `src/components/tools/db-sync-common/` and
`src/core/services/`, no new module): mode step builder; replace step component(s) + CSS module;
`useFullReplaceWorkflow` hook; `src/core/services/fullReplaceService.ts` (build statements + orchestrate);
`src/core/services/sqlStatements.ts` (`buildDeleteStatement`).

A previous aborted attempt left uncommitted edits on the branch (drawer wiring, a destructive modal
variant, `sqlStatements.ts`, `SqlExecutionDestructiveSection.tsx`, `SqlPatchReplaceButton.tsx`).
Revert everything tied to the drawer-based design (`SqlPatchDrawer*`, `useSqlPatchDrawerState.ts`,
`ComparisonResultsView.tsx`, `SqlPatchReplaceButton.tsx`); keep and reuse what fits (`sqlStatements.ts`,
the destructive section) or delete it if unused. Leave no dead code.

## 5. Out of scope

Shapefile / CSV tools; atomic single-transaction load; CASCADE/FK/sequence handling; DELETE fallback;
changes to `/api/db/execute`, `executeSqlInChunks`, the comparison engine/worker; value
transformations/type casting beyond what existing INSERT generation does; tests (separate test-writer run).

## 6. Tests (separate run)

`buildDeleteStatement`; `fullReplaceService` (statement order DELETE first, column intersection,
identical duplicate rows preserved, geometry expression, fetch failure -> nothing executed, inserted
vs source mismatch flagged); confirm-button gating (AC-4); mode switching steps (AC-1/2).

## 7. Risks

- Irreversible data loss: target in the confirmation must come from the same `dbConfig` object sent to
  `/api/db/execute`.
- Memory/time for very large sources (whole source held in browser, same as the compare flow today).
- Missing DELETE privilege or target NOT NULL columns absent from the source -> chunk-1 error, target intact.
