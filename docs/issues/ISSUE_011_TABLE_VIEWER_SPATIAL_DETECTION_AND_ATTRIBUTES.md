# Issue 011: PostGIS Table Viewer Spatial Geometry Detection & Missing Attributes Fix

> **Category**: Bug Fix & Functional Enhancement  
> **Status**: Resolved & Verified  
> **Impacted Tool**: PostGIS Table Viewer (`/tools/db-table-viewer`)  
> **Impacted Files**:
> - `src/app/api/db/records/route.ts`
> - `src/utils/spatial/GeoJsonDatasetBuilder.ts`
> - `src/utils/spatial/GeometryRawNormalizer.ts`
> - `src/utils/spatial/EwkbGeometryParser.ts`
> - `src/hooks/useDbQueries.ts`
> - `src/components/tools/db-table-viewer/DbTableViewerContainer.tsx`
> - `src/components/tools/db-table-viewer/TableMetaPanel.tsx`

---

## 1. Problem Statement

When loading a spatial table (such as `gis_tools.catastro_paisseccion`) into the **Visualizador de Tablas PostGIS** (`/tools/db-table-viewer`):

1. **Alphanumeric Attributes Rendered as `null`**:
   All non-geometry table columns (`gid`, `coddepto`, `numseccat`, `ultima_actualizacion`, `fechacarga`) displayed italicized *null* placeholders in the UI table, despite holding valid data in the PostgreSQL database (`gid: 1`, `coddepto: 'A'`, `numseccat: 18`, etc.).
2. **Failure to Recognize Spatial Geometry**:
   The metadata panel displayed `Geometría Detectada: Alfanumérico / Sin Geometría` even though the table contained active PostGIS geometry records.
3. **Hidden / Disabled Map Preview**:
   Because `hasGeometry` evaluated to `false`, the interactive Leaflet map canvas was hidden and replaced with a full-width attribute table.
4. **Memory Crash (`Invalid string length`) on Massive Layers**:
   When loading large layers (e.g. `bdj_carto.ide_direccion` with hundreds of thousands of addresses), the non-streaming `/api/db/records` endpoint attempted to serialize all rows into a single JSON response, exceeding V8's 512 MB string limit and throwing `RangeError: Invalid string length`.

---

## 2. Root Cause Analysis & Technical Details

### A. Missing Column Selection in Database Query
- **Comparison Mode vs. Viewer Mode**:
  When querying `/api/db/records` for table comparison (DB vs CSV / DB vs Shapefile), the request sends `suid_columns` and `fields_to_compare`. In Table Viewer mode, no comparison columns are passed (`suid_columns = []`, `fields_to_compare = []`).
- **SQL SELECT Starvation**:
  In `src/app/api/db/records/route.ts`:
  ```typescript
  const allSelectedCols = Array.from(new Set([...suidColsList, ...fields_to_compare]));
  // allSelectedCols evaluated to []!
  const colSelects: string[] = allSelectedCols.map((col) => `"${sanitizeIdentifier(col)}"`);
  if (geomColumnName) {
    colSelects.push(stGeoJsonExpr); // colSelects ONLY contained the geometry expression
  }
  ```
  Consequently, the resulting SQL query was:
  ```sql
  SELECT CASE WHEN "geom" ... END AS "geom" FROM "gis_tools"."catastro_paisseccion";
  ```
  All other columns (`gid`, `coddepto`, `numseccat`, etc.) were completely omitted from the SQL `SELECT` clause, returning record objects with only the `geom` property.

### B. GeoJSON String Rejection in Dataset Builder
- The `/api/db/records` route converts geometry into a GeoJSON text string via `ST_AsGeoJSON(ST_Transform(geom, 4326))`.
- In `GeoJsonDatasetBuilder.ts`, geometry values were only validated against:
  1. `/^[0-9a-fA-F]+$/` (EWKB Hex)
  2. `/^[A-Z]+\s*\(/` (WKT)
- Valid GeoJSON strings (`{"type":"MultiPolygon","coordinates":...}`) failed both regex tests, setting `geometry = null` for all records and causing `features.length === 0`.

### C. Static UTM Zone 19S Assumption in EWKB Parsing
- If raw PostGIS EWKB hex was passed (e.g. `010600002005150000...`, where `0x20000000` is the EWKB SRID flag and `0x1505 = 5381`), `EwkbGeometryParser` ignored the embedded SRID and hardcoded UTM Zone 19S (EPSG:32719) reprojection, causing spatial displacement for geometries in UTM Zone 21S (EPSG:5381 / SIRGAS 2000).

### D. Architectural Inconsistency: Non-Streaming vs. Streaming Pipeline
- The comparison tools (Tools 1, 2, 3) consume database records via the cursor streaming pipeline (`DatabaseStreamReader` and `/api/db/records/stream`), processing 1M+ rows via NDJSON chunks (`FETCH 10000`).
- The Table Viewer was still invoking the legacy monolithic endpoint (`/api/db/records`), attempting single-shot JSON stringification of $> 100,000$ spatial records and exceeding V8's `String::kMaxLength` (~512 MB).

---

## 3. Implemented Solution

1. **Unification Under Streaming Pipeline**:
   - Migrated `DbTableViewerContainer` from `useFetchDbRecords` to `DatabaseStreamReader.fetchOrStreamRecords()`, leveraging `/api/db/records/stream`.
   - Displays real-time streaming progress in the UI: `Consultando registros PostGIS (10.000 de 205.000)...`.
2. **All Columns Selection Default in Streaming Route**:
   - In `src/app/api/db/records/stream/route.ts`, if `allSelectedCols` is empty, default `targetCols` to `Object.keys(columnTypes)`, ensuring that all tabular columns are retrieved alongside the geometry.
3. **Previsualization Visual Ceiling vs. Comparison Full Stream**:
   - In comparison tools and final execution steps: `limit` is never set, streaming 100% of records.
   - For visual inspection in the Table Viewer: if the layer exceeds 25,000 rows, a safe preview limit of `25,000` is requested, preventing browser tab DOM/RAM exhaustion while maintaining 60 FPS in Leaflet.
4. **Unified Geometry Parsing via `GeometryRawNormalizer`**:
   - Refactored `GeoJsonDatasetBuilder` to delegate geometry parsing to `GeometryRawNormalizer`, supporting GeoJSON strings, GeoJSON objects, EWKB hex, and WKT.
5. **Dynamic EWKB SRID Extraction & ProjectionEngine Conversion**:
   - Updated `EwkbGeometryParser` to extract `embeddedSrid` from the EWKB header and reproject metric coordinates to WGS84 degrees via `ProjectionEngine.createConverter(\`EPSG:${embeddedSrid}\`)`.
6. **Metadata & EPSG Visualization**:
   - Extended `TableMetaPanel` with `detectedSrid` and `loadedRows`, displaying the exact geometry type and coordinate system (e.g. `MultiPolygon (EPSG:5381)`).
7. **Domain Interface Consolidation**:
   - Consolidated `DatabaseFetchResult` and `DbStreamRecordsParams` in `src/types/db.ts`, eliminating duplicate local definitions in `DatabaseStreamReader.ts` and `useDbQueries.ts` to strictly adhere to domain type separation standards.

---

## 4. Code Examples & Diff Snippets

### A. All Columns Selection in `src/app/api/db/records/route.ts`:
```typescript
const targetCols =
  allSelectedCols.length > 0 ? allSelectedCols : Object.keys(columnTypes);
const colSelects: string[] = targetCols.map((col) => `"${sanitizeIdentifier(col)}"`);
```

### B. Multi-Format Geometry Support in `GeoJsonDatasetBuilder.ts`:
```typescript
records.forEach((record, recordIndex) => {
  let geometry: Geometry | null = null;

  if (geomColName && record[geomColName] != null) {
    geometry = this.normalizer.normalizeGeometry(record[geomColName]);
  }

  if (!geometry) {
    for (const col of columns) {
      if (col === geomColName) continue;
      const val = record[col];
      if (val != null) {
        const parsed = this.normalizer.normalizeGeometry(val);
        if (parsed) {
          geometry = parsed;
          break;
        }
      }
    }
  }
  // ...
});
```

### C. Dynamic SRID Reprojection in `EwkbGeometryParser.ts`:
```typescript
let embeddedSrid: number | null = null;
if (hasSrid) {
  embeddedSrid = view.getUint32(offset, littleEndian);
  offset += 4;
}

const sridConverter =
  embeddedSrid && embeddedSrid > 0 && embeddedSrid !== 4326
    ? ProjectionEngine.createConverter(`EPSG:${embeddedSrid}`)
    : null;

const parsePoint = (): [number, number] => {
  const xCoordinate = view.getFloat64(offset, littleEndian);
  offset += 8;
  const yCoordinate = view.getFloat64(offset, littleEndian);
  offset += 8;
  if (sridConverter && EwkbGeometryParser.isUtmCoordinates(xCoordinate, yCoordinate)) {
    return sridConverter([xCoordinate, yCoordinate]);
  }
  return EwkbGeometryParser.normalizeCoordinate(xCoordinate, yCoordinate);
};
```

---

## 5. Verification & Testing

- **TypeScript Type Check**: `npx tsc --noEmit` passed with 0 errors.
- **ESLint**: `npm run lint` passed with 0 errors and 0 warnings.
- **Turbopack Build**: `npm run build` compiled all 13 routes cleanly in 2.9s.
- **Visual Table Viewer**:
  - `gid`, `coddepto`, `numseccat`, `ultima_actualizacion`, and `fechacarga` render with real database values.
  - `Geometría Detectada` correctly displays `MultiPolygon (EPSG:5381)`.
  - Leaflet map preview displays the parcel polygon geometries with full interactivity.
