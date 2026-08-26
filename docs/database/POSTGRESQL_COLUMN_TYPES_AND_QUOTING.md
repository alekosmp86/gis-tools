# PostgreSQL Column Types Introspection & SQL Value Quoting

> **Topic**: Resolving data type mismatches between CSV string inputs and PostgreSQL database columns.  
> **Date**: 2026-08-26  
> **Status**: Implemented & Merged to `master`

---

## 1. Bug Description & Diagnosis

### The Symptom
When executing generated `UPDATE` scripts against PostgreSQL tables containing `character varying(50)` columns (e.g. `reftramo`), PostgreSQL failed with the following error:

```sql
UPDATE "public"."tramos" SET "reftramo" = 706112 WHERE "id" = '101';
-- ERROR: operator does not exist: character varying = integer
```

### Root Cause
1. All values parsed from CSV input files are parsed as JavaScript `string` primitives (e.g. `"706112"`).
2. The `toSqlValue()` function inside `comparisonCore.ts` previously checked `typeof val === "number"` or parsed numeric strings to determine if quotes were needed.
3. Because string numbers like `"706112"` contain valid digits, the comparison engine emitted them as bare unquoted integers `706112`.
4. PostgreSQL strict type coercion rejects bare unquoted integers for string/varchar columns.

---

## 2. Files Modified

- **[`src/app/api/db/records/route.ts`](file:///c:/Alekos/Projects/gis-tools/src/app/api/db/records/route.ts)** — Fetches column data types from `information_schema.columns`.
- **[`src/workers/comparisonCore.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparisonCore.ts)** — Data-type-aware `toSqlValue()` and `toSqlWhereCondition()`.
- **[`src/types/workerMessages.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/workerMessages.ts)** — Added `dbColumnTypes?: Record<string, string>` payload definition.
- **[`src/services/engines/DbVsFileComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsFileComparisonEngine.ts)** — Passes `dbColumnTypes` to Web Worker payload.

---

## 3. Technical Solution

### Step 1: Database Schema Introspection (`information_schema.columns`)
In `/api/db/records`, a secondary query extracts exact column data types from the target table:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = $1 AND table_name = $2;
```

This returns a dictionary map:
```json
{
  "id": "integer",
  "reftramo": "character varying",
  "nombre_calle": "text"
}
```

### Step 2: Data-Type-Aware Quoting (`comparisonCore.ts`)

Added helper function `isNumericColumnType(dataType)`:
```typescript
function isNumericColumnType(dataType?: string): boolean {
  if (!dataType) return false;
  const dt = dataType.toLowerCase();
  return (
    dt.includes("int") ||
    dt.includes("num") ||
    dt.includes("decimal") ||
    dt.includes("float") ||
    dt.includes("double") ||
    dt.includes("real") ||
    dt.includes("serial")
  );
}
```

Updated `toSqlValue(val, colName, dbColumnTypes)` logic:
- **Known Numeric Columns**: Bare numeric literal (e.g. `57144`).
- **Known String/Character Columns**: Single-quoted string literal (e.g. `'706112'`).
- **Unknown Column Types (Fallback)**: Single-quoted string literal for all string values.

---

## 4. Key Rules & PostgreSQL Type Coercion Insights

1. **Quoted String for Numeric Column**: PostgreSQL accepts `'57144'` for integer columns via implicit string-to-integer coercion.
2. **Bare Integer for String Column**: PostgreSQL **rejects** `706112` for `character varying` columns.
3. **Takeaway**: When column data types are ambiguous or unknown, single-quoting values as strings is always the safer, non-breaking choice in PostgreSQL.
