# Routine Jobs — "Completar unidades territoriales": acceptance criteria

Fourth stage of the monthly carto update job in the `routine-jobs` module (`src/modules/routine-jobs/`). Stage id:
`completar-unidad-territorial`. Spanish name: "Completar unidades territoriales". It follows "Actualizar unidades territoriales"
(`unidad-territorial`, stage 3 of `ROUTINE_JOBS_MONTHLY_CARTO_UPDATE_SPEC.md`) and reuses its conventions: one wizard per stage, hub
connection, `TableSelector`, shared job store, per-target locks, step checklist from server-sent planned steps, Spanish messages,
scrubbed passwords, shared report components and CSV download. Acceptance criteria ids use the prefix `CU-`.

The padron address master links are NOT part of this stage: stage 5 (`ROUTINE_JOBS_ACTUALIZAR_PADRON_SPEC.md`, AP-51 to AP-60) links
the padrones it inserts, behind its own option. The link SQL and its safety rules are shared (`jobs/shared/addressMasterLink*`), so
both stages apply the same rules.

Legacy oracle: the `UNIDAD TERRITORIAL` block of the one-time script `addressMaster.sql` (outside the repo, read-only):

```sql
INSERT INTO carto.addresses_master(urn, latitud, longitud)
  SELECT concat('cgeo:territorial_unit:id:', f.id), 0, 0 FROM carto.territorial_unit f WHERE f.id_address_master IS NULL;
UPDATE carto.territorial_unit SET id_address_master = a.addresses_master_id FROM
  (SELECT am.addresses_master_id, am.urn, f.id FROM carto.territorial_unit f
   INNER JOIN carto.addresses_master am ON f.id = (SPLIT_PART(am.urn,':',4))::int
   WHERE SPLIT_PART(urn,':',2) = 'territorial_unit' AND f.id_address_master IS NULL) a
WHERE territorial_unit.id = a.id AND territorial_unit.id_address_master IS NULL;
REFRESH MATERIALIZED VIEW carto.mv_territorial_unit_full;
```

This stage reproduces the INSERT and the UPDATE with the safety rules below. It never runs the REFRESH (CU-12).

## Context

- Every `territorial_unit` row needs a record in `addresses_master` (its URN is `cgeo:territorial_unit:id:<id>`) and a link from
  `territorial_unit.id_address_master` to that record. Units inserted by stage 3 start with `id_address_master` NULL.
- The stage touches two tables chosen by the user, each with its own schema: the territorial unit table (prefilled from the stage 3
  target, default `carto.territorial_unit`) and the address master table (default `carto.addresses_master`). No table name is a
  literal in SQL; column names come from declared logical columns resolved against the catalog.
- There is no source or staging table and no options step.

## Acceptance criteria

- CU-1: The wizard has the steps Tablas, Revisar, Ejecución, Informe. Tablas asks schema and table for the territorial unit table and for
  the address master table; the unit table prefills from the last stage 3 run, else `carto.territorial_unit`; the address master table
  prefills `carto.addresses_master`. The connection comes from the hub.
- CU-2: Required columns: unit table `id`, `name`, `id_province`, `id_address_master`; address master table `addresses_master_id`,
  `urn`, `latitud`, `longitud`. Missing or ambiguous columns block the step. The two tables must differ.
- CU-3: Candidates are ALL rows of the unit table with `id_address_master IS NULL`, whatever their unit type.
- CU-4: The URN of a candidate is the constant prefix `cgeo:territorial_unit:id:` followed by the unit id. The URN is matched by exact
  string equality (never parsed with `SPLIT_PART` and a cast).
- CU-5: A candidate with no address master row with its URN gets `INSERT ... (urn, latitud, longitud) VALUES (urn, 0, 0)`, ordered by
  unit id. `addresses_master_id` comes from the table sequence.
- CU-6: A candidate with exactly one address master row with its URN does NOT get a second row: it is only linked to that row.
- CU-7: A candidate with two or more address master rows with its URN is AMBIGUOUS: it is neither inserted nor linked, only reported
  (counts and a sample list, up to `SAMPLE_LIMIT`). The stage never guesses.
- CU-8: Linking is `UPDATE territorial_unit SET id_address_master = <address master id> ... WHERE id_address_master IS NULL`, for the
  linkable candidates only (new and existing). The run is idempotent: a second run finds no candidates left except ambiguous ones.
- CU-9 (INVARIANT, MJ-13): the stage never issues DELETE or TRUNCATE; never sets `addresses_master_id`; never changes
  `territorial_unit.id`, the geometry or any column other than `id_address_master`; never overwrites a non-null `id_address_master`.
- CU-10: One transaction per run (`REPEATABLE READ`), a per-target lock on BOTH tables (a run on either table conflicts with a run
  using it), the insert and the update in one data-modifying CTE statement, PostgreSQL 11 compatible, no `MATERIALIZED` hints. The
  address master sequence goes through the same resolution and repair as the other stages (`Ajustar secuencia`). Dry run
  ("Analizar sin cargar") is the same work followed by ROLLBACK. ANALYZE of both tables runs at the end of the transaction. Operational notes: (a) a dry run still consumes `addresses_master_id` sequence
  values (`nextval` is not transactional), so real ids show gaps; (b) the locks of stage 3 and stage 4 are independent: a concurrent run
  on the same rows raises a serialization error and rolls back; (c) the stage assumes no other session inserts into `addresses_master`
  during the run (no `LOCK TABLE`, the application role may lack the privilege). Candidates are grouped by (unit id, urn), so a duplicated
  unit id counts once and fails the linked-count check below.
- CU-11: Count checks roll back the whole transaction on mismatch: records created equal candidates without a row; units linked equal
  candidates minus ambiguous; units still without address master after the update equal the ambiguous count.
- CU-12: The tool NEVER refreshes `<unit schema>.mv_territorial_unit_full`. The view name is a named constant. When the run
  modified something (real run, linked units > 0), the commit outcome is unknown (the data may have changed), or a dry run would modify something, the report shows a section
  "Siguiente paso sugerido" below the counts: "Actualice la vista materializada para que refleje los cambios. Si no tiene permiso para
  hacerlo, pida a quien lo tenga que ejecute:" (dry run: "Después de cargar, actualice ...") followed by a selectable code block with
  `REFRESH MATERIALIZED VIEW "<schema>"."mv_territorial_unit_full";` (identifiers always quoted), `<schema>` being the schema chosen for the unit table. No copy button:
  `ui-kit` has no clipboard component and a module cannot import another module's.
- CU-13: The real run needs the database password and the typed names of BOTH modified tables (unit table and address master table);
  the dry run needs only the password.
- CU-14: Preflight: both tables are regular or partitioned tables without inheritance, triggers or rules; the user has SELECT and UPDATE
  on the unit table, SELECT and INSERT on the address master table and UPDATE on its sequence; the address master table has a sequence
  for `addresses_master_id` and no other NOT NULL column without default.
- CU-15: Report counts: "Unidades sin dirección maestra", "Registros creados", "Unidades enlazadas", "Ya tenían registro" (candidates
  with exactly one existing row), "Ambiguas". A collapsible list of linked units (up to `DETAIL_LIST_LIMIT`, with id, name, province
  id, address master id and whether the record was created or already existed) and a collapsible sample list of ambiguous units.
  Banners (dry run, done, uncertain commit), warnings, timings and the layout match the other stages.
- CU-16: "Descargar CSV" exports the database changes only. Header `Tabla,Cambio,Provincia,Nombre,Id,Id dirección maestra`; one row per
  created record (`Dirección maestra creada`, Id = unit id) and one per linked unit (`Unidad enlazada`). Filename convention of the other
  stages with the stage slug `completar-unidad-territorial`. When the linked list is cut at `DETAIL_LIST_LIMIT` (linked count greater
  than the list length) the CSV ends with one marker row: Tabla = unit table, Cambio = `Lista incompleta: se muestran las primeras 500 de N
  unidades enlazadas` (N = real count), other cells empty. The created-records list gets the same marker (Tabla = address master table, `... de N direcciones maestras creadas`).
- CU-17: Error handling and hub behaviour as in stage 3: the stage opens from the hub without status, a 409 reports the conflict, an
  uncertain commit is reported, secrets are scrubbed.
- CU-18: The unit and address master pickers prefill `carto.territorial_unit` (or the stage 3 target) and `carto.addresses_master` from `config/monthlyTables.ts`; a default missing from the schema is cleared without an error.
