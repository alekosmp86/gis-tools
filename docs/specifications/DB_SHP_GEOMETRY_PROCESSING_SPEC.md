# DB vs. Shapefile: Geometry processing for the replace mode (spec v1.0)

> Extends `DB_SHP_REPLACE_TARGET_SPEC.md`. Status: implemented (G1 SQL builders + options validation, G2 engine in the
> replace transaction + API, G3 reusable wizard step + analysis flow), except G4 (real PostGIS check on dev), which is pending.

## 1. Requirements (all optional, independent toggles)

1. **Reparar geometrías**: repair invalid geometries before inserting.
2. **Unificar por clave**: records sharing the same value(s) in the chosen key fields become ONE record whose
   geometry is a single MultiPolygon (the parts collected, not dissolved).
3. **Validar solapes**: detect overlapping geometries between different records.

## 2. Decisions taken with the user

- The tool is GENERIC: it works for any shapefile and hardcodes no field names, layer types or presets. The user
  chooses the grouping key as a multi-select of the file's DBF fields (any number, mapped or not). The key is
  only a SUGGESTION source, never an assumption. Suggestions, in order: (1) the key last used for the same target
  table (remembered per connection/schema/table in the browser); (2) the columns of the target table's primary
  or unique key (read from the catalog) that map to a DBF field. With no suggestion nothing is pre-selected and
  unification cannot run until the user picks at least one field.
- The case we are looking at (padron layers: Rural = department + padron, Urbano = department + locality +
  padron, one file per type) is covered by choosing those fields once; the remembered key and the target
  table's unique key make it a one-click path afterwards. A Rural padron and an Urbano padron never merge because
  each file is one type and the key includes the discriminating fields the user selected.
- Generic safety net instead of hardcoded warnings: the analysis shows, for the chosen key, how many unified groups it
  produces (`groups`: only groups with more than one record) and the largest groups (only groups with more than one
  record), and a note when the key has a single field (a single field is more likely to merge unrelated records).
  When the key merges nothing (`rowsMerged` is 0), an INFO states that the key groups no records and nothing will be
  unified, and asks to review the key fields. The attribute-conflict flag (below) catches the rest.
- Unification uses `ST_Collect` into a MultiPolygon (no dissolve). Repair, when enabled, then fixes any broken result.
  Unify requires a Multi or unconstrained geometry target (`geometry` with no type, any case): when the target
  geometry column is a single type (e.g. POLYGON) the run is refused before any processing statement with a
  Spanish error naming MultiPolígono.
- Incompatible geometries: with processing active and a single-type target column (e.g. POLYGON, not Multi and not
  unconstrained), any `MULTI*` geometry cannot be stored. The analysis shows an ERROR notice ("N geometrías MultiPolígono
  no caben en la columna destino de tipo Polígono"), "Reemplazar ahora" is disabled and a real run is refused before the
  table lock. Known limitation: the wording names Polígono for every single-type target.
- Rows whose key is NULL in any key field are NOT unified: each one stays a singleton group (grouped on its record
  number), so a NULL key never merges unrelated records and is never reported as a group or as an attribute
  conflict. They are counted in `nullKeyRows` and reported as a warning ("N registros con clave vacía no se
  unificaron").
- The unique key suggestion reads the key columns only (`indnkeyatts`, falling back to `indnatts` on PostgreSQL
  versions without it): INCLUDE columns are never part of the key.
- Attributes of a unified record are taken from the FIRST record of the group (file order). The user confirmed
  that records of a group (e.g. `PADRON = 0`) carry the same values in the other fields, so there are no
  per-column rules. If a group ever has DIFFERENT values in another mapped column, it is FLAGGED and REPORTED
  (never silent): the report gives the total `attributeConflicts` and, for the first 20 groups, the key values,
  the conflicting columns and their distinct values (up to 5 each, with the kept first value marked). The flag
  shows in the analysis report and again in the result of a real run (warning style, not an error); the unified
  record still keeps the first row's value. `PADRON = 0` groups ARE unified like any other value.
- Overlap = interior intersection of two different records with area above a threshold (default 1 m2, editable).
  Touching borders are not overlaps. Projected CRS: planar area; geographic CRS: geography area.
  Checked after unification and repair, on the final geometries.
- Policy for overlaps: `Bloquear` (default; the run fails and rolls back with the report) or `Solo informar`.
- Invalid geometries with repair OFF: the data is never repaired implicitly, not even for the overlap check. The
  analysis reports the count and asks "¿Reparar?" (`Activar reparación` / `Continuar sin reparar`). If the user
  skips, the geometries are inserted exactly as they are and the user is WARNED: the warning stays visible in the
  step, in the analysis report and in the result ("N geometrías inválidas se insertaron sin reparar"). Because
  GEOS cannot reliably intersect invalid geometries (it may raise TopologyException), invalid geometries are left
  OUT of the overlap check, and the report says how many were skipped ("N geometrías inválidas no se
  comprobaron para solapes; active Reparar para incluirlas"). When repair is ON, the repaired geometries are
  the ones checked and inserted.
- The invalid count excludes NULL geometries (they are counted separately as `nulls`): a missing geometry is not an
  invalid one and does not trigger the repair prompt on its own.
- The "¿Reparar?" prompt is offered after an analysis whenever repair is off and invalid geometries were found in the
  source OR were created by unify (`insertedInvalid`), not only in the source (`invalidBefore`).
- Applies to the shapefile replace only for now, but the step is a reusable component with a plain options model.

## 3. Options model (core type `GeometryProcessingOptions`)

```
{ repair: { enabled }, unify: { enabled, keyFields: string[] },
  overlaps: { enabled, policy: "block" | "report", minAreaM2: number } }
```
Validated server side (key fields must exist in the DBF, at least one when unify is enabled, `minAreaM2` finite and >= 0).

## 4. Engine (inside the replace transaction, before the table lock)

1. Build a temp table with a real `geometry` column from the staged GeoJSON (source SRID); GiST index when the overlap check is on.
2. Count invalid geometries on the base table (`invalidBefore`, `ST_IsValid`, NULL geometries excluded and counted as `nulls`).
3. Repair the base table (if on): `ST_CollectionExtract(ST_MakeValid(geom), 3)` on invalid geometries (polygonal parts only). With repair on, every empty geometry, whether it came from the file or was produced by the repair, becomes NULL and is counted (`emptyAfterRepair`); with repair off, empty geometries are inserted as they are. Repairing first means unify only collects valid parts.
4. Unify (if on): one row per key group (`rec` = min rec, attributes of the first row, key fields staged even when unmapped); rows with a NULL key stay singletons; count groups, merged rows, attribute conflicts and rows with a NULL key (`nullKeyRows`). `groups` counts only groups with more than one record and `rowsMerged` is the sum of (size - 1) over them; `largestGroups` lists only groups with more than one record. Group stats, largest groups and conflicts use the same grouping, so NULL-key rows never form a group or a conflict. Unify is `ST_Collect` (no dissolve), so the assembly of touching or overlapping valid parts can itself be invalid.
5. Repair the unified table (only when repair and unify are both on): the same repair pass as step 3 on the unified geometries. This is why there are two passes: the base pass guarantees that unify only collects valid parts, and the second pass fixes the assemblies that unify may have produced. `repaired` is the sum of both passes' updates and `emptyAfterRepair` the sum of both passes' NULLs. Repair off: no repair statement runs anywhere.
6. Incompatible count (only when the target geometry column is a single type such as POLYGON; not Multi, not unconstrained GEOMETRY): `incompatibleGeometryRows` counts the `MULTI*` geometries of the work table, NULLs excluded, because that column cannot hold them. Then the final invalid count on the work table (`insertedInvalid`: the unified table when unify is on, the base table otherwise).
7. Overlaps (if on): over the final geometries, excluding invalid ones (counted as `overlapSkippedInvalid`): self-join `a.rec < b.rec AND a.geom && b.geom AND ST_Intersects` then intersection area > threshold; count + first 20 pairs (their keys). No implicit `ST_MakeValid` is ever applied when repair is off.
8. Policy `block` with overlaps > 0 fails the run (rollback). A real run also fails before the table lock when `incompatibleGeometryRows` > 0 (Spanish error with the notice wording; rollback; table untouched). `dryRun` always rolls back after returning the report.
9. The final INSERT reads the processed table. For a Multi target the INSERT wraps the geometry in `ST_Multi`; the repair pass itself does not, so a repaired single polygon stays a polygon until that INSERT. The result gains `geometry: { invalidBefore, repaired, emptyAfterRepair, groups, rowsMerged, attributeConflicts, attributeConflictSamples, nullKeyRows, overlapCount, overlapSamples, overlapSkippedInvalid, insertedInvalid, incompatibleGeometryRows, wouldBlock }`; `stagedRows`/`insertedRows` count the processed rows, `sourceRows` the file rows.

## 5. API and client

- `start` accepts `geometryProcessing` and `dryRun`. A dry run never touches the table and keeps the uploaded file. The upload is deleted only when a real run ends DONE; a FAILED or blocked real run keeps it, and kept uploads are swept after 2 h. The client store keeps the `uploadId` of the loaded file so the real run after an analysis does not upload again.
- New job phase `processing`; the status snapshot carries the report; a dry-run job ends `done` with `kind: "analysis"`.

## 6. Wizard UI

New optional step between column mapping and replace ("Procesamiento de geometrías", with an "Omitir" path): three
cards (Reparar, Unificar por clave with a key multi-select (+ suggested key chips), Validar solapes with policy + threshold) and a
report panel. The replace step gains "Analizar sin reemplazar". The step is a reusable component
(`src/components/tools/db-sync-common/geometry-processing/`) driven by the options model above.

## 7. Acceptance criteria

- AC-G1 Each of the three processes can be enabled independently; with all off, behaviour is identical to today.
- AC-G2 No field name or layer type is hardcoded. The key is chosen by the user from the DBF fields; suggestions come only from the remembered key for the table and the target's primary/unique key; the analysis shows the count of unified groups (more than one record) and the largest of them; when the key merges nothing, an INFO asks the user to review the key fields.
- AC-G3 Unification yields one row per key group with a MultiPolygon, attributes of the first row, and counts of groups, merged rows and attribute conflicts. Every group with differing values in another mapped column is flagged: total count plus samples (key, columns, distinct values) in both the analysis and the real-run result; nothing is blocked by this.
- AC-G4 Repair yields valid polygonal geometries; empty results are NULL and counted. Rows with a NULL key are never unified and are counted (`nullKeyRows`, warning). Unify on a single-type target (not Multi, not unconstrained GEOMETRY) is refused before any write.
- AC-G5 Overlap check ignores touching borders and areas under the threshold; the report lists count and 20 sample pairs; `block` fails the run with no table change.
- AC-G6 `dryRun` never modifies the target table and returns the same report a real run would.
- AC-G7 With repair off the invalid-geometry prompt appears after an analysis; skipping inserts as is, shows a persistent warning (step, report, result), and the invalid geometries are excluded from the overlap check with their count reported. Nothing is repaired without the user asking.
- AC-G8 The password is never stored or logged; all SQL identifiers/values are quoted or bound; options are validated server side.
- AC-G9 Docs updated (`DB_SHAPEFILE_SYNC_TOOL.md`).

## 8. Risks / to measure in G4

- PostGIS SQL is untested on a real database until G4; the 1M-row overlap self-join and `ST_MakeValid` over PaisUrbano may take minutes (measure on PaisRural first).
- Temp tables for 1M polygons use temp disk of the database server.
- Geography area for geographic CRS is slower than planar.
