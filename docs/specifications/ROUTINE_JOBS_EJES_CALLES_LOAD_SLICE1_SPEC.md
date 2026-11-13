# Routine jobs: "Carga de ejes de calles", real load slice 1 (EJL-1 to EJL-16)

Scope: real load of NEW, ATTR, GEOM, twin and renumbered sections. Out of scope: topology (EJ-20), splits and merges (EJ-19), plain removals (EJ-21), UI wiring (EJ-24). Builds on EJ-3, EJ-13 to EJ-18, EJ-22, EJ-23 of `ROUTINE_JOBS_EJES_CALLES_SKELETON_SPEC.md`.

## Criteria

- EJL-1: `dryRun:false` is accepted only with the password, the Revisar summary of the same staging data and an `accepted` object (empty allowed). Otherwise 400 with a Spanish message. A body that asks for accepted splits, merges or removals keeps the EJ-3 message.
- EJL-2: The apply is one transaction. It takes `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` on `road_section`, `circulation_way`, `addresses_master` and `access_point` with a `lock_timeout`, and ends with `ANALYZE` on the changed tables. A failed COMMIT is reported as outcome unknown.
- EJL-3: Blockers (EJ-8) are recomputed inside the transaction; any blocker aborts before the backup. A geometry that stays multi-part after `ST_LineMerge` is a blocker.
- EJL-4: The gzip revert SQL is written, verified and registered before the first write. A failure rolls back and leaves no file. Revert restores old values of updated rows (including `reftramo_ideuy` and `access_point.id_road_section`) and deletes inserted ids.
- EJL-5: `circulation_way`: new `(id_calle, name)` pairs are inserted with type and font of the first section (lowest `reftramo`) and the `short_name` of EJ-23. Existing rows are untouched. Sequences are repaired first.
- EJL-6: Identity of a staging copy is `reftramo + locality + department`. Per `reftramo`, K = copies kept by the twin rules, E = existing `road_section` rows with that `reftramo_ideuy`.
- EJL-7: K = E: copies are paired with existing rows by `idcalle` + name, then by lowest id; ATTR and GEOM are compared per pair. K > E: E pairs updated and K-E sections inserted as NEW. K < E: the K pairs are updated; the E-K surplus rows are reported (`reftramo`, id, access point count) and never deleted. Copies of the same locality and department count as one copy.
- EJL-8: NEW `road_section`: `id_circulation_way` = `idcalle`, mapped type and font, one `LineString`, `distance` = `ST_Length` with two decimals as text, `source` and `target` NULL. Each NEW section gets one `addresses_master` (`urn` = `cgeo:road_section:id:<id>`, `latitud` 0, `longitud` 0) linked through `id_address_master`.
- EJL-9: ATTR and GEOM update only the changed columns; GEOM recomputes `distance` and clears `source` and `target`.
- EJL-10: Renumbered sections (one-to-one, same `idcalle`, Hausdorff under `RENUMBER_HAUSDORFF_M`): the same transaction updates `road_section.reftramo_ideuy` to the new `reftramo` and `access_point.id_road_section` of the points of the old `reftramo` to the new one. The `road_section.id` never changes. The result lists the section and the number of points moved.
- EJL-11: `access_point` rows are never deleted. The only write on that table is the `id_road_section` update of EJL-10. `road_section_vertices_pgr` is not written. Points matching neither a `reftramo` nor an id are not touched.
- EJL-12: Sections absent from staging, splits, merges and plain removals are not modified; they are reported as skipped.
- EJL-13: The result has counts (inserted, updated, renumbered, ways created, masters created, points moved), the skipped and surplus lists, the backup, and the "Siguiente paso sugerido" text of EJ-22.
- EJL-14: A second run over the same staging changes nothing. The real run stays disabled in the UI until the user enables it.

- EJL-15: A `reftramo` repeated across localities is not a blocker (EJ-8 no longer blocks on it). Identity is reftramo + locality + department; twin rules and EJL-6/7 handle the repeats. Rows with the same reftramo, locality and department count as one copy.

- EJL-16: The real run is enabled only by the server env var `EJES_CALLES_REAL_RUN_ENABLED=true` (default off). With the switch off, `dryRun: false` is refused with 400 and "La carga real de ejes de calles todavía no está disponible." before any DB connection, and the writer service (`runEjesCalles`, `runEjesPersistTransaction`) throws the same message, so direct calls fail closed. One shared helper (`domain/realRunSwitch.ts`) holds the check.

EJL-1 to EJL-16 (16 criteria).
