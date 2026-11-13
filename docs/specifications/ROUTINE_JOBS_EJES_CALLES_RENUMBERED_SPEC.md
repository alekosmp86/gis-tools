# Ejes de calles — renumbered sections (analysis only)

Part of the routine job "Carga de ejes de calles" (`src/modules/routine-jobs/jobs/ejes-calles`). Extends the read-only analysis
(`ROUTINE_JOBS_EJES_CALLES_SKELETON_SPEC.md`, `ROUTINE_JOBS_EJES_CALLES_TWINS_SPEC.md`). Nothing is written to any table.

## Background (data, dev, before this change)

Of the 6,904 current sections that no longer come in the file, 4,037 have a new section (not in `carto`) of the same `idcalle`
with an essentially identical shape: the Hausdorff distance is under 0.01 m for 4,004 of them and under 0.5 m for all. Only the
`reftramo` changed. The analysis lists 4,595 sections as "divided into several new ones", but 3,987 of those are these renumbered
sections: a neighbouring new section that touches their end within the 1 m tolerance was counted as a second piece. Of the 2,299
removed sections with access points, 1,762 (8,847 points) are renumbered ones. `access_point.id_road_section` refers to the section
by its `reftramo` (894,209 of 968,042 points match `road_section.reftramo_ideuy`; there is no foreign key), so a renumbering changes
the `reftramo` of the section and, with it, the reference of its points; the section id never changes.

## Criteria

- **ER-1** A *renumbered pair* is a current section with no key in the file (a removed section, length > 0) and a new section
  (valid geometry, not in `carto`) with the same non-null `idcalle`, within `RENUMBER_CANDIDATE_DISTANCE_M` (the existing
  `COVERAGE_TOLERANCE_M`, 1 m) of it and a Hausdorff distance under `RENUMBER_HAUSDORFF_M` (0.5 m, in `constants.ts`). Only
  one-to-one pairs count: the old section has exactly one such candidate and the new section exactly one such old section;
  ambiguous cases (about 10 old and 11 new on dev) keep their present category.
- **ER-2** Renumbered olds are taken out of the removed set used by the split, merge and plain-removal logic, and renumbered news are
  taken out of the new-section set used there as pieces, so neither a renumbered section nor its neighbours inflate those
  categories. A section with access points that is renumbered is never counted as a held removal.
- **ER-3** The analysis returns the counts `renumbered`, `renumberedWithPoints` (pairs whose old section has access points) and
  `renumberedPoints` (their total), and a list of up to `DETAIL_LIST_LIMIT` pairs ordered by points descending, then old
  `reftramo`, each with `oldRef`, `newRef`, `idcalle`, `points`, `oldLength`, `newLength` and `hausdorff`. `removed` stays the raw count of sections
  no longer in the file and equals `renumbered` plus the removed sections left to the split, merge and plain-removal logic
  (`splits` counts one per old section, `merges` one per new section, so the sum of the four counts equals `removed` only when
  every merge has exactly two old sections).
- **ER-4** The report shows in the group "Tramos actuales que ya no vienen en el archivo" the KPI "Renumerados (mismo trazado,
  otro reftramo)", and in the new-sections group the "Nuevos" KPI no longer counts the renumbered news (it shows
  `newSections - renumbered`). Next to the KPI, "Renumerados con puntos de acceso" and "Puntos de acceso que seguirían al
  renumerar" are shown. A collapsible list "Tramos renumerados" has the columns `reftramo anterior`, `reftramo nuevo`, `idcalle`,
  `Puntos de acceso`, `Largo anterior (m)`, `Largo nuevo (m)` and a "Ver en mapa" button.
- **ER-5** The map of a renumbered pair draws the old section and the new one (the existing outlines and colours of old and
  new sections, old thicker below, new on top), titled "Tramo renumerado", with navigation among the rows of the table. Its details
  show `idcalle`, access points, the two lengths and the Hausdorff distance in metres. It reuses the existing map request
  (`oldRef`, `newRef` items); no new endpoint.
- **ER-6** The analysis stays read-only and its cost bounded: the candidates use the spatial index (`ST_DWithin`) and the same-`idcalle`
  join; the Hausdorff distance is computed only for candidates.

## Out of scope
Applying the renumbering (the real load: update `road_section.reftramo_ideuy` and, in the same transaction,
`access_point.id_road_section` of its points; pending confirmation with the business), revert SQL, any write.
