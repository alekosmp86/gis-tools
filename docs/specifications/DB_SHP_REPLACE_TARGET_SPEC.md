# DB vs. Shapefile: Replace target table (spec v1.0)

> Tool: `db-shapefile-sync` (core). Related: `DB_DB_REPLACE_TARGET_SPEC.md` (DB to DB replace, same UX).
> Status: implemented, P4 (real PostGIS check) pending. Phases: P1 server core, P2 API routes + job store, P3 wizard UI, P4 real check on dev.

## 1. Problem

The comparison flow pairs rows by SUID. The SUID of some layers is not unique, so many records are flagged as
duplicates and never compared. For those layers the wanted result is simpler: **replace the whole content of a
DB table with the content of the shapefile**, mapping shapefile fields to table columns by hand (DBF field
names are cut at 10 characters, so names may differ). No SUID is involved.

## 2. Scale (worst case drives the design)

| File | Records | zip | .shp | .dbf |
|---|---|---|---|---|
| PaisUrbano | 1,051,701 | 110 MB | 177 MB | 210 MB |
| PaisRural | 252,176 | 174 MB | 226 MB | 42 MB |

The existing DB to DB replace sends 500-row INSERT batches from the browser, each batch its own transaction. That
is not acceptable here: too slow, hundreds of MB of generated SQL, and a failure midway leaves the table half
replaced. **The replace of a shapefile runs on the server, in ONE transaction.**

## 3. Design

All code lives in core (`src/core/services/server/shpReplace/`, routes under `src/app/api/db/shp-replace/`). No
module is touched or imported. Reused: `extractShapefileZip` (`but-unzip`, in memory; the biggest uncompressed
layer is under 0.5 GB), `BinaryShpReader`, `BinaryDbfReader` (read WITHOUT a coordinate transform, so geometries
stay in the file CRS), `replaceColumnMapping` helpers, `sqlStatements` identifier quoting, `pg`, `pg-copy-streams`.

Flow:

1. **Upload** `POST /api/db/shp-replace/upload`: raw streamed body (never `formData()`/`arrayBuffer()`), header
   `x-file-name`, written to a temp file under `os.tmpdir()/gis-tools-shp-replace/<uploadId>.zip`. Returns
   `{ uploadId, size }`. Size cap 1 GiB. Leftover uploads are swept after 2 h.
2. **Start** `POST /api/db/shp-replace/start`: `{ connection (+password), uploadId, mapping, sourceSrid,
   resetSequences, confirm: true }`. Validates, takes the per-table lock, returns `{ jobId }` at once; the job
   runs in-process.
3. **Status** `GET /api/db/shp-replace/status?jobId=`: `{ state, phase, current, total, result? }`.
4. **Replace transaction** (one client, one transaction):
   `BEGIN`; `CREATE TEMP TABLE stage (rec int, f1 text, ..., fN text, geom_json text) ON COMMIT DROP` (one text
   column per MAPPED DBF field, named from the mapping, plus `geom_json` when the geometry is mapped);
   `COPY stage FROM STDIN` (text format, streamed in chunks with backpressure, one tuple per record, geometry as
   GeoJSON text); verify `count(*)` equals the DBF record count; `LOCK TABLE target IN SHARE ROW EXCLUSIVE MODE`;
   `DELETE FROM target` (never TRUNCATE: it needs a privilege the app role may lack); `INSERT INTO target (cols)
   SELECT <casts> FROM stage`; optional sequence reset; `COMMIT`; then `ANALYZE target` (its failure is a
   warning, not a failure). Any error before COMMIT rolls back and leaves the table untouched.
5. **Casts**: text column -> target type by the target column's `data_type` (empty string -> NULL for non-text
   types, same rule as `isNonTextType`); geometry column -> `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geom_json),
   sourceSrid), targetSrid)` wrapped in `ST_Multi(...)` when the target geometry type is a Multi type, skipped
   transform when the SRIDs are equal. Target type, target SRID and geometry type are read from the catalog /
   `geometry_columns` at start, never trusted from the client.
6. **Fixed defaults** for unmapped target columns reuse the existing mapping model (`defaults`, with
   `useRawExpression`).

## 4. Acceptance criteria

- AC-1 The shapefile tool offers a mode step (Comparar / Reemplazar), same component as DB to DB. Replace mode
  skips SUID mapping and goes to column mapping, then a destructive confirmation, then a progress panel.
- AC-2 Column mapping maps each TARGET column to a DBF field, to the geometry, or to a fixed default. DBF field
  names are shown as-is (10 chars). Unmapped target columns without default are left to the table default; a
  NOT NULL column without source or default blocks the run (existing `findMissingRequiredColumns`).
  Auto-mapping pre-fills DBF fields by tiers, in order, each consuming its matches: exact name; case-insensitive;
  normalized (ignoring case, underscores, hyphens, spaces, accents); truncated (a 10-character DBF name that is the
  prefix of a longer target name); similar (normalized Damerau-Levenshtein distance 1, both names at least 5
  characters). A pair is accepted only when it is unique on both sides. Auto-matched columns are marked and can be
  changed by the user; the geometry is never auto-matched and is selected by default.
- AC-3 Upload streams the file; server memory does not grow with the body beyond the chunk size. An upload over
  the cap is rejected with 413 and nothing is left on disk.
- AC-4 `start` requires `confirm: true`, an existing `uploadId`, a password, a table that exists, a mapping whose
  target columns all exist, and a source SRID present in `spatial_ref_sys`. Otherwise 400/404/409 with a Spanish
  message and no side effect. One running job per target table (409 on the second; the lock is released on every
  exit path).
- AC-5 The whole replace is one transaction: on any failure (bad cast, constraint, count mismatch, connection
  loss, cancel) the target table has exactly its previous content. The result says `targetModified: false`.
- AC-6 Row accounting: `sourceRows` counts DBF records including those flagged deleted; `stagedRows` =
  `insertedRows` = non-deleted records; a staged/inserted mismatch aborts and rolls back. Rows removed from the
  table are reported as `previousRows`. A `.shp` whose record count differs from the `.dbf` is refused before any
  DELETE.
- AC-7 A file with 0 records is refused before any DELETE (a replace must never empty a table by accident).
- AC-8 Records with a NULL shape are loaded with a NULL geometry (not an error) when the column allows NULL,
  otherwise they fail the cast and roll back.
- AC-9 DBF text uses the `.cpg` encoding (default windows-1252, as the compare path does). DBF deleted-record
  flags are respected the same way the compare path does.
- AC-10 Geometry stays in the file CRS in memory; the only transform is the SQL one. Source SRID is a number the
  UI prefills when detectable from the `.prj` and the user can edit; the server validates it.
  - CRS detection (`detectSridFromPrj` / `describeCrsFromPrj`, `src/core/services/shpSrid.ts`), first match wins:

    | `.prj` evidence (matched case-insensitively) | SRID |
    |---|---|
    | Top-level `AUTHORITY["EPSG", n]` of the root (PROJCS, GEOGCS, PROJCRS or GEOGCRS) | n |
    | Name `GCS_WGS_1984` | 4326 |
    | Name `GCS_SIRGAS_2000` | 4674 |
    | Name `GCS_SIRGAS-ROU98` | 5381 |
    | Name `SIRGAS-ROU98_UTM_Zone_21S` / `_22S` | 5382 / 5383 |
    | Name `WGS_1984_UTM_Zone_<1..60><N or S>` | 32600 + zone (N) / 32700 + zone (S) |
    | Name `SIRGAS_2000_UTM_Zone_<18..25>S` | 31960 + zone |
    | Anything else | none: the UI asks for the SRID |

  - Dataset date suggestion: the date offered by the INSERT quick-fill for an unmapped date or timestamp column is
    the newest modification date of the zip's `.shp` and `.dbf` entries (`readZipEntryDates`, `pickDatasetModifiedAt`).
    When there is no such entry, or the file is GeoJSON, it falls back to `File.lastModified`.
- AC-11 The job reports phases: `STAGING` (COPY, with `current/total` records), `SWAPPING` (delete + insert),
  `FINALIZING` (sequence, commit, analyze), `DONE`/`FAILED`. Until STAGING reports, the UI shows "Iniciando".
  Errors are scrubbed of the password. The job record is kept 1 h after finishing.
- AC-12 A restart of the server mid-run leaves the table untouched (transaction rolled back by the connection
  loss) and the leftover temp upload is swept.
- AC-13 The password is never written to disk, logs or the job record.
- AC-14 The wizard's replace run survives in-app navigation (run store like `fullReplaceRunStore`) and polls
  `status`; leaving the page does not cancel the server job.
- AC-15 Documentation: `docs/tools/DB_SHAPEFILE_SYNC_TOOL.md` gains a "Replace mode" section.
- AC-16 Commit-uncertain outcome: when the `COMMIT` statement itself throws, the outcome is unknown. The job fails
  with `outcomeUnknown: true` and a message asking the user to verify the target table before retrying, and no
  ANALYZE runs. Every other failure before COMMIT keeps "La tabla destino no fue modificada". The UI shows the
  unknown-state warning with the job id instead of the unmodified note.
- AC-17 Poll grace: the client gives up on `status` only after consecutive fetch failures span 60 s
  (`pollFailureGraceMs`). The failure message names the job id and the server; the outcome is unknown. Any
  successful poll closes the window and resets it.
- AC-18 Geometry: at most one target column may map to the shapefile geometry (the message names the columns).
  Only 2D geometries are accepted; a geometry with `coord_dimension` above 2 is refused before any DELETE. A target
  SRID of 0 (unconstrained geometry column) is accepted: no `ST_Transform`, the source geometry keeps its SRID.
- AC-19 Text cells: NUL characters are stripped before COPY encoding; a cell that is only NULs becomes an empty
  string, not NULL. Sessions run with `client_encoding = 'UTF8'`.
- AC-20 The per-table lock key is `host:port|db|schema|table`, so the same table name on another server or port is
  not blocked.

## 5. Out of scope

CSV tool (extend later with the same pipeline), cancel button (P2 may add a rollback-on-abort endpoint if cheap),
non-polygon-specific handling beyond GeoJSON conversion, identity columns, shared-sequence detection (same as DB
to DB), any change to the comparison flow.

## 6. Risks

- PGlite has no PostGIS: the geometry SQL is only proven on a real database (P4). Pure builders are unit tested
  as SQL text; the transaction orchestration is tested with a fake/PGlite client without PostGIS functions.
- DELETE + INSERT of ~1M rows costs WAL and index time and holds the lock for minutes. The run says so before
  confirmation.
- The upload is a long request through the Next.js server; the 1 GiB cap and the sweep limit disk use.

## 7. Known limitations / deferred

- Start does not pre-validate the table or the SRID against the database; those failures surface inside the job
  (FAILED with the Spanish message, target untouched).
- No aggregate cap on the upload directory: each upload is limited to 1 GiB, but many concurrent uploads are not
  bounded on disk.
- DBF numeric values (N/F fields) go through `Number()`: integers above 15 significant digits lose precision, and
  leading zeros are lost.
- P4 (real PostGIS check on dev) is pending: the geometry SQL is verified only as SQL text.
