# ISSUE 033: Non-Unique Key Row Pairing

## 1. Problem Statement
When a SUID key appeared more than once on either side (D > 1 or F > 1), every row of that key was reported as `DUPLICATE_SUID`, so attribute and geometry changes on those rows were never shown. Extra file rows inside a key that exists in the DB were never reported at all (pass 2 only sees keys absent from the DB).

## 2. Root Cause Analysis & Technical Details
`MatchedRecordsComparator.compareMatchedRecords` set `isDuplicate = D > 1 || F > 1` and classified every row `DUPLICATE_SUID` before evaluating attributes/geometry. File rows were paired positionally by `dbIndex` in `FeatureAttributeExtractor`, and pass 2 (`UnmatchedFileFeaturesCollector`) skips keys already present in the DB.

## 3. Implemented Solution
- `KeyGroupPairing.ts` (pure): per collision group, collapse identical twins per side (signature = SUID + compared fields + geometry rounded to `COMPARISON_DECIMALS`), pair identical representatives, then pair the rest greedily by geometry distance (`GeometryDistance.ts`; ties by attribute differences, dbIndex, fileIndex), then pair a single leftover per side by elimination. Groups above `MAX_PAIRING_CANDIDATES` (40,000) skip geometry pairing (`pairingCappedGroups`).
- `MatchedRecordsComparator.ts`: 1:1 keys unchanged; collision groups processed by `processCollisionGroup`, producing paired mismatches (with `pairing`), `ONLY_IN_DB`, file-only rows (`ONLY_IN_SHP`, merged into the insert items), DB twins and unpairable rows as `DUPLICATE_SUID`.
- `PassCounts` split (`onlyInFileCount`, `duplicateSuidFileCount`, `duplicateFileRowsSkipped`); `SpatialComparisonEngine` totals reconcile.
- `SqlPatchGenerator.isUnkeyedPairedItem`: no UPDATE for a paired row without a primary key value (the composite-SUID `WHERE` would hit the whole group); counted in `unkeyedUpdatesSkippedCount` and warned in the UI.
- `GeometryDifferenceEvaluator` exposes `resolveDbGeometry` / `resolveFileGeometry`; `FeatureAttributeExtractor` accepts explicit file row overrides; `ContentSignature` accepts a geometry fingerprint hook.
- UI: `DiscrepancySuidCell` shows how a row was paired; `DiscrepanciesSummaryBar` updates the duplicate card subtitle and shows warnings.
- The DB stream route always selects the geometry column (as GeoJSON) when one exists, regardless of `compareGeometry`, so DB geometry is available for pairing.

## 4. Code Examples & Diff Snippets
```ts
const result = pairKeyGroup(dbPairingRows, filePairingRows, {
  areEquivalent,
  maxCandidates: MAX_PAIRING_CANDIDATES,
});
```

## 4b. Pairing Rules & Known Limits
- Stage A (exact), two steps: (a) full signature (SUID + compared fields + rounded geometry), 1:1 lowest index first; (b) attribute-only signature (same without the geometry component, `PairingRow.attributeSignature`) on the leftovers, applied ONLY when at least one side's leftover rows have no usable geometry at all (CSV, DB-to-DB without a geometry column, DBF without SHP rows). If both sides have geometry, geometry pairing decides, so rows differing only by geometry are never merged. Both steps report `pairing.method = EXACT`.
- Twin collapse always uses the full signature (rows differing only by geometry stay distinct representatives).
- The `MAX_PAIRING_CANDIDATES` cap (40,000) applies to the product (DB geometry rows x file geometry rows) remaining after Stage A, not to the raw group size.
- `ONLY_IN_DB` rows from a key with D > 1 carry the note "Clave repetida en DB (n en DB / m en Archivo)"; counts and `duplicateDetails` semantics are unchanged.
- UPDATEs for paired rows without a primary key value are skipped (`unkeyedUpdatesSkippedCount`).
- INSERTs generated from collision groups (`ONLY_IN_SHP`) may repeat an existing key; a unique constraint on the key would reject them.

## 5. Verification & Testing
Unit tests now exist for pairing (`KeyGroupPairing`), distance (`GeometryDistance`), comparator groups (`MatchedRecordsComparator`), `SqlPatchGenerator`, `SpatialComparisonEngine`, and the UI cells. Gauntlet run: `modules:routes:check` OK (25 route files up to date); `lint` clean; `tsc --noEmit` exit 0; `build` OK; `doctor` 90/100 with 3 known await-in-loop warnings (coverage-loads); `fallow` 10 baseline findings (5 types, 4 class members, 1 dependency), none new; `vitest run tests/unit/workers tests/unit/components` 15 files / 237 tests passed. Not verified against a real database.
