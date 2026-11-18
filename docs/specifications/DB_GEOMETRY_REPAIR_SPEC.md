# Geometry repair option (slice 1: db-db Full Replace)

> **Status**: Spec v2 (fix round 1). **Scope of this slice**: `db-db-sync` Full Replace only. The SQL builder and the runner live in `core` so the shapefile and CSV replace flows and the compare tools can reuse them in later slices.

## 1. Problem

CGEO polygons (e.g. `coverage.service_area`) contain invalid rings (a junk sliver as the shell, the real polygons as "holes outside the shell"). `ST_MakeValid` splits them into several parts, and some parts are microscopic slivers. Converting to EPSG:4326 at 4 decimals collapses those parts to fewer than 4 points ("Too few points in geometry component") and the whole record converts to NULL downstream.

## 2. Repair rule (validated by hand on the CGEO dump: 407 rows kept, 0 invalid, 0 collapsing parts)

For each polygonal geometry of the target table, after the load:

1. Candidate rows: `geom IS NOT NULL`, `ST_SRID(geom) > 0`, the SRID has a row in `spatial_ref_sys` (otherwise the whole column would abort), and `GeometryType(geom)` is `POLYGON` or `MULTIPOLYGON`.
2. `ST_MakeValid`, keep polygons only (`ST_CollectionExtract(..., 3)`), split into parts (`ST_Dump`).
3. Keep a part only if, after `ST_Transform(part, 4326)` and `ST_SnapToGrid(..., 10^-D)` (`D` = decimals, default 4), it has `ST_NPoints >= 4` **and** `ST_Area > 0`. Zero-area slivers are dropped too.
4. Rebuild `ST_Multi(ST_Collect(parts))`, same SRID.
5. A row is **changed** (updated) only if its new geometry is valid (`ST_IsValid`) and it was invalid or its number of parts changed.
6. A row is **unrepairable** when it is a candidate but (a) no part survives step 3 (all parts dropped, or nothing polygonal left), or (b) its new geometry is not valid. Unrepairable rows keep their original geometry and are reported, never set to NULL.

Only `geom` changes. No other column is touched.

Known limit (not handled in this slice): holes collapsed inside a kept part are not removed; the part is kept as-is.

## 3. Acceptance criteria

- **AC-1** `src/core/services/geometryRepairSql.ts` exports pure builders for a given `schema`, `table`, geometry column and decimals. Each statement is a **single line** (the SQL executor splits scripts on newlines). Identifiers are quoted with `quoteIdentifier`. `decimals` is validated as an integer 0..8 (default 4, constant exported) both by `normalizeGeometryRepairDecimals` and inside the builders. Row identity is `(tableoid, ctid)` so partitioned and inherited tables are handled; `ctid` is used without a text cast.
- **AC-2** Two statements per column:
  - a **count** statement that returns ONE text value `changed,unrepairable` (for example `5,3`), built with `concat_ws`. `changed` counts rows the UPDATE would write; `unrepairable` counts candidate rows absent from the repaired set plus repaired rows whose new geometry is not valid. The count is taken over the filtered table (the candidate WHERE), not over the intermediate parts.
  - an **UPDATE** implementing section 2. It writes only rows where `ST_IsValid(r.ng)` and (invalid, or the number of parts changes).
- **AC-3** `isRepairableGeometryColumnType(type)` reads the type string (same format as `targetMeta.columnTypes`, e.g. `geometry(MultiPolygon,32721)`). Accepted: an optional schema prefix (`public.geometry(...)`, `"public".geometry`), then `geometry` with an optional `(subtype[,srid])`. Repairable subtypes: generic `geometry`, `MultiPolygon`, `MultiPolygonZ`. Not repairable: single `Polygon`, `MultiPolygonM`, `MultiPolygonZM`, points, lines, geography, arrays (`geometry[]`) and names that only start with `geometry` (`geometryfoo`).
- **AC-4** `runFullReplace` gets `repairGeometries?: boolean` (default `true` when absent) and `repairDecimals?: number` (default 4). The repair runs when the replace finished with 0 replace errors and the target was modified: on every repairable geometry column, each statement in its own request, **before** ANALYZE. Repair never rolls back the replace. The runner (`src/core/services/geometryRepairRunner.ts`) owns the orchestration so shapefile/CSV flows can reuse it.
- **AC-5** `FullReplaceResult` gets:
  - `replaceErrorCount`: errors from the replace script only (excludes sequence-repair and geometry-repair lines). The summary headline ("Reemplazo completado" / "Reemplazo incompleto") is based on this value, so a failed geometry or sequence repair does not turn the load into a partial load.
  - `errorCount`: the total, as before.
  - `geometryRepair`: `{ status: "off" | "ok" | "failed" | "skipped"; columns: { column; repairedRows; unrepairableRows }[]; skippedColumns: string[]; message? }`. `skippedColumns` lists non-repairable polygonal columns (M, ZM, single Polygon) and is reported in every status.
  - A repair failure appends one error line `Reparación de geometrías: columna X: …`, adds 1 to `errorCount`, and never changes `insertedRows`. The repair stops at the first failing column.
  - If the replace had errors, or the target was not modified, the repair is `skipped`. `off` when disabled.
- **AC-6** UI in the shared Full Replace step:
  - Checkbox "Reparar geometrías", checked by default.
  - When checked: number input labelled "Decimales de control en EPSG:4326" (default 4, integer 0..8). An invalid value shows an inline error "Ingrese un número entero entre 0 y 8." and disables the run button.
  - Help text when checked: "Corrige polígonos inválidos y quita las partes que quedarían con menos de 4 vértices al redondearlas a esta cantidad de decimales de grado en EPSG:4326. Las coordenadas guardadas no se redondean. Si todas las partes de una fila desaparecen, la fila conserva su geometría."
  - Help text when unchecked: "Las geometrías se cargan tal como vienen del origen." (the decimals input and its help are hidden).
  - The result summary shows, per column, the repaired row count, a WARNING "N filas no se pudieron reparar y conservan su geometría original" when `unrepairableRows > 0`, and an INFO "Columna X omitida (tipo no soportado)" per skipped column. "Sin reparación de geometrías" when off.
- **AC-7** Tests (out of scope for the implementer; test-writer): builder output (single line, quoting, decimals normalization, tolerance literal, count parsing), type helper (schema prefix, Z, M/ZM, anchors), `runFullReplace` wiring with a mocked executor (order replace → repair count + update → ANALYZE; off; skipped on errors; failure keeps inserted rows and does not change `replaceErrorCount`).
- **AC-8** Spec reference in `docs/tools/DB_DB_SYNC_TOOL.md` (section 5.7) and the Full Replace wiki page (`src/wiki/db-db-sync/reemplazo-completo.md`).

## 4. Out of scope (later slices)

- Exact geometry copy (EWKB instead of the GeoJSON round trip through EPSG:4326).
- The repair option in shapefile/CSV replace and in the compare tools (the runner is ready for them).
- A backup table of the old geometries.
- Holes collapsed inside kept parts.
- Repairing M/ZM polygon columns.
