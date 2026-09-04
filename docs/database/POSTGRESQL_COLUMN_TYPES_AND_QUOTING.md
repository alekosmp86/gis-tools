# PostgreSQL Column Introspection & Value Quoting

> **Topic**: Column data type introspection and SQL string escaping.  
> **Status**: Implemented & Production Active

---

## 1. Overview

When generating `UPDATE` and `INSERT` SQL patch statements for PostgreSQL/PostGIS databases, data types must be properly quoted:
- Numeric types (`integer`, `bigint`, `double precision`, `numeric`) MUST NOT be single-quoted.
- Text types (`character varying`, `text`, `char`, `uuid`, `date`, `timestamp`) MUST be enclosed in single quotes `'value'`.
- `NULL` values MUST be written as unquoted `NULL` keywords.

---

## 2. Introspection via `information_schema.columns`

The API route [`/api/db/columns`](src/app/api/db/columns/route.ts) inspects database schema metadata directly:

```sql
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default 
FROM information_schema.columns 
WHERE table_schema = $1 AND table_name = $2
ORDER BY ordinal_position;
```

This returns an array of `DbColumnMetadata` objects sent to the Web Worker for precise SQL formatting:

```typescript
export interface DbColumnMetadata {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
}
```

---

## 3. SQL Quoting Rules in Comparison Engine

Inside [`comparisonWorker.ts`](src/workers/comparisonWorker.ts), values are formatted based on their introspected column type:

1. **Numeric Column Types**:
   If `data_type` matches `/int|integer|numeric|decimal|float|double|real/i`, values are output without quotes:
   ```sql
   UPDATE "public"."parcels" SET "area" = 1250.5 WHERE "id" = 'P-101';
   ```

2. **Text / String Column Types**:
   Values are trimmed, single quotes inside strings are escaped (`'don''t'`), and output inside single quotes:
   ```sql
   UPDATE "public"."parcels" SET "owner" = 'Juan Perez' WHERE "id" = 'P-101';
   ```

3. **Null Values**:
   If the value is `null`, `undefined`, or empty string for numeric fields, `NULL` is output:
   ```sql
   UPDATE "public"."parcels" SET "notes" = NULL WHERE "id" = 'P-101';
   ```
