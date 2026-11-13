# Comparar (CSV and Shapefile): skip degenerate geometries of the file

Tool: `db-csv-sync` and `db-shapefile-sync`, mode *Comparar* (the shared comparison engine in `src/core/workers/comparison`).
Documentation: `docs/tools/DB_CSV_SYNC_TOOL.md`, `docs/tools/DB_SHAPEFILE_SYNC_TOOL.md`.

## Background

The ejes staging table `bdj_carto.ide_ejesviacirculacion` is filled with Comparar from the IDEuy CSV. On dev 795 rows (615 distinct
`reftramo`) have a collapsed line: the EWKB holds a 2-point `MultiLineString` whose points are 3.5e-10 m apart
(`0105000020D17F00000100000001020000000200000098B1A2A8E9202441 7CD33198C3685741 9BB1A2A8E9202441 7CD33198C3685741`). PostGIS
calls it invalid and its length is zero. The file has them; the tool inserts them as they come. The routine job already skips and
reports them (`ROUTINE_JOBS_EJES_CALLES_TWINS_SPEC.md`, ET-18); this fixes it at the load, as the root cause. The tool must not write
degenerate geometries; geometries that are invalid but repairable (a self-intersecting polygon) are NOT touched here.

## Criteria

- **DG-1** A pure function `isDegenerateGeometry(geometry)` (in `src/core/...`, next to the comparison code, no DOM) tells whether a
  GeoJSON geometry of a file feature has collapsed to a point:
  - `LineString`: every vertex is within `DEGENERATE_RELATIVE_EXTENT` of the first one, i.e. the extent in x and in y is at most
    `DEGENERATE_RELATIVE_EXTENT * max(1, largest absolute coordinate of the part)`. `DEGENERATE_RELATIVE_EXTENT = 1e-12` (the dev case,
    3.5e-10 over a coordinate of 6.6e5, is degenerate; a 1 mm line is not).
  - `MultiLineString`: degenerate only when every part is.
  - `Polygon`: the outer ring has no area extent (all vertices within the same tolerance, or an extent of at most the tolerance in x
    or in y); `MultiPolygon`: only when every part is.
  - `Point`, `MultiPoint`, `GeometryCollection`, null and empty geometries are never degenerate (null and empty keep their present
    handling).
- **DG-2** In Comparar, a file row whose geometry is degenerate is excluded from the comparison: it is never paired, never becomes
  an INSERT or an UPDATE (nor a DB-side mismatch), and it is counted in a new summary count `degenerateFileRowsSkipped`. The reconcile
  rule of the tool documentation becomes: file rows = match + attribute + geometry + onlyInShp + duplicate (file side) + skipped +
  degenerate skipped. A DB row whose only file counterpart is degenerate is reported as `ONLY_IN_DB` (it has no valid counterpart);
  nothing else changes for it.
- **DG-3** The summary bar shows the count when it is above zero ("Filas del archivo con geometría degenerada (N omitidas)"), and the
  result carries up to 20 examples (file row number and the key values) so the user can find them; the warning text says that the
  geometry collapsed to a point and the rows were not loaded.
- **DG-4** Both file sources share the rule (CSV and Shapefile go through the same engine); the Shapefile docs and the CSV docs name
  it. Files without degenerate rows behave exactly as before, with the same counts.
- **DG-5** The server-side *Reemplazo completo* modes (`runShpReplace`) are not changed by this spec: their geometry processing and
  checks stay as they are (a follow-up if the same problem appears there).

## Out of scope
Repairing geometries (`ST_MakeValid`), the *Reemplazo completo* modes, the routine job (already skips and reports), asking IDEuy to
correct the source file.
