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

- **[`DbVsDbComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsDbComparisonEngine.ts)**: Fetches records from both databases and offloads multithreaded comparison to the Web Worker.
- **[`WizardOrchestrator.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/WizardOrchestrator.tsx)**: Manages step transitions and smooth scroll navigation.
