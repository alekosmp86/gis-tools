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
