# Routine jobs: "Carga de centros ANEP" (CA-1 to CA-18)

## Context

The ANEP education centres (CEIP, CES, CETP, CFE) come from the IDEuy WFS layer `INE_NO_SEGURO_CLON_NS:centros_anep_2`. That layer is NOT listed in the WFS capabilities, so GeoServer cannot cascade it; it only answers a direct `GetFeature`. The data is loaded in two stages, like the other jobs:

1. Staging: the user downloads the layer as a zipped shapefile and loads it with db-shapefile-sync in **Reemplazo completo** into `bdj_carto.ine_centros_anep`. No new tool is needed.
2. Final: this job copies the staging table into `carto.ine_centros_anep` with a full replace. GeoServer publishes the final table and styles it with `puntos_iconos.sld` (filter attribute `subsistema`).

Download URL (verified: HTTP 200, `application/zip`, ~280 KB, 2,902 features):

```
https://mapas.ide.uy/geoserver-vectorial/INE_NO_SEGURO_CLON_NS/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=INE_NO_SEGURO_CLON_NS:centros_anep_2&outputFormat=SHAPE-ZIP
```

Facts read from the layer (not rules):
- Shapefile SRID is 32721 (`.prj` WGS 84 / UTM zone 21S). The GeoJSON of the same layer is EPSG:4326 (the layer also has `x`, `y` in 32721).
- Columns: `ogc_fid` (int), `wkb_geometry` (point), `ruee` (double), `x`, `y` (double), `subsistema`, `nombre`, `depto`, `depto_tex`, `localidad`, `paraje`, `calle`, `n_puerta`, `telefono` (text), `rule_est` (double). In the shapefile the geometry column is not a DBF field.
- `subsistema` values: CEIP 2,269, CES 323, CETP 278, CFE 32.
- `ruee` is not unique: 2,902 rows, 2,899 distinct values.
- Neither `bdj_carto.ine_centros_anep` nor `carto.ine_centros_anep` exists in dev yet.

## Job and endpoints

- CA-1: A job `centros-anep`, title "Carga de centros ANEP", is its own card in Trabajos de rutina, with a one-sentence description and its own wizard (same "Volver a la lista" behaviour as the other jobs).
- CA-2: Endpoints `POST centros-anep/start` and `GET centros-anep/status` (in `module.routes.json`) following the other jobs: connection in the body, table roles, polled `jobId`, one running job per target, Spanish errors, the password never logged or returned.
- CA-3: The request carries `dryRun`. `dryRun: true` runs the analysis (CA-8, CA-9) and writes nothing. `dryRun: false` runs the replace (CA-10 to CA-14).

## Tables

- CA-4: Table roles (schema and table editable, access, required logical columns):

| Role | Default | Access | Required columns |
|---|---|---|---|
| Centros ANEP (staging) | `bdj_carto.ine_centros_anep` | read | `ruee`, `subsistema`, `nombre`, `geom` |
| Centros ANEP (final) | `carto.ine_centros_anep` | write | same as staging |

- CA-5: The final table keeps every column of the staging table (same names and types). The job copies all columns that exist on both tables, matched by name, except any column the final table fills by default (serial or identity). A staging column missing in the final table is a blocker, listed by name. A final column missing in staging is reported as information, and must have a default or be nullable.
- CA-6: Table, column and SRID resolution and privileges follow the shared helpers of `jobs/shared`. The preflight requires `SELECT` on staging and `SELECT`, `INSERT`, `DELETE` (and sequence usage) on final. In a dry run, missing write privileges are information, in a real run blockers. Staging and final must be different tables.
- CA-7: The geometry is transformed to the SRID of the final table geometry column, read from its typmod (`ST_Transform`), never a literal. Staging or final geometry without an SRID is a blocker.

## Analysis (read-only, one transaction)

- CA-8: Staging checks, all reported as counts: total rows; rows by `subsistema`; rows with NULL or empty geometry; rows with NULL `ruee`; `ruee` that repeat (groups and rows, listed); rows with NULL `subsistema`; rows whose text columns contain U+FFFD (`chr(65533)`, damaged encoding). Empty staging, any NULL geometry and U+FFFD are blockers. Repeated or NULL `ruee` are warnings, never blockers (the source has repeated `ruee`).
- CA-9: Compared with the final table, the report shows rows now in final, rows that would be in final after the replace, and the difference by `subsistema`. The banner reads "Análisis: no se modificó ninguna tabla."

## Apply (real run)

- CA-10: The real run needs the password and the Revisar summary, with a destructive confirmation (the final table is emptied and refilled), as the Replace mode of the db tools.
- CA-11: The replace is one transaction that locks the final table, deletes every row (`DELETE`, never `TRUNCATE`, so privileges and dependent views are kept) and inserts the staging rows. The row count inserted must equal the staging count; otherwise the transaction rolls back. A failed COMMIT is reported as outcome unknown, as in the other jobs.
- CA-12: Before the first write the job writes a gzip revert SQL file (the previous rows of the final table), registered and shown in the result, as actualizar-padron.
- CA-13: After the load the job runs `ANALYZE` on the final table.
- CA-14: The result shows the counts per `subsistema`, the warnings of CA-8 and "Siguiente paso sugerido": refresh the GeoServer layer if it caches (the layer reads the table directly, so nothing else is needed).

## Wizard

- CA-15: Steps Conexión, Tablas, Revisar and Resultado on the shared orchestrator. The Tablas step uses the shared `TableSelector`. Revisar has "Analizar"; "Analizar" is optional: "Cargar ahora" is enabled with the password typed again and the destructive confirmation checked, without a prior analysis. The real run reads the staging report inside its transaction and, before the backup and the DELETE, stops with the CA-8 blockers if there are any (nothing is written then). Resultado shows progress and the report. State, steps and run store live beside the other jobs' (`ui/centrosAnepWizardState.ts`, `ui/centrosAnepWizardSteps.ts`, `ui/centrosAnepRunStore.ts`).
- CA-16: The Conexión step shows a note: "Antes de correr este trabajo, cargue la tabla de staging con DB vs. Shapefile (Reemplazo completo) desde el shapefile del WFS de IDEuy" with the download URL.

## Documentation and tests

- CA-17: Wiki page `centros-anep.md` and a line in its index, including the download URL and the GeoServer publication steps with `puntos_iconos.sld`.
- CA-18: Unit tests per the project's testing standards (column matching, request parsing, analysis counts, wizard state, SQL builders); real SQL behaviour of the replace on PGlite where PostGIS is not needed, and the geometry transform with the SQL builders. The wiki content test keeps passing.

## Out of scope

- Creating the staging and final tables (done by the user; the job reports them missing). DDL proposals are in the open questions.
- Scheduling or automatic download from the WFS.
- Publishing the layer in GeoServer.
- A key or deduplication on `ruee`.

## Decisions

1. The staging table is created by the user before the first load (db-shapefile-sync Replace needs it to exist). DDL below.
2. Both tables use SRID 32721 (GeoServer declares the SRS when publishing). CA-7 then transforms nothing in practice but still reads the SRID from the typmod.
3. The final table has `id serial` as primary key. It is the only final column not in staging (CA-5: filled by its default).

```sql
CREATE TABLE bdj_carto.ine_centros_anep (
  ruee double precision, x double precision, y double precision,
  subsistema text, nombre text, depto text, depto_tex text, localidad text,
  paraje text, calle text, n_puerta text, telefono text, rule_est double precision,
  geom geometry(Point, 32721)
);
CREATE TABLE carto.ine_centros_anep (
  id serial PRIMARY KEY,
  ruee double precision, x double precision, y double precision,
  subsistema text, nombre text, depto text, depto_tex text, localidad text,
  paraje text, calle text, n_puerta text, telefono text, rule_est double precision,
  geom geometry(Point, 32721)
);
CREATE INDEX ine_centros_anep_geom_idx ON carto.ine_centros_anep USING gist (geom);
CREATE INDEX ine_centros_anep_subsistema_idx ON carto.ine_centros_anep (subsistema);
```

## Acceptance criteria count

CA-1 to CA-18 (18 criteria).
