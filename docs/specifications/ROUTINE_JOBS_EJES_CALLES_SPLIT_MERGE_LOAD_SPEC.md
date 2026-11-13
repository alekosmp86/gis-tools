# Routine jobs: "Carga de ejes de calles", splits, merges and removals (EJS-1 to EJS-16) - NOT BUILT

Refines EJ-13, EJ-19 and EJ-21 of `ROUTINE_JOBS_EJES_CALLES_SKELETON_SPEC.md`. Slice 1 (`..._LOAD_SLICE1_SPEC.md`) applies none of this.

## Facts (DEV ONLY numbers; nothing below may be assumed on preprod or prod)

- `carto.access_point` has no geometry. Point geometry: `carto.address.geometry` via `carto.address.id = carto.access_point.id` (SRID 32721). `bdj_carto` is never a source of points.
- `access_point.id_road_section` stores the section `reftramo` (not `id`); no FK; about 68k points match neither reftramo nor id and are never touched.
- Splits: 469, of which 192 hold points; 737 points, all associated by construction to the old section's reftramo. 648 have a clear nearest piece (second nearest at least 5 m farther); 36 are under 1 m apart, 89 under 5 m; 8 are within 1 m of the line.
- 281 points are more than 25 m from every piece (median 31.4 m, max 49.7 m, none over 100 m). All 281 are equally far from the OLD section (within 1 m of the same distance) and all have `access_point.id_circulation_way` equal to the section `idcalle`. Conclusion: the distance is lot offset from the street centreline, not a defect; nearest piece stays valid and 25 m is not an exclusion threshold.

## Criteria

- EJS-1: Every split, merge and removal is applied only through its per-row "Aceptar" (EJ-13), never automatically and never by "Aceptar todos" alone without the review. Splits are not the standard case: slice 1 reports and skips them.
- EJS-2: The tables step adds a read role on `carto.address` (`id`, `geometry`, SRID 32721). Point geometry is read only from it, joined by `access_point.id`, never from `bdj_carto`. Allowed staging inputs stay: `bdj_carto.ine_localidades_pg` and the ejes staging table. Access points are never deleted, orphans included; the only write on `access_point` is `id_road_section`.
- EJS-3: Split (one old, many new): each point of the old section goes to the nearest of the new pieces that cover the old section (distance from `address.geometry`); tie broken by the lower `reftramo`, but only when resolved per EJS-5.
- EJS-4: Merge (many old, one new): the points of every old section go to the single new section (`id_road_section` = its `reftramo`). No distance rule is needed.
- EJS-5: Automatic resolution is maximised. `AMBIGUOUS_POINT_GAP_M` = 5 m. Deciding rule: a split point resolves automatically to the nearest piece when (distance to second-nearest piece) - (distance to nearest piece) >= `AMBIGUOUS_POINT_GAP_M`. Distance to the line is not a criterion (no maximum distance, see EJS-8). Every other point (gap under the constant, EJS-7, or any other unresolved case) goes to the review list of EJS-6.
- EJS-6: Review list of unresolved points, with map and decision features: per-point rows with candidate pieces, distances and reason (ambiguous, no geometry, other); "Ver en mapa" showing the point, the old section and every candidate piece, each in its own colour; a button per candidate piece to choose it; bulk "Aceptar sugeridos" (nearest piece); filters by street and by reason; navigation like the twin/split map (Anterior / Siguiente, "N de M"). A split is applied only when each of its points is resolved (automatically or by user choice); otherwise it is skipped and reported.
- EJS-7: A point with no `carto.address` geometry is never resolved automatically: it appears in the review list with reason "sin geometria", no distances and no suggestion; the user picks a piece on the row (no point on the map).
- EJS-8: Only points already associated to a section (`access_point.id_road_section` = the old section's `reftramo`) are ever reassigned. Points with another or no association are never touched. Far points (over 25 m from every piece) follow the normal rule: the offset is lot offset, not a defect (Facts), so nearest piece applies and 25 m is no threshold; they are only counted in the preflight (EJS-14).
- EJS-9: Plain removals keep EJ-21: a section with access points is never deleted; one without is deleted with its address master.
- EJS-10: Order inside the one transaction: insert new sections and masters, reassign points, then delete old sections and masters. No row is deleted before its points are reassigned.
- EJS-11: The gzip revert SQL (EJL-4) restores the old `id_road_section` of every moved point and the deleted rows, and deletes the inserted ids.
- EJS-12: The result lists every reassigned point (old and new `reftramo`, distance, automatic or user choice) and every point left unresolved. Server real-run switch (EJL-16) and topology (EJ-20) apply unchanged.
- EJS-13: Reproducibility. The load runs on dev, preprod and prod, whose data may differ. All thresholds (`AMBIGUOUS_POINT_GAP_M`, the far-point reporting distance) are named constants; no dev number (469 splits, 737 points, 281 far, etc.) is assumed in code, tests or copy.
- EJS-14: A preflight verifies that `carto.address` has geometry for every point to be reassigned and reports, per environment, counts of points missing geometry, ambiguous (gap under the constant) and far (over the reporting distance from every piece). Missing geometry does not block; those points go to the review list (EJS-7).
- EJS-15: The analysis report states these environment-specific counts (splits, points, automatic, ambiguous, missing geometry, far) as measured in the environment being loaded.
- EJS-16: The user's choice per review-list point is part of the accepted payload and of the revert SQL (EJS-11).

EJS-1 to EJS-16 (16 criteria).
