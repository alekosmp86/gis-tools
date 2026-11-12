# Ejes de calles — secciones repetidas por localidad (analysis only)

Part of the routine job "Carga de ejes de calles" (`src/modules/routine-jobs/jobs/ejes-calles`). Extends the read-only analysis
(`ROUTINE_JOBS_EJES_CALLES_SKELETON_SPEC.md`) and the map (`ROUTINE_JOBS_EJES_CALLES_MAP_SPEC.md`). Nothing is written to any table.

## Background (data, dev)

The staging table repeats a `reftramo` once per locality the section belongs to. 27,206 `reftramo` repeat; in 25,761 of them the
department is one and the localities differ (typically `TRINIDAD` and `FLORES RURAL`). Geometry, `idcalle` and name are identical
across the copies. The business rules, to be applied in the real load (not built yet), depend on where the section lies relative to
the padrones:

1. Section next to urban padrones only: the rural copy is dropped.
2. Section next to urban and rural padrones (a long section, or one at the edge of a city, same distance rule): all copies stay,
   because an access point can be defined in either place.
3. Section next to rural padrones only: the urban copies are dropped and the rural-named copy stays. If several copies are
   rural-named, only one of them stays (the first by name; the rule does not say which, and the 9 such groups of dev are
   identical in everything but the name).
4. Group with no rural-named copy, whatever the class: every copy stays (nothing identifies the rural one).
5. Section near no padron: decided by the territorial unit, the INE locality polygons (role `ejes-localidades`, columns `nomloc`
   and `geom`). If the section intersects a polygon whose name (trimmed, upper-cased) is the name of one of the copies, the copy
   with that name stays and the others go. If it intersects no polygon at all it lies in rural territory: the rural rule of point 3
   applies. If it intersects polygons but none matches a copy, no rule: every copy stays and the analysis reports it (on dev,
   about 75% of these sections match a copy, 24% lie in no polygon and under 1% match none).

The rural copy is picked by the locality name, not by hand: the 19 rural localities of dev all end in " RURAL" (`FLORES RURAL`,
`MALDONADO RURAL`, ...), and no other locality name contains RURAL. "Next to" is measured to the padron polygon, border included,
not to its centre.

Streets run between lots, so a section almost never intersects a padron: "next to" means within a distance (15 m, from the section line, which is the
street's centreline: the user first gave 7–12 m, but on wide avenues the lots start farther than that from the line, so the range was
extended to 15 m).

## Criteria

### Table role
- **ET-12** The `ejes-localidades` role requires the column `nomloc` (name of the locality) besides `cloc_iso` and `geom`; the
  tables step note and the required-columns checks follow. Existing behaviour of the role (the `cloc_iso` computation) is unchanged. Its `geom` must be exactly SRID 32721 like the padrones
  (a generic SRID 0 is refused), because the twin analysis intersects it with the staging geometry in SRID 32721. The locality
  polygons are intersected only for the twin rows that need them (class `NEITHER`).
- **ET-13** The rule that picks the localities to drop (ET-10) is a standalone SQL builder, testable on its own against a real
  Postgres (PGlite, no PostGIS needed) with rows of localities and classes: a test runs it for every class and asserts the
  dropped localities, including groups with two rural-named localities, no rural-named locality, and the `NEITHER` branches.
  The twin SQL lives in its own module (`domain/twinSql.ts`), not in `analysisSql.ts`.
- **ET-1** A new read-only table role `ejes-padrones` exists, default table `carto.padron`, required columns `type_padron` and
  `geometry`. It is in the wizard's tables step with a title and note, in the distinct-tables check, in the layout resolution with the
  SRID check on `geometry` that requires exactly 32721 (a generic SRID 0 is refused for this role, because the proximity test compares
  it with the staging geometry in SRID 32721), and never among the write roles.

### Analysis
- **ET-2** A *twin group* is the set of valid staging rows (non-empty geometry, integer `reftramo`) that share a trimmed `reftramo`,
  have exactly one non-null department and at least two distinct non-null localities. Groups with more than one department are not
  twin groups, whatever their locality count; their number is reported as one count ("sin regla").
- **ET-3** For each twin group, `urbanLength` is the length of the section within `TWIN_PADRON_DISTANCE_M` (15) metres of any padron
  whose `type_padron` is `URBANO`; `ruralLength` likewise for `RURAL`. A section is *near* a type when that length is at least
  `TWIN_NEAR_MIN_LENGTH_M` (1) metre, whatever the length of the section: a long section that only touches one padron of a type
  is still near that type, because an access point can be defined in that padron. (A proportion of the section length was tried and
  discarded: a 2.5 km section beside one 190 m padron was classed as far from every padron.) Class: `BOTH` (near both), `URBAN`
  (near urban only), `RURAL` (near rural only), `NEITHER`. Both constants live in `constants.ts`; `TWIN_NEAR_RATIO` is removed.
- **ET-4** The analysis counts the twin groups per class and returns the groups as a list, limited like the other lists
  (`DETAIL_LIST_LIMIT`), ordered `NEITHER`, `BOTH`, `RURAL`, `URBAN`, then by `reftramo`. Each row has: `ref`, `idcalle`,
  `department`, `localities` (all of the group), `class`, `length`, `urbanLength`, `ruralLength`. The same section is one row however
  many copies it has, whether or not it already exists in the final table.
- **ET-10** Each twin row has `dropLocalities`, by class (a locality is *rural-named* when its trimmed, upper-cased name ends in
  `RURAL_LOCALITY_SUFFIX`, " RURAL", in `constants.ts`):
  - `URBAN`: the rural-named localities, when the group has at least one other (non-rural-named) locality; else empty.
  - `RURAL`: the non-rural-named localities, plus every rural-named one except the first by name, when the group has at least one
    rural-named locality; else empty.
  - `BOTH`: empty.
  - `NEITHER`: let `inside` be the set of names of the locality polygons the section intersects. If `inside` is empty, the same as
    `RURAL`. If a copy's name is in `inside`, every copy whose name is not in `inside`. Otherwise empty.
  It is never all the localities of the group. The analysis counts the rows with a non-empty `dropLocalities` (`twinsDrop`) and the
  rows with none (`twinsKeep`); `twinsDrop + twinsKeep = twins`.
- **ET-5** The analysis stays read-only and its cost stays bounded: the proximity test uses the padron spatial index
  (`ST_DWithin`), not a cross join.

### Report
- **ET-6** The report has a KPI group "Tramos repetidos por localidad" with: total, near urban only, near rural only, near both,
  near none, and the cross-department count. A collapsible list shows the rows with the columns `reftramo`, `idcalle`,
  `Departamento`, `Localidades`, `Caso`, `Largo (m)`, `Cerca de urbanos (m)`, `Cerca de rurales (m)`, and a "Ver en mapa" button.
  `Caso` text: URBAN "Cerca de padrones urbanos", RURAL "Cerca de padrones rurales", BOTH "Cerca de ambos: se mantienen
  las dos", NEITHER "Lejos de padrones: sin regla".
- **ET-11** The KPI group also shows the rows where a copy would be dropped and the rows where all copies stay. The list has a
  column `Qué pasa` with, per row: when `dropLocalities` is not empty "Se quitaría: <localities, comma separated>"; for class
  `NEITHER` "Sin regla: se mantienen todas"; otherwise "Se mantienen todas". The details of a twin row show the same text. A `NEITHER` row with no drop is the only case
  reported as "Sin regla".

### Map
- **ET-7** The map request accepts a third item kind `{ zoneOf: "<reftramo>", type: "URBANO" | "RURAL" }` and the tables carry
  `ejes-padrones`. Its outline is the dissolved union of the padrones of that type within `TWIN_PADRON_DISTANCE_M` of the staging
  section, simplified like the other outlines, with role `zone`. Padron geometries are made valid before the union. No padron near:
  no feature and no error. The padrones table is resolved and checked only when the request has a zone item, so split and merge
  maps never depend on it. The 30-item limit, the
  read-only transaction, the 20 s timeout and the password scrubbing are unchanged.
- **ET-8** In the modal a twin row shows: the zone outlines first (below), then the section on top. Urban zone and rural zone have
  their own colours (distinct from the old/new section colours and from each other) and legend labels "Padrones urbanos cercanos" /
  "Padrones rurales cercanos"; the section is the new-section colour labelled `<ref> · nuevo`. A zone outline is listed (and
  selectable) in the "Tramos" list only when its length near is greater than zero.
- **ET-9** The details of a twin row show `idcalle`, department, every locality, the case text, the section length and the two near
  lengths, and the title is "Tramo repetido por localidad". Navigation moves through the rows of the twin table only.

### Map: one outline per copy
- **ET-14** The map of a twin row draws one outline per copy (staging record), not one for the whole group. A new-section item may
  carry a `locality` (`{ newRef, locality }`): the server then reads the geometry of that record (same `reftramo`, same trimmed
  `localidad`), so a copy whose geometry differed would show. Without `locality` the item keeps its present behaviour (split and merge
  maps are unchanged). The request parser accepts `locality` as a non-empty text on `newRef` items only.
- **ET-15** A copy is coloured by its decision, not by its position: one type for a copy that stays (`TRAMO_SE_QUEDA`) and one for a
  copy that would be dropped (`TRAMO_SE_QUITA`), distinct from each other (red for the dropped one), from the section colours and from
  the zone colours, with the same colour in the map, the legend and the outline list. (A colour per copy was tried and discarded: on
  dev 1,725 groups have five or more copies, 564 of them 32, and identical lines in that many colours are unreadable.) Copies are
  identical in geometry and lie on top of each other, so the dropped copies are drawn first and wider and the copies that stay are
  drawn on top and thinner: both colours always show, and the selected copy gets the usual selection halo. Legend labels are
  "Se queda" and "Se quitaría". The old per-copy types `TRAMO_COPIA_1..6` and their weight bonuses are removed.
- **ET-16** The label of a copy is `<reftramo> · <locality>` followed by ` (se queda)` or ` (se quitaría)` according to
  `dropLocalities`. Every copy appears as its own entry of the "Tramos" list, selectable, with the swatch of its decision colour
  (unique list keys); selecting it shows the `reftramo`, the locality and whether it stays or would be dropped. The zones keep their
  place below the copies. The 30-item limit applies to the whole subject (zones plus copies); the cut note is unchanged. The
  `locality` of an item is sent exactly as the report gives it: the parser removes only leading and trailing spaces, as the
  server's `btrim` does, so a locality with another kind of blank (tab, no-break space) still matches its row.

- **ET-17** The map of a twin row draws no permanent labels: the copies are identical lines, so their labels would pile on the
  geometry. Each copy is identified by the "Tramos" list (name, decision, swatch) and by the legend colour; the selection halo
  and the details panel identify the selected one. The maps of splits, merges and padrones keep their labels unchanged.

### Invalid geometries in the file (skip and report)
- **ET-18** Staging rows whose geometry is invalid (`NOT ST_IsValid`) are skipped by the whole analysis: the section classification
  (new, unchanged, changed, removed, split, merge), the new streets, the locality computation and the twin analysis never see them,
  so a degenerate line (on dev 795 rows, 615 distinct `reftramo`, all of zero length, e.g. a two-point line with identical points)
  is never classified, dropped, kept or counted as a new section. The `reftramo` still counts as present in the file: a current
  section whose only staging rows are invalid is left as it is and is NOT reported as removed (on dev 557 of the 615 invalid
  `reftramo` exist in `carto` with a valid geometry; reporting them as removed would flag 557 sections for a file error). They are reported in the file-problems part of the report: a KPI
  "Filas con geometría inválida (se omiten)" (rows) and "Tramos con geometría inválida" (distinct `reftramo`), and a collapsible list
  of up to `DETAIL_LIST_LIMIT` rows with `reftramo`, `idcalle`, locality and department. The raw file counts (`rows`, distinct refs,
  repeated groups) are unchanged. It is a warning, not a blocker. The criterion is validity, never a length threshold: short but
  valid sections are kept. The root cause (the csv-db tool writing these geometries) is a separate fix outside this job; this step
  is the safety net that stays after it.

## Out of scope
Applying anything (the real load: deleting a copy, how several copies are stored in the final table), a rule for sections near rural
padrones only or near none, cross-department groups, groups with a section that the
final table already holds being treated differently, any write.
