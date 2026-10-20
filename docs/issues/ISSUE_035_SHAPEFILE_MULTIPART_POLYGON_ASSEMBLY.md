# ISSUE 035: Shapefile Multipart Polygon Assembly

## 1. Problem Statement
A shapefile polygon record with several parts was read as one polygon whose first ring was the shell and every other ring a hole. For records with several separate outer rings this produced invalid geometry ("Hole lies outside shell" in PostGIS), which reached the generated `ST_GeomFromGeoJSON(...)` UPDATE/INSERT SQL, the comparison engine, the map preview and the diff/distance code.

## 2. Root Cause Analysis & Technical Details
`BinaryShpReader.readGeometry` returned `MultiPolygon` with `coordinates: [rings]` for `numParts > 1`, ignoring ring orientation. The ESRI spec marks outer rings clockwise and holes counter-clockwise, and a record may contain many of each.

## 3. Implemented Solution
- New pure module `src/core/spatial/PolygonRingAssembler.ts` (`assemblePolygons`): classifies rings by shoelace signed area on raw coordinates (negative = outer, positive = hole), assigns each hole to the smallest containing outer ring (bounding-box prefilter, then ray casting that skips boundary vertices, run against a lazily built per-outer-ring Y-bucket edge index instead of every edge), keeps orphan holes and zero-area rings as polygons of their own, and preserves file order.
- `readGeometry` reads raw rings, assembles, then applies `transformCoordinate`, so axis-swapping projections cannot invert orientation. `numParts === 1` still returns `Polygon`; `numParts > 1` returns `MultiPolygon` with the assembled list (possibly a single polygon); `numParts === 0` returns `null`.
- Y-bucket index: built the first time a hole needs a containment test against an outer ring (about sqrt(vertexCount) buckets, clamped to 8..4096). Each edge is registered in every bucket its Y-range spans, so a point query reads one bucket and runs the same on-segment and ray-crossing logic as a full scan, with identical results. Rings with non-finite coordinates fall back to the full scan. This keeps hole assignment close to linear in shell size (a full scan cost holes x shell vertices).

### Known limitations
- Orientation follows the ESRI convention (outer = clockwise). A multi-part record whose outer rings are counter-clockwise has no outer rings, so each ring becomes its own polygon (documented, not handled).
- A polygon record with `numParts === 0` has no geometry and returns `null`.
- Hole assignment uses a per-outer-ring Y-bucket index, built lazily.
- Index memory is registrations = edges x spanned buckets (up to 4096 buckets). Real boundaries have short edges (1-2 buckets). A pathological sawtooth/comb shell whose edges all span the full height exhausts memory (measured by the reviewer: 400k vertices ~1.5 GB, 1.5M vertices out of memory at an 8 GB heap), where a linear scan handles one hole in milliseconds. Not guarded. Follow-up: fall back to the linear scan when the estimated registrations exceed roughly 8-16 x the edge count.
- A shell whose Y extent overflows to Infinity (finite vertices near +-1e308) registers no edges in the index, so its holes become orphans (the linear scan would attach them). Practically unreachable. Follow-up: treat a non-finite height as non-indexable.

## 4. Code Examples & Diff Snippets
```ts
return {
  type: "MultiPolygon",
  coordinates: assemblePolygons(rings).map((polygon) => polygon.map(transformRing)),
};
```

## 5. Verification
Tests added by a separate test-writing pass: `tests/unit/core/spatial/PolygonRingAssembler.test.ts` (20 cases), `tests/unit/core/binary/BinaryShpReader.test.ts` (20 executed cases) and the in-memory `.shp` builder `tests/unit/core/binary/support/shpBuilder.ts`.

Gauntlet (portable Node 24, run from the worktree root):
- `npm run modules:routes:check`: PASS (25 route files up to date).
- `npm run lint`: PASS (no output, exit 0).
- `npm test`: PASS, Test Files 201 passed | 1 skipped (202); Tests 3724 passed | 1 skipped (3725). Baseline was 3684 passed, so +40 new tests. One earlier full run failed with a 10 s `beforeAll` hook timeout in `tests/unit/modules/coverage-loads/goldenParity.test.ts`; that file passes alone (13/13) and the full suite passed on the re-run, so it was load-related flakiness unrelated to this change.
- `npm run build`: PASS (first attempt failed a TypeScript narrowing error in `shpBuilder.ts`; fixed, re-run clean).
- `npm run doctor`: PASS (score 100/100, no issues).
- `npm run fallow`: PASS (no issues).
- `.claude/baseline.json`: not modified; coverage was not measured in this pass.

### Hardening pass (index equivalence, performance, limitations)
Added tests: `PolygonRingAssembler.test.ts` now has 29 cases (performance guard of 1000 holes in a 200k-vertex shell under 2000 ms, equivalence of 300 holes against an independent O(n) reference using a seeded PRNG, index boundary rows, zero-height and NaN shells, all-counter-clockwise limitation); `BinaryShpReader.test.ts` now has 22 cases (full-coordinate swapped-axes assertion, zero-part record returns `null`, all-counter-clockwise limitation through the reader).

Gauntlet (portable Node 24, worktree root):
- `npm run modules:routes:check`: PASS (25 route files up to date).
- `npm run lint`: PASS (exit 0, no output).
- `npm test`: PASS on the first run, Test Files 201 passed | 1 skipped (202); Tests 3735 passed | 1 skipped (3736). No hook timeouts.
- `npm run build`: PASS.
- `npm run doctor`: PASS (score 100).
- `npm run fallow`: PASS ("No issues found").
