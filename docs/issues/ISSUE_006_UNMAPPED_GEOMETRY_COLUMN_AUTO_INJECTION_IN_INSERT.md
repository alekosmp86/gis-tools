# Issue #006: Unmapped PostGIS Geometry Column Auto-Injection in INSERT Statements

## Problem Statement
When synchronizing tabular datasets (such as CSV or Excel files) against a PostgreSQL/PostGIS database table containing both a WKB/text geometry column (e.g. `geom_wkb`) and a native PostGIS column (e.g. `geom`), the comparison engine generated `INSERT` statements that automatically populated both `geom_wkb` and an unselected `geom` column:

```sql
INSERT INTO "gis_tools"."ide_ejesviacirculacion" 
  ("reftramo", "idcalle", "geom_wkb", "nombre", "tipo_vialidad", "fuente", "departamento", "localidad", "geom") 
VALUES 
  ('1031849', '33952', '0105000020...', 'WILSON FERREIRA ALDUNATE', 'CALLE', 'OSM', 'SORIANO', 'MERCEDES', ST_SetSRID(ST_GeomFromGeoJSON('...'), 4326));
```

The user had explicitly mapped `geom_wkb` and had **not** selected or mapped `geom`, but the engine unconditionally appended `geom` with `ST_SetSRID(...)`.

---

## Root Cause Analysis & Technical Details

1. **Unconditional Column Discovery in INSERT Generation**:
   - In [`SpatialComparisonEngine.ts`](src/workers/comparison/SpatialComparisonEngine.ts), when constructing `INSERT` statements for records present only in the file source (`ONLY_IN_SHP`), the engine inspected `dbColumnTypes` via `SqlScriptBuilder.findDbGeometryColumn(dbRecords[0], dbColumnTypes)`.
   - If the database table schema contained any column named `geom` or of type `geometry`/`USER-DEFINED`, it returned that column name.
   - The engine appended `"geom"` and `ST_SetSRID(ST_GeomFromGeoJSON(...), 4326)` into `insertCols` and `insertVals` **without checking if the user actually mapped or selected `geom`**.
2. **Coupling Comparison Evaluation with SQL Generation**:
   - Evaluating spatial differences (`mappingConfig.compareGeometry`) is a diagnostic feature to detect geometric mismatches, but SQL mutations (`INSERT` / `UPDATE`) must strictly obey the user's mapped column configuration.

---

## Implemented Solution

We established the **strict mapped column rule** for SQL statement generation in [`SpatialComparisonEngine.ts`](src/workers/comparison/SpatialComparisonEngine.ts):

```typescript
const isGeometryInsertionRequested = (geomColumnName: string): boolean => {
  if (fieldsToCompare.includes(geomColumnName)) return true;
  if (mappingConfig.attributeMap && geomColumnName in mappingConfig.attributeMap) return true;
  return false;
};
```

A column (including PostGIS spatial columns) will **only** be added to the `INSERT` or `UPDATE` statement if the user **explicitly mapped / selected that column in Step 3**.

---

## Verification & Testing

- **Compilation & Lints**: Passed with 0 errors via `npx tsc --noEmit` and `npm run lint`.
- **CSV Insert Verification**: Generated `INSERT` statements now populate strictly the columns selected in Step 3 (`reftramo`, `idcalle`, `geom_wkb`, `nombre`, `tipo_vialidad`, `fuente`, `departamento`, `localidad`) without appending unmapped `geom`.
