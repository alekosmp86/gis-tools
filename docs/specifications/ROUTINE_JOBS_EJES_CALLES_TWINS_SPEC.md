# Ejes de calles — secciones repetidas por localidad (analysis only)

Part of the routine job "Carga de ejes de calles" (`src/modules/routine-jobs/jobs/ejes-calles`). Extends the read-only analysis
(`ROUTINE_JOBS_EJES_CALLES_SKELETON_SPEC.md`) and the map (`ROUTINE_JOBS_EJES_CALLES_MAP_SPEC.md`). Nothing is written to any table.

## Background (data, dev)

The staging table repeats a `reftramo` once per locality the section belongs to. 27,206 `reftramo` repeat; in 25,761 of them the
department is one and the localities differ (typically `TRINIDAD` and `FLORES RURAL`). Geometry, `idcalle` and name are identical
across the copies. The business rules, to be applied in the real load (not built yet), depend on where the section lies relative to
the padrones:

1. Section next to urban padrones only: the rural copy is dropped.
2. Section next to urban and rural padrones (a long section, or one at the edge of a city): both copies stay, because an access point
   can be defined in either place.
3. Section near no padron: decided by a person looking at a map.

Streets run between lots, so a section almost never intersects a padron: "next to" means within a distance (15 m, from the section line, which is the
street's centreline: the user first gave 7–12 m, but on wide avenues the lots start farther than that from the line, so the range was
extended to 15 m).

## Criteria

### Table role
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
  `TWIN_NEAR_RATIO` (0.1) of its length. Class: `BOTH` (near both), `URBAN` (near urban only), `RURAL` (near rural only), `NEITHER`.
  Both constants live in `constants.ts`.
- **ET-4** The analysis counts the twin groups per class and returns the groups as a list, limited like the other lists
  (`DETAIL_LIST_LIMIT`), ordered `NEITHER`, `BOTH`, `RURAL`, `URBAN`, then by `reftramo`. Each row has: `ref`, `idcalle`,
  `department`, `localities` (all of the group), `class`, `length`, `urbanLength`, `ruralLength`. The same section is one row however
  many copies it has, whether or not it already exists in the final table.
- **ET-5** The analysis stays read-only and its cost stays bounded: the proximity test uses the padron spatial index
  (`ST_DWithin`), not a cross join.

### Report
- **ET-6** The report has a KPI group "Tramos repetidos por localidad" with: total, near urban only, near rural only, near both,
  near none, and the cross-department count. A collapsible list shows the rows with the columns `reftramo`, `idcalle`,
  `Departamento`, `Localidades`, `Caso`, `Largo (m)`, `Cerca de urbanos (m)`, `Cerca de rurales (m)`, and a "Ver en mapa" button.
  `Caso` text: URBAN "Cerca de padrones urbanos", RURAL "Cerca de padrones rurales: sin regla", BOTH "Cerca de ambos: se mantienen
  las dos", NEITHER "Lejos de padrones: decidir en el mapa".

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

## Out of scope
Deciding or applying anything (which copy is dropped, how both are stored), cross-department groups, groups with a section that the
final table already holds being treated differently, any write.
