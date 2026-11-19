# Ejes de calles — secciones repetidas por localidad (analysis only)

Part of the routine job "Carga de ejes de calles" (`src/modules/routine-jobs/jobs/ejes-calles`). Extends the read-only analysis
(`ROUTINE_JOBS_EJES_CALLES_SKELETON_SPEC.md`) and the map (`ROUTINE_JOBS_EJES_CALLES_MAP_SPEC.md`). Nothing is written to any table.

## Background (data, dev)

The staging table repeats a `reftramo` once per locality the section belongs to. 27,206 `reftramo` repeat; in 25,761 of them the
department is one and the localities differ (typically `TRINIDAD` and `FLORES RURAL`). Geometry, `idcalle` and name are identical
across the copies. The business rules, to be applied in the real load (not built yet), depend on where the section lies relative to
the padrones:

1. Section next to urban padrones only: the rural copy is dropped.
2. Section next to urban and rural padrones (a long section, or one at the edge of a city, same distance rule): one copy stays,
   the one whose locality polygon the section overlaps most (else the non-rural-named one, else the first by name). See ET-10.
3. Section next to rural padrones only: the urban copies are dropped and the rural-named copy stays. If several copies are
   rural-named, only one of them stays (the first by name; the rule does not say which, and the 9 such groups of dev are
   identical in everything but the name).
4. Group with no rural-named copy, whatever the class: every copy stays (nothing identifies the rural one), unless the locality
   polygons decide between the copies that remain (ET-10, single copy).
5. Section near no padron: decided by the territorial unit, the INE locality polygons (role `ejes-localidades`, columns `nomloc`
   and `geom`). If the section intersects a polygon whose name (trimmed, upper-cased) is the name of one of the copies, the copy
   with that name stays and the others go. If it intersects no polygon at all it lies in rural territory: the rural rule of point 3
   applies. If it intersects polygons but none matches a copy, no rule: every copy stays and the analysis reports it (on dev,
   about 75% of these sections match a copy, 24% lie in no polygon and under 1% match none).

The rural copy is picked by the locality name, not by hand: the 19 rural localities of dev all end in " RURAL" (`FLORES RURAL`,
`MALDONADO RURAL`, ...), and no other locality name contains RURAL. "Next to" is measured to the padron polygon, border included,
not to its centre.

Streets run between lots, so a section almost never intersects a padron: "next to" means within a distance (25 m, from the section line, which is the
street's centreline: the user first gave 7–12 m, but on wide avenues the lots start farther than that from the line, so the range was
extended to 15 m and then to 25 m after a verified case at 20 m; on dev, of a 1/16 sample, sections near no padron are 233 at 15 m,
131 at 20 m, 70 at 25 m and 42 at 30 m).

## Criteria

### Table role
- **ET-12** The `ejes-localidades` role requires the column `nomloc` (name of the locality) besides `cloc_iso` and `geom`; the
  tables step note and the required-columns checks follow. Existing behaviour of the role (the `cloc_iso` computation) is unchanged. Its `geom` must be exactly SRID 32721 like the padrones
  (a generic SRID 0 is refused), because the twin analysis intersects it with the staging geometry in SRID 32721. The locality
  polygons are intersected for every twin row (ET-5).
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
  have exactly one non-null department (after ET-2a) and at least two distinct non-null localities. A `reftramo` with more than one
  department is not a twin group unless ET-2a chooses one of its departments. One that still has several departments is not a twin
  group, whatever its locality count, and is counted once as "sin regla" (`twinsCrossDepartment`).
- **ET-2a** Department by geometry (after ET-2; the copies of the other departments are dropped before the locality rules). For a `reftramo` whose valid copies span more than one department (count of distinct non-null `departamento` above 1), the chosen department is the one whose polygons overlap the section most: the sum of `ST_Length(ST_Intersection(section, ST_MakeValid(polygon)))` per department name, the name taken as `upper(btrim(name_dpto))`, name ASC on a tie. A polygon counts when `ST_Intersects` says so (a touch at a point counts with length 0, as for the locality polygons). The polygons are role `ejes-departamentos` (default `carto.mv_country_province`, columns `name_dpto` and `geometry`; the geometry must be exactly SRID 32721, like the localities). The copies of the other departments are dropped BEFORE the locality rules: the chosen department's copies then form the `reftramo`'s group as an ordinary one-department group (ET-2), take the ET-10 rules and the single-copy step, and feed the geometric rule. Staging `departamento` matches a polygon name with `upper(btrim())` on both sides and no accent folding, as the department code join of EJ-11; a text that differs in accents matches no polygon and stays undecided (fail closed). A copy with no department is kept. When no department polygon intersects the section, nothing is dropped and the `reftramo` stays undecided (`twinsCrossDepartment`). The choice is the `twin_dept` relation (one row per multi-department `reftramo`, `department` NULL when undecided), read by `copy_kept`, `twin_groups` and the load. Not verified on dev: the polygon names are assumed to equal the staging names (no database access when this was written).
- **ET-3** For each twin group, `urbanLength` is the length of the section within `TWIN_PADRON_DISTANCE_M` (25) metres of any padron
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
  - `BOTH`: let `inside` be the names of the locality polygons the section intersects, ordered by overlap length descending (the
    total length of the section inside each name's polygons). The one copy that stays (the winner) is the first by: the copy whose
    name is first in `inside` (longest overlap; copies not in `inside` last), then non-rural-named, then name ASC. Every other copy
    is dropped (exactly one kept). The overlap length is measured on `ST_MakeValid` of the locality polygon, so an invalid INE polygon cannot abort the analysis.
  - `NEITHER`: let `inside` be the set of names of the locality polygons the section intersects. If `inside` is empty, the same as
    `RURAL`. If a copy's name is in `inside`, every copy whose name is not in `inside`. Otherwise empty.
  - Single copy (every class, after the bullets above): let `remaining` be the localities not dropped so far, and `inside` as in
    `BOTH`. If `remaining` has two or more copies and one of them is in `inside`, or the rural fallback below applies, the winner is
    the first of `remaining` by: the copy whose name is first in `inside`, then non-rural-named, then name ASC (the rural winner of the
    fallback replaces this order when it applies). Every other remaining copy is dropped too, so exactly one copy stays. Otherwise
    nothing more is dropped and the copies stay held. `BOTH` keeps one copy already, so this step changes nothing for it.
  - **Rural fallback** (`BOTH` and the single-copy step, every class): `inside_cover` is the overlap of the longest polygon (the first of
    `inside`) over the section length, 0 when no polygon intersects. Below `TWIN_POLYGON_MIN_COVER_RATIO` (0.5) the section lies mostly
    outside the localities, so it is rural: when a copy that remains is rural-named, the winner is the rural-named copy named
    `<department> RURAL` (the group's department, upper-cased and trimmed), else the rural-named copy with the lowest name. With no
    rural-named copy the polygon winner applies as above. At 0.5 or more the polygon winner applies. In the single-copy step the fallback
    also lets the step fire when no polygon intersects the section (cover 0) and a rural-named copy remains. `URBAN` drops its
    rural-named copies first, so the fallback reaches it only in a group with no non-rural-named copy; `RURAL` keeps its first
    rural-named copy already.
  It is never all the localities of the group. (`BOTH` rule: `carto` and `mv_road_section` hold one section per `reftramo`; the
  legacy load kept the urban-named locality in 19,327 of 19,327 comparable cases; the polygon match was chosen by the user on
  2026-11-18, localities rarely change.) The analysis counts the rows with a non-empty `dropLocalities` (`twinsDrop`) and the
  rows with none (`twinsKeep`); `twinsDrop + twinsKeep = twins`. Dev counts quoted in this spec (Background, ET-20 measurement) predate
  the single-copy step and must be re-measured.
- **ET-5** The analysis stays read-only and its cost stays bounded: the proximity test uses the padron spatial index
  (`ST_DWithin`), not a cross join. The locality polygons are intersected for every twin row (`ST_Intersects` on the locality
  spatial index), so their cost grows with the twin rows of every class, not only `NEITHER` and `BOTH`.

### Report
- **ET-6** The report has a KPI group "Tramos repetidos por localidad" with: total, near urban only, near rural only, near both,
  near none, and the cross-department count. A collapsible list shows the rows with the columns `reftramo`, `idcalle`,
  `Departamento`, `Localidades`, `Caso`, `Largo (m)`, `Cerca de urbanos (m)`, `Cerca de rurales (m)`, and a "Ver en mapa" button.
  `Caso` text: URBAN "Cerca de padrones urbanos", RURAL "Cerca de padrones rurales", BOTH "Cerca de ambos: se mantiene una", NEITHER "Lejos de padrones: sin regla".
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
- **ET-18** Staging rows whose geometry is invalid (`NOT ST_IsValid`) or collapsed (`ST_Length` < `GEOMETRY_TOLERANCE_M`, 0.001) are skipped by the whole analysis: the section classification
  (new, unchanged, changed, removed, split, merge), the new streets, the locality computation and the twin analysis never see them,
  so a degenerate line (on dev 795 invalid rows plus 878 valid-but-collapsed rows, 676 distinct `reftramo` among the collapsed, e.g. reftramo 1001006 with two points ~1e-9 m apart)
  is never classified, dropped, kept or counted as a new section. A `reftramo` whose staging rows are all discarded does not count as present (`stg_keys` reads only the kept rows): a current
  section with no kept row is a removal candidate like any section absent from the file, unless it holds access points (never removed); on dev 557 of the 615 invalid
  `reftramo` exist in `carto` with a valid geometry, so under this rule they are removal candidates: confirm before a real run). They are reported in the file-problems part of the report: a KPI
  "Filas con geometría inválida o colapsada, o menor de 1 m sin puntos de acceso (se omiten)" (rows) and "Tramos con geometría inválida o colapsada, o menores de 1 m sin puntos de acceso" (distinct `reftramo`), and a collapsible list
  of up to `DETAIL_LIST_LIMIT` rows with `reftramo`, `idcalle`, locality and department. The raw file counts (`rows`, distinct refs,
  repeated groups) are unchanged. It is a warning, not a blocker. The criterion is validity or length: under the 1 mm geometry tolerance (`GEOMETRY_TOLERANCE_M`) always; under `MIN_SECTION_LENGTH_M` (1 m) unless the `reftramo` holds access points (one shared definition `validGeometrySql`). Discarded rows feed no other rule (classification, twins, new streets, removals, `stg_keys`); only the staging fingerprint reads them. Real
  sections of 1 mm or more are kept as before. The root cause (the csv-db tool writing these geometries) is a separate fix outside this job; this step
  is the safety net that stays after it.

### Labels of the "far from padrones" case
- **ET-19** For class NEITHER the "Caso" and "Qué pasa" texts say which rule decided. The kept copies are the ET-10 result
  (the single-copy step included); this text does not change them. Overlap is measured on the made-valid polygon (ET-10), so an invalid INE polygon cannot abort the analysis.
  Each twin row carries `insideLocalities` (the upper-cased names of the polygons the section intersects, ordered by overlap length
  descending, the first is the longest; filled for every class, empty when the section intersects no polygon).
  (a) Two or more copies match a polygon and copies are dropped (the single-copy step): case "Cruza varias localidades", what happens
  "Cruza varias localidades: se queda <winner> (mayor largo dentro); se quitaría: <dropped>". `<winner>` is the first of
  `insideLocalities` that is among the group's localities (the longest overlap), and it is the kept copy.
  (b) Copies dropped and exactly one copy matches a polygon (`insideLocalities` not empty): case "Lejos de padrones: por polígono de localidad",
  what happens "Dentro de <insideLocalities>: se quita <dropped>" ("se quitan" for several).
  (c) No polygon found and a copy dropped: the rural rule, case "Lejos de padrones: regla rural", what happens "Se quitaría: <dropped>".
  No copy dropped: "Sin regla: se mantienen todas" (class NEITHER) or "Se mantienen todas". "Lejos de padrones: sin regla" remains the case
  text for class NEITHER when no rule applies; "Cruza varias localidades" is not used for a row that keeps every copy.

## Gemelas por geometría (complemento)

This section COMPLEMENTS ET-1 to ET-18 and changes none of them: the locality rules, their class counts (`twinsDrop`, `twinsKeep`), their report, their map and their tests keep their meaning. Order: the locality rule runs first and decides the copies each `reftramo` keeps (`copy_kept`); the geometric rule runs afterwards, across DIFFERENT `reftramo`s, and reads only those kept copies. Both can affect one section: a geometric loser may be a `reftramo` whose other copies the locality rule already dropped; the SQL reads `copy_kept`, so analysis and load agree.

- **ET-20** A geometric twin group is a set of two or more distinct `reftramo`s, each with EXACTLY ONE kept copy (after ET-10) whose `localidad` and `departamento` are not null and whose `idcalle` is not null, and whose kept copies have the same geometry: the same comparable line as the GEOM comparison of EJ-9 (merged, normalised, snapped to the 4-decimal grid of `GEOMETRY_EQUALITY_DECIMALS`), grouped by its md5. A group is the set of members that share the four parts: the snapped geometry, `idcalle`, locality and department (locality and department trimmed, upper-case). Members that differ in idcalle, locality or department are not grouped with each other: a geometry shared by sections of two streets gives two groups (or one group and a section that is no member), never one mixed group. A `reftramo` with several kept copies (no polygon decides between them, ET-10) is never a member: a conservative limit, reported as "Con varias copias tras la regla de localidades: no agrupados" (`geoTwinSkippedRefs`: such a `reftramo` with a kept copy that has the same four parts, key, idcalle, localidad and departamento, as a copy of another `reftramo`).
- **ET-21** Keepers: the members that hold a point reference, by `access_point.id_road_section` equal to the `reftramo` or to the `road_section.id` of a current section with that `reftramo`. Keepers are never removed; several keepers may remain.
- **ET-22** Winner: when a group (the four parts of ET-20) has no keeper, the single winner is the member already in `carto.road_section` with the lowest `reftramo`, else the member with the lowest `reftramo`. Every other member of that group is a loser. Keepers and winners are decided per group, never across groups. A loser holds no reference by construction.
- **ET-23** A loser NOT in carto is never inserted or updated, and is listed as "No se carga" (`geoTwinLosersOmitted`). It stays present in the staging keys: it is not a plain removal, split, merge or renumber, and it is excluded from NEW, ATTR and GEOM classification, renumber candidates, split pieces, merge members, locality copies and the load (`copy_final`). A split's pieces therefore never include a loser, so a point is never offered a section that will not exist.
  Renumber interplay (no code change, documented): an old section X (in carto, not in staging) whose new `reftramo` N is a geometric-twin member is decided by N's role. N a keeper or the winner: N is a `new_sections` member, so the usual renumber rule applies (X's points move to N when the renumber is not held). N a loser: N is excluded from `new_sections`, so X has no renumber candidate; X falls to a plain removal (held, with its points, when it holds any), or to a split or merge if the other rules match. When N's winner is already in carto, the result is X and the winner side by side in carto, unflagged by this rule; the rule documents it, it does not decide it.

- **ET-24** A loser IN carto is offered as a removal, "Se quita al aceptar" (`geoTwinLosersRemovable`), and is removed only when the user accepts that row (`accepted.twinRemovals`, one entry per accepted row; "Aceptar todos" in the list sends only the listed removable rows, never a server-side flag). It goes through the plain removal path with source kind `twin`: the same guards (no access point holds its `reftramo` or its `road_section.id`; shared master rules of EJ-21; abort on a failed guard) and the same revert. Skip reasons: `not_accepted`, `has_points`, `repeated_old_ref`. The row of a removable loser reads "Se quita al aceptar; si no, queda como está": when not accepted, its section in carto stays exactly as it is, even when its geometry or idcalle differ from staging.
- **ET-25** The accepted removal is re-validated inside the load transaction against the in-transaction geometric twin table: an accepted `reftramo` that is not a removable loser there is a stale analysis (ANALYSIS_CHANGED).
- **ET-26** The report shows the rows of every member with the columns "Tramo" (reftramo, idcalle, locality), "Grupo" (the other members, collapsed), "Qué pasa" ("Se mantiene", "Se quita al aceptar", "No se carga") and the access point count. Only removable losers have "Aceptar"/"Rechazar"; the counter is "N aceptados de M" over the removable losers. The summary strip and the KPI group "Gemelos por geometría" count the groups, members, removable and omitted losers and the skipped references. The geometric rule has no map in this slice.
- **ET-27** The load result shows "Gemelos quitados" (`twinsRemoved`), and the skipped list shows the twin rows with their reason (kind "twin"). The summary the user accepted carries `geoTwinLosersRemovable` and `geoTwinLosersOmitted`, so a change in them between the analysis and the load is ANALYSIS_CHANGED.
- **Dev measurement (ET-20, user data, dev)**: with the one-kept-copy rule and the four-part key: about 95 groups, 234 members, 66 pairs (the earlier 188 groups, 449 sections, 134 pairs used a key without locality and department and are superseded); 3 groups have a member that holds points; 27,112 reftramos had several kept copies and were never grouped (measured before the BOTH keep-one rule; BOTH refs are now single-copy and can be grouped, re-measure). These are measurements of dev, not rules: the load reads the environment it runs on.
- **Known limit (ET-20)**: a `reftramo` with several kept copies is never grouped, even when its geometry matches a single-copy group. Its count is reported; no rule decides it in this slice.

## Elección manual de la copia

- **ET-28** For a `reftramo` with several copies, the user picks the one copy that stays: `accepted.twinPicks`, one entry per `reftramo`, `{ ref, department, locality }` (text trimmed, never empty; `ref` canonical integer). A `reftramo` named twice is refused, never merged; the list is refused above `ACCEPTED_KEYS_LIMIT`. The Analizar re-run takes the same field (`accepted` with `twinPicks` only), so the analysis and the load see the same picks.
- **ET-29** A pick overrides the locality rule (ET-1 to ET-18) for its `reftramo`: the picked copy is kept even when the rule would drop it, and every other copy of that `reftramo` is dropped. A `reftramo` without a pick keeps the rules as they are. The picked copy is one of `copy_kept`, so the geometric rule (ET-20 to ET-27) reads it like any single copy: it is a member of a group and can still be a loser there. A pick that names no copy of the staging has no effect: the rules apply as if there were no pick, while the load still aborts on it (ET-31).
- **ET-30** A pick names a copy by `reftramo`, `departamento` and `localidad` as the staging holds them (trimmed, as `copy_raw` defines them). A copy with an empty locality or department has no text to name it, so it cannot be picked.
- **ET-31** Fail closed: the load aborts before any write when a pick names no copy of the staging, with a Spanish message naming up to `INVALID_TWIN_PICK_REFS_LIMIT` `reftramo`s. The stale-analysis guard compares `twinPicksApplied` (the picks that name a copy) between the analysis the user saw and the load, so picks changed since the analysis give ANALYSIS_CHANGED.
- **ET-32** The analysis reports `twinUndecided`: one row per `reftramo` that keeps more than one copy after the rules and the picks, with `ref`, `idcalle`, `name`, `copies` (`{ department, locality }` each), `points` (access points by `reftramo`) and `waiting`. `twinsUndecided` counts the rows. A picked `reftramo` has one copy and is never listed; `twinPicksApplied` counts the picks.
- **ET-33** `waiting` counts the renumber pairs and the split pieces held as `not_single_copy` whose new `reftramo` is this one (the same rules as the holds themselves). Merges and removals are not counted: their hold depends on acceptance. A `reftramo` that keeps one copy after a pick releases its renumber and split holds through the existing rules.
- **Known limit (ET-33)**: the classification (NEW, ATTR, GEOM counts) still reads one staging row per `reftramo`, as before. For a picked `reftramo` the counts may compare another copy's geometry, while the load writes the picked copy; the summary guard holds because both sides read the same classification.
## Out of scope
Applying anything (the real load: deleting a copy, how several copies are stored in the final table), a rule for sections near rural
padrones only or near none, cross-department groups still undecided after ET-2a, groups with a section that the
final table already holds being treated differently, any write.
