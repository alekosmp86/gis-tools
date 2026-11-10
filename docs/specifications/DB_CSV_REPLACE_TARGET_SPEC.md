# DB vs. CSV: Replace target table (spec v1.0)

> Tool: `db-csv-sync` (core). Baseline: `DB_SHP_REPLACE_TARGET_SPEC.md` (the shapefile replace; its section 5 left the CSV tool for later "with the same pipeline"). Same UX as the shapefile and DB to DB replace.

## 1. Problem

The CSV tool only compares by SUID. A staging table such as `bdj_carto.ide_ejesviacirculacion` has to be filled with the **whole content of a CSV**, replacing what the table holds, with no SUID involved. The shapefile tool already does this on the server in one transaction; the CSV tool must offer the same mode.

## 2. Decisions (confirmed)

- Pipeline: upload the raw CSV, parse it **on the server**, `COPY` into a temp stage, `DELETE` + `INSERT` in one transaction (as the shapefile replace). The rows the browser parsed for the comparison are not sent.
- Mapping: every CSV column can map to a target column as text cast to the target type; one target geometry column can take geometry from a CSV geometry source (EWKB hex, WKT, or a latitude/longitude pair), as the comparison flow already understands them.
- Options: "Reiniciar secuencias del destino" and ANALYZE after commit, as in the shapefile replace. The table is emptied with `DELETE` only (never `TRUNCATE`: the app role may lack the privilege, as on preprod).

## 3. Design

Reuse, do not copy: the shared server pieces of `src/core/services/server/shpReplace/` that are not shapefile specific (job store and per-table lock, `COPY` text encoding with NUL stripping, replace SQL builders and casts, sequence reset, ANALYZE, the phases `STAGING` / `SWAPPING` / `FINALIZING`, scrubbed errors, commit-uncertain handling) and of the client (`shpReplaceClient`, `shpReplaceRunStore`, the replace wizard components of `db-sync-common` and `db-shapefile-sync`). Where a piece is shapefile specific today, generalise it (a record source interface) instead of duplicating it, and keep the shapefile behaviour and tests unchanged. The CSV parsing is `src/core/services/parsers/CsvParser.ts` (delimiter detection, BOM, geometry parsing), used on the server from a file stream.

Flow: upload (`POST /api/db/csv-replace/upload`, raw streamed body, header `x-file-name`, temp file, size cap, sweep) -> start (`POST /api/db/csv-replace/start`) -> status (`GET /api/db/csv-replace/status?jobId=`), as the shapefile routes.

## 4. Acceptance criteria

- CR-1 The CSV tool offers the mode step (Comparar / Reemplazar), the same component as the other tools. Replace mode skips the SUID mapping and goes to the column mapping, then the destructive confirmation, then the progress panel.
- CR-2 The column mapping maps each TARGET column to a CSV column (by header name), to the geometry, or to a fixed default, with the same auto-matching tiers and the same blocking of NOT NULL columns without a source or default as the shapefile replace (AC-2).
- CR-3 Upload streams the file with no memory growth beyond the chunk size; the cap and the sweep of leftovers are those of the shapefile upload (AC-3), the cap named in the message of the 413.
- CR-4 `start` requires `confirm: true`, an existing `uploadId`, a password, an existing table, a mapping whose target columns all exist, and, when a geometry is mapped from WKT or a lat/lng pair, a source SRID present in `spatial_ref_sys`. Otherwise 400/404/409 with a Spanish message and no side effect. One running job per target table (the lock key of AC-20), released on every exit path.
- CR-5 The whole replace is one transaction: on any failure (bad cast, constraint, count mismatch, connection loss) the target table has exactly its previous content, and the result says `targetModified: false`. The commit-uncertain outcome (AC-16) and the poll grace of 60 s (AC-17) behave as in the shapefile replace.
- CR-6 Row accounting: `sourceRows` counts the data rows of the file (the header excluded, blank lines not counted); `stagedRows` = `insertedRows`; a mismatch aborts and rolls back. Rows removed from the table are reported as `previousRows`. A file with no data rows, or with a header missing a mapped column, is refused before any DELETE.
- CR-7 The server detects the delimiter (`,`, `;`, tab), strips a UTF-8 BOM, handles quoted fields with embedded delimiters, quotes and line breaks, and reads the file as UTF-8 (a file that is not valid UTF-8 is refused with a Spanish message before any DELETE). A row with a different number of fields than the header is refused before any DELETE with its line number.
- CR-8 Text cells: NUL characters are stripped before `COPY`; an empty cell becomes NULL for non-text target types and stays an empty string for text types (the rule of `isNonTextType`). Sessions run with `client_encoding = 'UTF8'`.
- CR-9 Geometry: at most one target column may map to the CSV geometry (the message names the columns). A geometry source is an EWKB hex column, a WKT column, or a latitude/longitude column pair (the names the comparison flow recognises); EWKB carries its own SRID, WKT and lat/lng use the chosen source SRID (default 4326). Casting is done in the database as in the shapefile replace (`ST_Transform`, `ST_Multi` for Multi targets); only 2D targets are accepted; a target SRID of 0 is accepted. A geometry that cannot be parsed fails the run with the row number and no change.
- CR-10 Options: `resetSequences` as in the shapefile replace (optional repair after the insert, no `setval` when off, the privilege message of the other jobs when `UPDATE` is missing) and `ANALYZE` after COMMIT (its failure is a warning, never a failure). The table is emptied with `DELETE FROM`, after `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE`.
- CR-11 The job reports the phases `STAGING` (with `current/total` rows), `SWAPPING` and `FINALIZING`, then `DONE`/`FAILED`; errors are scrubbed of the password; the job record is kept 1 h; the password never reaches disk, logs or the job record (AC-11, AC-13).
- CR-12 The wizard's replace run survives in-app navigation through a run store and polls `status`; leaving the page does not cancel the server job (AC-14).
- CR-13 The shapefile and DB to DB replace modes, their routes and their tests keep working unchanged.
- CR-14 Documentation: `docs/tools/DB_CSV_SYNC_TOOL.md` gains a "Replace mode" section; the `db-csv-sync` wiki gains a page for it (Spanish, with the destructive warning, the mapping, the options and how to read the result), and the wiki index links it.

## 5. Out of scope

Any change to the comparison flow, a cancel button, encodings other than UTF-8, identity columns, shared-sequence detection, a real PostGIS check on dev (pending like P4 of the shapefile replace; the geometry SQL is proven as SQL text and with PGlite without PostGIS).

## 6. Risks

- A CSV of hundreds of thousands of rows (about 300,000 for the street axes) means a long `DELETE` + `INSERT`; the run says so before the confirmation, as the shapefile replace does.
- Server-side CSV parsing must stream (no whole-file string) to keep memory flat.
- Generalising the shapefile pieces can break the shapefile mode: its tests must stay green and unchanged.

## 7. Acceptance criteria count

CR-1 to CR-14 (14 criteria).
