# S1 report: streaming SHP -> EWKB (CGEO-2200 part 1)

Throwaway spike. Node 24.19 built-ins only, no DB, nothing under `src/`. `scripts/**` is in the eslint `globalIgnores`, so `npm run lint` does not see this folder.

## Files / how to re-run

PowerShell, from `C:\Alekos\Projects\gis-tools\scripts\spikes\shp-loader` (portable node: `C:\Alekos\Tools\node24portable` if `node` is missing).

```
node s1-selftest.mjs                                   # synthetic shp, strategies a/b/c, independent hand decoder
node --max-old-space-size=256 s1-run.mjs "<file.shp>" --strategy scan [--csv <out.csv>]
node --max-old-space-size=256 s1-run.mjs "<file.shp>" --strategy a --verify      # shells+holes assigned in Node
node --max-old-space-size=256 s1-run.mjs "<file.shp>" --strategy b               # one Polygon, all rings in file order
node --max-old-space-size=256 s1-run.mjs "<file.shp>" --strategy c               # ring rows (COPY text, hex EWKB)
# optional: --out <file> writes the bytes (default: SHA-1 + byte counter only), --limit N records
```
`shp-lib.mjs` holds the reader/producers. Per-record CSVs (record, parts, points, net_area, shells, holes) are in `C:\Users\g611045\AppData\Local\Temp\shp-s1\` (`NR_`, `LTE_`, `NBIoT_`, `WCDMA_records.csv`) plus the run logs for LTE.

## Findings that shape the decision

- Every record of all four files has exactly ONE shell (clockwise) plus N holes (counter-clockwise); no null shapes, no other shape types, no rings under 4 points, no unclosed rings, no zero-area rings. File orientation convention holds.
- Hole-to-shell assignment is therefore trivial on this data (all holes belong to the one shell). The assignment code is general (grid + sweep PIP, below) and was verified on a synthetic multi-shell/boundary case, but real-data multi-shell nesting is NOT exercised.
- All ring points can be copied byte-for-byte from the file into EWKB (same 16-byte x,y LE layout): no float parsing/GeoJSON.

## Numbers (all runs under `--max-old-space-size=256`; LTE a/c also re-run at 64)

LTE (293 MB, 3,973 records, 18,203,820 points, 443,972 rings, giant = record 3973: 16,395,840 pts / 427,338 rings = 1 shell + 427,337 holes):

| Strategy | Wall | Peak RSS | Peak heapUsed | Peak external/ArrayBuffers | EWKB/output bytes | Notes |
|---|---|---|---|---|---|---|
| scan only (pass 1) | 0.5 s | 105.8 MiB | 7.4 MiB | 54 MiB (metadata) | - | |
| (a) Node assigns holes | 1.4 s (scan 0.3, assign 0.5, emit 0.3) | 180.9 MiB (maxRSS 199.8) | 29.4 MiB | 84 MiB | 293,124,414 (279.5 MiB) | 879,998 PIP tests, 0 ambiguous, 0 unassigned |
| (b) single Polygon, file order | 0.5 s | 61.3 MiB (maxRSS 64.3) | 7.4 MiB | 6.8 MiB | 293,088,657 (279.5 MiB) | pure streaming, no metadata |
| (c) ring rows, COPY text hex | 2.7 s | 281.3 MiB | 53.6 MiB | 119 MiB | 660,878,728 (630.3 MiB) | 443,972 rows; binary COPY would be ~half |

Re-run at `--max-old-space-size=64`: (a) peak heapUsed 23.2 MiB, peak RSS 166.5 MiB; (c) peak heapUsed 87.8 MiB (the sampled `heapUsed` includes new-space and strings, the process did not die), peak RSS 272.9 MiB. Timings are warm page cache on an SSD: a cold read of 293 MB will be slower; the Node work is small.

Largest single allocation by my code: 1.0 MiB buffers (slice/out/window) and the 1.6 MiB `parts` Int32Array of the giant record in (b); in (a)/(c) the ring-metadata typed arrays, largest = `probes` 26.1 MiB (427,338 rings x 64 B). The 262 MB giant record is never in memory as one buffer; the biggest ring-level buffer is 1 MiB because every ring is copied through the 1 MiB window/out buffers. Note `--max-old-space-size` bounds the V8 heap, NOT ArrayBuffers (typed arrays are external); that is why RSS/external are reported as well. Metadata is ~200 B per ring worst case (about 85 MiB for the 427k-ring record in (a)).

NR (122 MB, 2,581 records, 7,576,428 points, 247,748 rings, giant = record 2581: 1,534,048 pts / 95,030 rings): (a) 0.8 s, peak RSS 103.8 MiB, heapUsed 14.1 MiB, 116.6 MiB EWKB, 490,334 PIP tests, 0 ambiguous/unassigned; (b) 0.3 s, 60.4 MiB RSS, 116.6 MiB; (c) 1.5 s, 158.8 MiB RSS, 274.9 MiB text.

Also run (strategy a, `--verify`, heap 256): NBIoT 1.0 s, peak RSS 111.8 MiB, heapUsed 14.8 MiB, EWKB 138.6 MiB; WCDMA 1.5 s, peak RSS 166.5 MiB, heapUsed 30.0 MiB, EWKB 136.7 MiB; both 0 ambiguous/unassigned/disagree.

### Areas (net = shells - holes, orientation-based, Kahan, first vertex subtracted; tolerance: float error << 0.01 m2)

| File | Records | Shells / holes | Local net area (m2) | Tracker "raw" (m2) | Diff vs tracker | Loaded table (m2) | Diff vs table |
|---|---|---|---|---|---|---|---|
| NR | 2,581 | 2,581 / 245,167 | 20,860,298,118.47 | ...118.81 | -0.34 | ...118.46 | +0.01 |
| LTE | 3,973 | 3,973 / 439,999 | 141,796,882,034.81 | ...035.56 | -0.75 | ...034.78 | +0.03 |
| NBIoT | 5,413 | 5,413 / 196,050 | 138,110,828,107.77 | ...107.52 | +0.25 | ...107.77 | 0.00 |
| WCDMA | 7,114 | 7,114 / 397,162 | 127,855,476,901.03 | ...901.52 | -0.49 | ...900.96 | +0.07 |

Hole counts and giant point/ring counts match the tracker exactly. My numbers agree with the loaded tables to 0.00-0.07 m2, i.e. closer than the tracker's own raw figures (which differ from mine by 0.25-0.75 m2, probably its float summation). Both are < 1 m2.

Five largest records by area (record: net m2): NR 2581: 1,792,129,123.37 (giant), 2580: 846,448,775.35, 2579: 509,490,449.46, 2578: 486,244,650.03, 2577: 406,521,049.34. LTE 3973: 139,433,676,538.03 (giant), 3972: 97,938,700.24, 3971: 20,278,100.23, 3970: 19,593,599.78, 3969: 17,607,099.54. NBIoT 5413: 132,122,318,851.50, 5224: 1,868,939,618.37, 4209: 348,186,489.12, 4308: 324,535,123.42, 201: 57,103,112.76. WCDMA 7114: 121,288,604,399.07, 7113: 1,743,744,601.76, 7112: 177,345,899.62, 7111: 86,095,800.36, 7110: 83,411,100.53. Full tables in the CSVs.

## EWKB layout verification

`s1-selftest.mjs` writes a synthetic shapefile (shell, hole, 2nd shell, a hole whose first-edge midpoint lies exactly on the shell boundary, an island shell, a null record, a 2nd record) and runs a/b/c. An independent decoder (separate code, DataView-free Buffer reads) checks: byte order 01, type `3|0x20000000` / `6|0x20000000`, SRID 32721, sub-geometries of the MultiPolygon carry NO SRID flag, ring counts, area 193 and 25 as expected, boundary probe falls to the next round and is assigned, null record emits nothing, (c) probe is an EWKB Point at (10,7). All PASS. NOT verified against a real PostGIS (`ST_GeomFromEWKB`): no DB in S1. Ring closure and >= 4 points (PostGIS parser checks) hold on all four files (counted: 0 violations).

## Hole assignment (a): algorithm, cost, risk

Pass 1: per-ring bbox, signed area, first 4 vertices (probes), parts offsets (about 200 B/ring). Pass 2 (assignment): for each round (probe = midpoint of ring edge 0, then 1, then 2) build a uniform grid of the pending holes' probes; for each shell (area < 0) collect probes inside its bbox, sort by y, then stream the shell's points ONCE in 1 MiB slices and, per edge, binary-search the probes whose y lies in the edge's y-range (winding number; exact on-boundary hits are flagged). Innermost shell = smallest |area| among strictly-containing shells. Holes with a boundary hit or no container get the next probe edge; after 3 rounds leftovers are counted ambiguous (best container kept) or unassigned (dropped). `--verify` re-tests every hole with a different probe edge and counts disagreements.
Worst-case cost: each shell is read at most once per round, O(V log P + hits); this is NOT quadratic. Memory: O(rings). Measured (LTE): 879,998 PIP tests, 3.6 M edges swept, 474k grid-cell visits, 0 ambiguous, 0 unassigned, 0 verify disagreements (439,999 holes). Cost with real multi-shell data (many shells with large bboxes) is unmeasured; risk: midpoint probes of holes that share an edge with the shell boundary can land a ulp inside/outside (only the multi-probe retry guards this; exact boundary hits only).

## Recommendation

Primary: (a), shells + holes assembled in Node, one MultiPolygon per record (each shell = Polygon with its holes). On these files it costs a few seconds, ~200 MiB peak RSS, and output EWKB (279.5 MiB for LTE) matches the source size; staging then receives geometrically correct, already-structured input, so ST_Subdivide/ST_MakeValid behave as in the proven GeoKettle swap. Per-record `COPY ... FORMAT binary` (or hex via text) of ~262 MB geometries still has to be checked in S2 (server memory/parse time for one 262 MB value).

(b) single Polygon: on these four files it is geometrically the same as (a), because every record has exactly one shell and ring 0 IS that shell (checked for all 19,081 records with a one-off script). It is the cheapest (0.5 s, 61 MiB RSS, no metadata, 279.5 MiB). But a Polygon takes ring 0 as the shell and every other ring as a hole, so it is wrong for any future file with several shells (later shells would be subtracted), and it hands PostGIS a generic-purpose invalid-prone input. Keep as a fast path only if the loader first asserts "exactly 1 shell, ring 0 clockwise" per record (known from pass 1) and otherwise falls back to (a). Behaviour of ST_Subdivide/ST_MakeValid on it is an S2 question (it is the same geometry as (a) here, so expect no difference).

(c) ring rows: viable fallback if you want SQL to do the assignment (more data: 630 MiB text for LTE, 443,972 rows, 281 MiB RSS). Producer implemented (`--strategy c`): columns `rec, ring, is_hole, npts, area, minx, miny, maxx, maxy, probe(EWKB Point hex), geom(single-ring Polygon EWKB hex)`, tab separated, `\N` for NULL. S2 SQL sketch:

```sql
CREATE UNLOGGED TABLE rings (rec int, ring int, is_hole bool, npts int, area float8,
  minx float8, miny float8, maxx float8, maxy float8,
  probe geometry(Point,32721), geom geometry(Polygon,32721));
-- \copy rings FROM <file> (text format; geometry accepts hex EWKB)
CREATE INDEX ON rings USING gist (geom) WHERE NOT is_hole;
CREATE TEMP TABLE hole_shell AS
SELECT DISTINCT ON (h.rec, h.ring) h.rec, h.ring AS hring, s.ring AS sring
FROM rings h JOIN rings s ON s.rec = h.rec AND NOT s.is_hole AND s.geom && h.probe
  AND ST_Intersects(s.geom, h.probe)       -- ST_Contains drops probes exactly on a boundary
WHERE h.is_hole AND h.area > 0
ORDER BY h.rec, h.ring, abs(s.area);       -- innermost shell
SELECT s.rec, ST_Multi(ST_MakePolygon(ST_ExteriorRing(s.geom),
         (SELECT array_agg(ST_ExteriorRing(h.geom) ORDER BY h.ring) FROM hole_shell x JOIN rings h USING (rec) WHERE ...)))
FROM rings s WHERE NOT s.is_hole;           -- then ST_Collect per rec -> raw geometry for the swap
```
Unproven for S2: PIP cost against 1.5 M-vertex shells with 100k+ probes (needs PostGIS' per-argument cache to hit; may be slow), and ExteriorRing copies.

## Not verified / caveats

- No PostGIS: EWKB accepted by `ST_GeomFromEWKB`, size limits for a 262 MB value, and (b)'s behaviour under ST_MakeValid are all S2 questions.
- Real data has one shell per record, so multi-shell assignment and island-in-hole nesting were only tested on the synthetic case (selftest). Strategy (a) silently drops holes it cannot place (counts 0 here) and drops degenerate (zero-area / <4 pts) holes (counts 0 here).
- Timings are with a hot OS file cache; a cold LTE read is slower. Peak RSS 181-281 MiB comes mostly from the ring-metadata typed arrays and the 1 MiB buffers, not the V8 heap.
- Only first-edge-midpoint probes were used; hole-edges lying exactly on shell edges are only guarded by exact-boundary detection plus retries.
- `--verify` found 1 hole in NBIoT whose second probe could not be used for comparison (boundary or unassigned in the verify round): 196,049/196,050 compared.
- Windows RSS peak measured with `process.memoryUsage()` sampling (100 ms plus every 32 reads) and `process.resourceUsage().maxRSS`.
