# DB vs DB Sync (Replicas) Tool

> **Location**: `src/app/tools/db-db-sync/`  
> **Route**: `/tools/db-db-sync`  
> **Status**: Implemented & Production Active

---

## 1. Overview

The **DB vs DB Sync Tool** enables direct database-to-database correlation and discrepancy auditing between two PostgreSQL/PostGIS databases (Primary DB 1 vs Replica DB 2).

Unlike file-based tools, this tool directly queries both live database connections over API endpoints, eliminating the need to export intermediate Shapefiles or CSV files.

---

## 2. 4-Step Wizard Workflow

1. **Step 1: Source Database (DB 1)**
   - Enter connection credentials for Primary DB 1 (Host, Port, Database, User, Password, Schema, Table).
   - Introspects available columns and row counts.

2. **Step 2: Target Database (DB 2)**
   - Enter connection credentials for Target/Replica DB 2.
   - Reuses `<DbConnectionForm key="db2-form" />` with total state isolation.

3. **Step 3: Composite SUID Mapping & Attribute Selection**
   - Select single or multi-column composite SUID keys.
   - Map 1-to-1 attribute columns and configure `NOT NULL` default values.

4. **Step 4: Audit & Discrepancies Results**
   - View KPI summary cards, filterable discrepancy table, interactive map preview, and PostGIS `UPDATE` and `INSERT` SQL patch scripts.
   - Execute patches directly on Target DB 2 via the transactional SQL execution modal (`BEGIN; ... COMMIT;`).

---

## 3. Key Components & Engines

- **[`DbVsDbComparisonEngine.ts`](src/services/engines/DbVsDbComparisonEngine.ts)**: Fetches records from both databases and offloads multithreaded comparison to the Web Worker.
- **[`WizardOrchestrator.tsx`](src/components/shared/WizardOrchestrator.tsx)**: Manages step transitions and smooth scroll navigation.

## 4. Non-Unique Keys (Key Group Pairing)

- A SUID that appears more than once on either side (DB or file) forms a *collision group*. Keys with one row per side are compared exactly as before.
- Inside a group, byte-identical rows (same SUID, compared fields and rounded geometry) collapse into one representative per side: extra DB twins are reported as `DUPLICATE_SUID`, extra file twins are only counted in `duplicateFileRowsSkipped`.
- Remaining rows are paired 1:1: first by identical content, then greedily by geometry distance (ties broken by attribute differences and row order). A single leftover row on each side is paired by elimination. Paired rows are compared like any other row, so `ATTRIBUTE_MISMATCH` / `GEOMETRY_MISMATCH` stay visible; the item carries `pairing` (method, counts, distance).
- Leftover rows with no counterpart become `ONLY_IN_DB` / `ONLY_IN_SHP` (the latter become INSERTs). `DUPLICATE_SUID` now means: repeated identical DB rows, or rows that cannot be paired (geometry missing on a side, or the group exceeds the 40,000-candidate cap, counted in `pairingCappedGroups`).
- UPDATE guard: a paired row inside a group never generates an UPDATE unless a primary key column with a value identifies it (a composite-SUID `WHERE` would update the whole group). Skipped rows are counted in `unkeyedUpdatesSkippedCount` and a warning is shown.
- Attribute-only exact pass: after the full-content pass, leftover representatives are also paired 1:1 by attributes alone (SUID + compared fields, lowest row first) when at least one side has no usable geometry in the leftovers (e.g. CSV, or DB-to-DB without a geometry column). Otherwise geometry pairing decides.
- The 40,000-candidate cap applies to the geometry-row product (DB geometry rows x file geometry rows) after the exact pass, not to the raw group size.
- Unkeyed paired rows never produce an UPDATE (counted in `unkeyedUpdatesSkippedCount`). INSERTs generated from collision groups may repeat an existing key; a unique constraint would reject them.
- Counts reconcile: DB rows = match + attribute + geometry + onlyInDb + duplicate (DB side); file rows = match + attribute + geometry + onlyInShp + duplicate (file side) + skipped.

## 5. Sync Mode and Full Replace (wipe + reload)

> Spec: [`DB_DB_REPLACE_TARGET_SPEC.md`](../specifications/DB_DB_REPLACE_TARGET_SPEC.md) (AC-1..AC-15).

After the target database (DB 2) connects, a **"Modo de sincronización"** step (step 3) asks how to sync:

| Mode | Steps after the mode step |
|---|---|
| **Comparar** (default, the workflow above) | 4 SUID mapping, 5 Parameters, 6 Results |
| **Reemplazo completo** | 4 Column mapping, 5 Full Replace |

The other tools (`db-shapefile-sync`, `db-csv-sync`) are unchanged: `useWizardMappingState(stepOffset)` defaults to `0` and only db-db-sync passes `1`.

### 5.1 Column mapping (Full Replace)

Source and target tables usually differ in column names and schema. For every **target** column pick a **source** column or "no mapear"; same-name columns are prefilled. Target columns that are `NOT NULL` without a database default must be mapped or given a fixed value (raw SQL expression supported) before continuing. Source columns left unmapped are listed as ignored. Obvious type conflicts (for example text into integer) are flagged, not converted.

### 5.2 Run order and safety

1. The user types the exact target `schema.table` (an empty schema is treated as `public`) and the target password. The screen is red and shows both endpoints.
2. **All source rows are fetched first** (only the mapped columns, as Postgres text, see 5.3). A failed or incomplete read, an empty source, or no mapped source column aborts with the target untouched.
3. INSERT statements are built in the browser (batched, yielding to the UI).
4. Execution: `TRUNCATE TABLE "schema"."table";` (no `CASCADE`) is the **first statement of batch 1**, together with the first 499 INSERTs, in one transaction: if batch 1 fails, the TRUNCATE rolls back and the target is intact. Batch 1 is sent alone; later batches (500 statements each, one request and one transaction per batch) run only if it succeeded.
5. A failure after batch 1 leaves the target partially loaded. The error text says so. **Re-running Full Replace is safe** (it truncates and reloads again).

Closing or reloading the tab, or losing the connection, interrupts the run at a batch boundary (no batch is ever half-applied) and can leave the target partially loaded; the confirmation text says so.

### 5.3 Value fidelity

Full Replace does not reuse the comparison value cleaner. The source stream is requested with `raw_text_values: true`: the data queries (single-shot and cursor `FETCH`) run with a per-query pg type parser that returns raw Postgres text for every type, so timestamps, numerics, booleans, json, arrays and bytea keep their exact value and no JavaScript `Date` timezone shift happens. The row-count and SRID queries are unaffected, and the compare flow is unchanged when the flag is absent.

`formatReplaceLiteral` always quotes values (Postgres casts the literal to the column type), doubles `'`, keeps empty strings, and uses the `E'...'` form for backslashes and line breaks so every statement stays on a single line (the executor splits scripts on newlines). Exceptions: `NULL` stays `NULL`; an empty string mapped to a numeric, temporal, boolean or geometry target becomes `NULL`; geometry goes through `SqlScriptBuilder.buildPostgisGeomExpr` with the target column type and SRID (source GeoJSON is always EPSG:4326). Byte-identical duplicate source rows are copied (no pairing happens).

### 5.4 The run survives navigation

The run lives in a module-level store (`src/core/services/fullReplaceRunStore.ts`, bound with `useFullReplaceRun`), not in React state:

- Leaving the page does not stop the run. Coming back shows `FullReplaceRunPanel` (live progress, then the summary or error) instead of the wizard, until the user presses **Cerrar** (only offered when the run is done or failed).
- A second run cannot start while one is running, from anywhere.
- The `beforeunload` confirmation is registered by the store while running, so closing the tab warns even when the page is not mounted.
- The password is passed into the run and never stored in the store state.
- A run token ignores late progress callbacks from a finished run.

### 5.5 Known limits

- No cancel and no timeout: a request that never answers keeps the panel in "running" until the tab is reloaded.
- Only a server-side job could survive closing the browser; not implemented.
- `uuid`, `json(b)` and `bytea` targets are treated as text for the empty-string rule (an empty string there still fails its batch).
- The records query still ships an unmapped geometry column.
- Batch error labels ("Lote N (a-b)") count statements, and statement 1 is the TRUNCATE (plus one statement per reset sequence).
- No client-side timeout or abort (aborting a request does not cancel the server transaction, so a re-run could interleave with it).

### 5.6 Sequence reset and ANALYZE

- **Sequence reset** (checkbox "Reiniciar secuencias del destino", on by default). Sequences behind target columns that are NOT mapped from the source (default `nextval('<seq>'::regclass)`, read from the column metadata already loaded) get `ALTER SEQUENCE "schema"."seq" RESTART WITH 1;` right after the TRUNCATE, inside batch 1, so a failed first batch rolls everything back. (`TRUNCATE ... RESTART IDENTITY` is not enough: the sequences are normally not owned by the columns.) Limits: a sequence shared with another table is reset too and that table's next ids can collide; an unqualified default is assumed to live in the target schema; `GENERATED ... AS IDENTITY` columns are not reset; the role must own the sequence (otherwise untick the checkbox).
- **ANALYZE.** After a run with zero errors, `ANALYZE "schema"."table";` is sent as its own request so the planner has fresh statistics (autovacuum may be off, and TRUNCATE zeroes them). A failure only produces a warning. On PostgreSQL 11 a non-owner gets a silent warning and a success, so the summary says "ANALYZE enviado", not "statistics updated".
- Batch error labels ("Lote N (a-b)") count statements, and statement 1 is the TRUNCATE.

## 6. Record Selection

The discrepancies table has one checkbox per record (not per field row). Only the selected records feed the SQL generator, the previews, the counters and the Copy, Download and Execute actions.

- Selectable: `ATTRIBUTE_MISMATCH`, `GEOMETRY_MISMATCH` and `ONLY_IN_SHP`. No checkbox: `ONLY_IN_DB`, `DUPLICATE_SUID`, `NULL_SUID`, `MATCH`.
- Paired records without a primary key (`isUnkeyedPairedItem`): the checkbox is disabled ("Sin clave primaria: no se puede actualizar de forma segura").
- By default every selectable, enabled record is selected (constant `DEFAULT_SELECT_ALL = true` in `src/core/selection/selectionDefaults.ts`); the user can use "Limpiar selección". With nothing selected the worker is not invoked and the actions are disabled.
- The selection persists across pagination, filters and tabs; it resets when the comparison changes and is pruned after the re-analysis that follows an execution.
- After a script is executed, its "executed" state resets when the selection changes. If the selection changes while the full script is being generated, the result is discarded and "La selección cambió durante la generación del script. Vuelva a intentarlo." is shown.
- Selection bar: "Seleccionar página", "Seleccionar todos (filtro actual)", "Deseleccionar página", "Limpiar selección".
- The KPI cards and the skipped-updates warning keep the engine's full values.
