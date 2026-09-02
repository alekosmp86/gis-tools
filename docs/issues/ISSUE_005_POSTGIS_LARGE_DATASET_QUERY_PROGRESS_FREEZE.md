# Issue #005: PostGIS Large Dataset Query Freezing Without Progress Feedback

## Problem Statement
When initiating the Step 4 comparison workflow on large spatial tables (e.g. `catastro_paisrural` with 1,046,570 records), the frontend progress bar remained frozen at `Consultando registros PostGIS... 0%` for 20–40 seconds.

During this period:
1. The user had zero visibility into whether the query was progressing or stalled.
2. The Node.js server attempted to buffer all 1.04M row objects into a single monolithic V8 array, serializing a 300+ MB JSON payload.
3. The browser main thread suffered several seconds of heap pressure and parsing lag when executing `await res.json()`.

---

## Root Cause Analysis & Technical Details

1. **Monolithic Query Execution**:
   - The original `/api/db/records` route executed `client.query(SELECT ...)` synchronously for all rows in a single batch.
   - HTTP response headers and body were withheld by the server until 100% of rows were retrieved, formatted, and serialized into JSON.
2. **Absence of Chunked Streaming Protocol**:
   - The client-side comparison engine used static `fetch("/api/db/records")`, which could not receive incremental chunk progress from PostgreSQL.

---

## Implemented Solution

We introduced a **hybrid streaming architecture** with native PostgreSQL server-side cursors and Web ReadableStreams:

1. **Streaming Endpoint with SQL Server-Side Cursor ([`src/app/api/db/records/stream/route.ts`](file:///c:/Alekos/Projects/gis-tools/src/app/api/db/records/stream/route.ts))**:
   - Runs a fast `SELECT COUNT(*)` to obtain the exact total record count.
   - For datasets $\le 25{,}000$ records (`STREAMING_RECORD_THRESHOLD`), executes the fast single-shot query in $<100\text{ ms}$.
   - For datasets $> 25{,}000$ records up to $1\text{M}+$ records, opens a PostgreSQL transaction cursor:
     ```sql
     BEGIN;
     DECLARE db_stream_cursor NO SCROLL CURSOR WITHOUT HOLD FOR SELECT ...;
     FETCH 50000 FROM db_stream_cursor;
     ...
     COMMIT;
     ```
   - Streams row batches as Newline-Delimited JSON (NDJSON) over standard Web `ReadableStream`.
2. **Client-Side Progressive Stream Reader ([`src/services/streaming/DatabaseStreamReader.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/streaming/DatabaseStreamReader.ts))**:
   - Reads the NDJSON stream line-by-line via `response.body.getReader()`.
   - Emits real-time progress callbacks:
     `onProgress("Consultando registros PostGIS (" + formatNumber(current) + " de " + formatNumber(total) + ")...", current, total)`
   - Smoothly advances the Step 4 progress bar (50k, 100k, 150k... 1.04M) with live percentage updates.
3. **Integrated Engines**:
   - Updated [`DbVsFileComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsFileComparisonEngine.ts) and [`DbVsDbComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsDbComparisonEngine.ts) to utilize `DatabaseStreamReader`.

---

## Verification & Testing

- **Compilation & Lints**: Passed with 0 errors via `npx tsc --noEmit` and `npm run lint`.
- **Large Dataset Streaming**: Tested with 1,046,570 PostGIS records. Progress bar increments smoothly in 50k intervals from 0% to 100% with live formatted counts without UI freezing.
