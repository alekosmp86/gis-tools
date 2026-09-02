# Issue #003: Composite SUID Partial Null Misclassification

## Problem Statement
When synchronizing datasets with composite identifier keys (e.g. `['CODDEPTO', 'CODLOCCAT', 'PADRON', 'NUMCARCAT']`), records containing at least one valid identifying attribute (e.g. `CODDEPTO: 'A'`, `CODLOCCAT: 'SA'`, `PADRON: 2670`) and an empty/null sub-component (e.g. `NUMCARCAT: null`) were incorrectly flagged as **"SUIDS NULOS / VACÍOS"**.

This caused tens of thousands of valid cadastral parcels (e.g. 39,119 parcels) to be excluded from database matching and misclassified as unidentifiable orphan records.

---

## Root Cause Analysis & Technical Details

1. **Strict All-Or-Nothing Non-Null Validation in `SuidKeyResolver.ts`**:
   - `buildCompositeKey()` was iterating over the composite column list:
     ```typescript
     if (cleaned === "") {
       return ""; // ❌ Aborted entire key if any single column was empty
     }
     ```
   - If any individual attribute (such as a subpadron or carpet number `NUMCARCAT`) was null or blank, the resolver returned an empty string `""`.
2. **Eager Invalidation in Binary DBF Indexer (`FileDatasetIndexer.ts`)**:
   - In `indexBinaryDbf()`, encountering `cleanedKey === ""` set `isRecordValid = false` and pushed the feature into `nullRecordIndices`.
3. **Domain Cadastral Reality**:
   - In cadastral and spatial GIS datasets, composite identifiers often contain optional sub-identifiers (e.g., standard parcels without subdivision have `NUMCARCAT = null`).
   - A record is only truly **null/vacant** if **all** composite fields are empty or unassigned.
   - When one field is null, the normalized composite key should be formed by keeping the empty slot (e.g. `"CANELONES|TOLEDO|2670|"` or `"A|SA|2670|"`), which accurately matches the corresponding database record where `NUMCARCAT IS NULL`.

---

## Implemented Solution

1. **Partial Non-Null Composite Key Resolution (`SuidKeyResolver.ts`)**:
   - Updated `buildCompositeKey()` to accept composite keys where **at least one** column contains a valid value (`hasAtLeastOneValidPart`).
   - Empty/null fields are preserved as empty strings in the composite key structure (`parts.join("|")`).
   - The key is only rejected as empty (`""`) if **all** composite attributes are blank.
2. **Updated Binary DBF Indexer (`FileDatasetIndexer.ts`)**:
   - Replaced `isRecordValid = false` break loops with `hasAtLeastOneValidPart` tracking.
   - Preserves empty string placeholders for null descriptors so composite position alignment is maintained across DB and File indexing.
3. **Database WHERE Clause Alignment (`SqlScriptBuilder.ts`)**:
   - Handles null composite values in SQL UPDATE/WHERE queries with `"${columnName}" IS NULL`.

---

## Code Examples & Diff Snippets

### Before:
```typescript
// ❌ Discarded entire composite key if any single sub-column was null
for (let index = 0; index < suidColumns.length; index++) {
  const columnName = suidColumns[index];
  const cleaned = this.cleanKeyString(record[columnName]);
  if (cleaned === "") {
    return ""; // Rejected valid parcels with null subpadron!
  }
  parts.push(cleaned);
}
return parts.join("|");
```

### After:
```typescript
// ✅ Valid composite key as long as at least one component is present
let hasAtLeastOneValidPart = false;
for (let index = 0; index < suidColumns.length; index++) {
  const columnName = suidColumns[index];
  const cleaned = this.cleanKeyString(record[columnName]);
  if (cleaned !== "") {
    hasAtLeastOneValidPart = true;
  }
  parts.push(cleaned);
}

if (!hasAtLeastOneValidPart) {
  return ""; // Only rejected if ALL composite columns are empty
}

return parts.join("|");
```

---

## Verification & Testing

- **TypeScript Compilation**: `npx tsc --noEmit` passed with 0 errors.
- **ESLint**: `npm run lint` passed with 0 errors.
- **Cadastral Composite Key Resolution**: Records with `CODDEPTO: 'A'`, `CODLOCCAT: 'SA'`, `PADRON: 2670`, `NUMCARCAT: null` correctly resolve to key `"A|SA|2670|"`, match the corresponding database records, and are no longer sent to the "SUIDS NULOS" card.
