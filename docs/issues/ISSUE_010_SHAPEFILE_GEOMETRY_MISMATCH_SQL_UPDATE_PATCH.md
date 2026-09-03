# ISSUE 010: Shapefile Geometry Synchronization & High-Fidelity Vertex Preservation

## 1. Problem Statement
When comparing an active PostGIS database table against an ESRI Shapefile, two related issues emerged:
1. **Missing UPDATE Queries for Geometry Mismatches**: When geometric differences occurred between the database and the Shapefile, no SQL UPDATE statements were generated. Since Shapefile geometries are stored in the `.shp` binary stream rather than DBF attribute columns, they were excluded by the rule that only mapped columns in Step 3 generate updates.
2. **Vertex Loss & Coordinate Truncation in Database Updates**: When SQL UPDATE scripts were generated and executed, dense cadastral survey polygons lost vertices (e.g. 8,244 vertices in the `.shp` file collapsed to 8,233 vertices in PostgreSQL; and an 11,968-vertex polygon collapsed to 11,955 vertices). Re-comparing against the Shapefile showed persistent geometric discrepancies despite executing the update scripts.
3. **UI Preview Freezing**: Generating and rendering preview queries for large polygon geometries with thousands of coordinates froze the browser UI thread.

---

## 2. Root Cause Analysis & Technical Details
1. **Destructive 6-Decimal Degree Truncation (`roundGisCoordinate`)**:
   `serializeCompactGeoJson()` in `SqlScriptBuilder.ts` forcibly rounded all coordinates to 6 decimal places (`~11 cm`). In surveyor-grade polygons where vertices are centimeters apart, adjacent vertices rounded to identical numbers, causing PostGIS to collapse and eliminate the zero-length segments.
2. **Double-Reprojection Distortion**:
   Shapefile native coordinates (e.g. metric UTM Zone 21S / EPSG:32721) were being converted to WGS84 degrees via JavaScript `proj4`, truncated, and then converted *back* to the database SRID in PostgreSQL via `ST_Transform(..., targetSrid)`.
3. **Stale Database Column Precedence**:
   In `SpatialComparisonEngine.ts`, `rawDbGeom` checked `dbRec.geom_wkb` before `dbRec.geom`. PostGIS updates modified `geom`, but the comparison engine was re-evaluating the stale un-updated `geom_wkb` column.
4. **Cyclic Ring Rotation Boundary Flip**:
   `normalizeRing()` picked a starting vertex (`minIdx`) based on rounded minimum coordinates. Sub-millimeter floating-point shifts caused the database polygon to rotate from vertex 0 while the Shapefile polygon rotated from vertex 10, failing identical geometries.
5. **CSS `white-space: pre-wrap` Layout Cost**:
   The code preview box used `white-space: pre-wrap; word-break: break-all;`, forcing the browser layout engine to perform character-by-character line breaking across hundreds of thousands of coordinate characters.

---

## 3. Implemented Solution

1. **Zero-Copy On-Demand Streaming**:
   - Added lightweight `fileRecordIndex?: number` to `DiscrepancyItem` (8 bytes per item).
   - During SQL generation in the worker, `shpReader.readGeometry(item.fileRecordIndex, null)` reads the unprojected native coordinates directly from the binary buffer, avoiding heap duplication and `postMessage` bloat.
2. **Native SRID Introspection & Direct Injection**:
   - `ProjectionEngine.extractEpsg(prjText)` extracts native EPSG codes directly from `.prj` files.
   - When `sourceSrid === targetSrid` (both in EPSG:32721 or EPSG:4326), SQL statements inject native coordinates directly:
     `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON('...'), targetSrid))`
     Zero reprojection, zero precision loss, 100% vertex preservation.
3. **Shapefile Geometry Update Exception**:
   - In `SqlPatchGenerator.ts`, when `item.type === DiscrepancyType.GEOMETRY_MISMATCH && this.isBinaryDbf`, automatically generates spatial PostGIS `UPDATE` queries.
4. **Cyclic Shift Ring Matching & Consecutive Duplicate Point Collapsing**:
   - `SpatialGeometryComparator.ts` evaluates cyclic shifts and reverse winding with numerical epsilon tolerance (`0.0003°` / ~30m).
   - `normalizeRing()` collapses consecutive duplicate points caused by coordinate quantization.
6. **Unified Discrepancy Table Row Rendering**:
   - In `DiscrepanciesTable.tsx`, items with both geometric and attribute discrepancies render their geometry divergence row alongside all attribute differences under a shared SUID with `rowSpan`.
   - Updated filtering so records with both difference types appear under both *Diferencia Geométrica* and *Discrepancia de Atributos* cards.
7. **Decoupled Dual Updates in `SqlPatchGenerator.ts`**:
   - Decoupled attribute updates and geometry updates so that records possessing both geometric and tabular attribute divergence generate SQL updates for both `geom` and attributes (such as `areamc` or `areaha`).
8. **Lazy SQL Generation Architecture & Zero-Allocation Preview Mode**:
   - During initial comparison, `PatchCollector` runs in preview-only mode (`collectFullScript = false`), recording exact counts and collecting only the 25 preview statements without allocating tens of thousands of SQL strings in heap or executing `.join("\n")`.
   - Full SQL scripts are lazily generated on demand in a Web Worker via `ComparisonWorkerMessageType.GENERATE_SQL` when the user chooses to Copy, Download, or Execute.

---

## 4. Code Examples & Diff Snippets

### Direct Native Injection in `SqlScriptBuilder.ts`:
```typescript
public buildPostgisGeomExpr(geometry: unknown, targetColumnName?: string, sourceSrid?: number): string {
  const compactJsonString = this.serializeCompactGeoJson(geometry);
  const originSrid = sourceSrid || (this.targetSrid !== 4326 ? this.targetSrid : 4326);

  let baseExpr: string;
  if (originSrid === this.targetSrid) {
    baseExpr = `ST_SetSRID(ST_GeomFromGeoJSON('${compactJsonString}'), ${this.targetSrid})`;
  } else {
    baseExpr = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${compactJsonString}'), ${originSrid}), ${this.targetSrid})`;
  }

  const targetType = targetColumnName && this.dbColumnTypes ? this.dbColumnTypes[targetColumnName]?.toLowerCase() : undefined;
  if (targetType?.includes("multi") && (geometry as { type?: string })?.type === "Polygon") {
    return `ST_Multi(${baseExpr})`;
  }
  return baseExpr;
}
```

### On-Demand Streaming in `SqlPatchGenerator.ts`:
```typescript
if (item.type === DiscrepancyType.GEOMETRY_MISMATCH && this.isBinaryDbf && item.dbRecord) {
  const whereClause = this.buildWhereClause(item.dbRecord);
  const geomCol = this.resolveGeometryColumn();
  if (whereClause && geomCol) {
    const rawGeom = item.fileRecordIndex != null && this.shpReader
      ? this.shpReader.readGeometry(item.fileRecordIndex, null)
      : item.shpGeometry;

    if (rawGeom) {
      const geomExpr = this.sqlBuilder.buildPostgisGeomExpr(rawGeom, geomCol, this.fileSrid);
      const updateSql = this.sqlBuilder.buildUpdateStatementRaw(geomCol, geomExpr, whereClause);
      // Push statement...
    }
  }
}
```

---

## 5. Verification & Testing
- **TypeScript Type Check**: `npx tsc --noEmit` passed with 0 errors.
- **ESLint Cleanliness**: `npm run lint` passed with 0 errors and 0 warnings.
- **Turbopack Build**: `npm run build` compiled all 13 routes cleanly in 2.3s.
