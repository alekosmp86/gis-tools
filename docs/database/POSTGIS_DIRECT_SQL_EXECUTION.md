# Direct PostGIS SQL Batch Execution & Authentication

> **Topic**: Execution of generated SQL patch scripts directly against PostgreSQL/PostGIS.  
> **Status**: Implemented & Production Active

---

## 1. Overview & Goal

The final step of the database synchronization wizard ([`SqlPatchDrawer.tsx`](src/components/tools/db-sync-common/SqlPatchDrawer.tsx)) allows users to view, copy, download, and execute generated `.sql` patch files (`UPDATE` and `INSERT`).

Users can execute these SQL patches directly into the PostgreSQL/PostGIS database from within the application interface without opening external SQL clients (e.g., pgAdmin or DBeaver).

---

## 2. Key Components & Architecture

- **[`src/app/api/db/execute/route.ts`](src/app/api/db/execute/route.ts)** — API Route handling transactional PostgreSQL batch execution.
- **[`src/services/dbExecutionService.ts`](src/services/dbExecutionService.ts)** — Chunked execution service batching statements (500 statements per batch) with progress reporting.
- **[`src/components/tools/db-sync-common/SqlExecutionModal.tsx`](src/components/tools/db-sync-common/SqlExecutionModal.tsx)** — UI password confirmation, execution progress bar, and summary modal.
- **[`src/hooks/useSqlBatchExecution.ts`](src/hooks/useSqlBatchExecution.ts)** — Encapsulated batch execution state and progress tracker hook.

---

## 3. Transaction Safety & Security

### Transaction Safety (`BEGIN; ... COMMIT; / ROLLBACK;`)
When executing large patch scripts containing hundreds or thousands of `UPDATE` or `INSERT` statements, partial script failure can leave the database in an inconsistent state.

- **Solution**: The backend wraps all statements within a single PostgreSQL client session inside an explicit `BEGIN; ... COMMIT;` block.
- **Automatic Rollback**: If any query throws an exception, an automatic `ROLLBACK;` is executed, guaranteeing 0 partial modifications.

```typescript
// Transaction handling in src/app/api/db/execute/route.ts
await client.query("BEGIN;");
try {
  const result = await client.query(sqlScript);
  if (Array.isArray(result)) {
    totalAffectedRows = result.reduce((sum, res) => sum + (res.rowCount || 0), 0);
  } else if (result && typeof result.rowCount === "number") {
    totalAffectedRows = result.rowCount;
  }
  await client.query("COMMIT;");
} catch (dbErr) {
  await client.query("ROLLBACK;").catch(() => {});
  throw dbErr;
}
```

### Password Security Strategy
- Connection configuration saved in `localStorage` explicitly omits the database password.
- At execution time, `SqlExecutionModal` prompts the user for their PostgreSQL password.
- Passwords are transmitted securely over HTTP POST directly to the execution endpoint and are never stored on disk or client state.
