# ISSUE_029: GisEncodingNormalizer Portuguese/Luso Character Tolerance and Unicode Generalization

## 1. Problem Statement

During a live synchronization run of `db-db-sync` on table `nombre_via` for the border department of Rivera (Uruguay–Brazil border region), attribute comparison incorrectly flagged Portuguese surnames and place names with valid encoding artifacts as real discrepancies:
```text
DB Value:   "EPAMINONDAS MENDONÇA"
File Value: "EPAMINONDAS MENDONA" (corrupted DBCS replacement character \uFFFD)
Result:     Diferencia de Atributos (false positive)
```
Even with `ignoreEncodingArtifacts: true` enabled, the comparison engine rejected the match because the corrupted glyph `\uFFFD` failed to resolve against the Portuguese cedilla character `Ç`. Similarly, Portuguese tilde characters such as `Ã` in `"CACHOEIRA DO SUL ÃGUA BRANCA"` were rejected.

---

## 2. Root Cause Analysis & Technical Details

### Hardcoded Character Classes
In `src/core/common/GisEncodingNormalizer.ts`, the heuristic helper `resolveGlitchWildcard` aligns corrupted byte sequences against clean reference text by generating a dynamic regular expression wildcard. However, the letter and case detection routines and the generated wildcard sets were hardcoded strictly to standard Spanish Latin-accented letters:
```ts
// Legacy Spanish-only hardcoded character sets
const hasUpper = /[A-ZÁÉÍÓÚÑÜ]/.test(corruptedString);
const hasLower = /[a-záéíóúñü]/.test(corruptedString);
...
return `[A-ZÁÉÍÓÚÑÜ]{${minLetters},${maxLetters}}`;
```
Because Portuguese characters (Ç, Ã, Õ, Â, Ê, Ô, etc.) were omitted from these regular expression classes, `hasUpper` and `hasLower` failed to detect them, and the generated wildcard regexes could not match clean strings containing Luso characters.

### Word-Initial Title Case Heuristic Defect
Additionally, when a corrupted character occurred at the start of a word (such as `"Água"` corrupted to `"gua"` where `prevLetter === ""`), `resolveGlitchWildcard` attempted to infer the case of the corrupted character solely from the succeeding letter:
```ts
// Flawed assumption: nextLetter === lower implies the initial letter is lowercase
if (prevLetter === "" && isNextLower) {
  return `[a-záéíóúñü]{${minLetters},${maxLetters}}`;
}
```
This assumption broke for Title Case words (standard capitalization for proper nouns and place names), where a capitalized first letter is immediately followed by lowercase characters. Consequently, `"Cachoeira do Sul Água Branca"` vs `"Cachoeira do Sul gua Branca"` generated a lowercase-only wildcard `\p{Ll}`, failing to match the uppercase `Á`.

---

## 3. Implemented Solution

### Unicode Property Escapes (`\p{...}` with `u` Flag)
In accordance with the module's architectural invariant of zero hardcoded language lookup tables, all hardcoded Spanish character classes were replaced with standard Unicode property escapes under the `u` regular expression flag:
* `\p{Lu}` for uppercase letters (including `Ç`, `Ã`, `Ó`, etc.).
* `\p{Ll}` for lowercase letters (including `ç`, `ã`, `ó`, etc.).
* `\p{L}` for any Unicode letter.

### Removal of Flawed Word-Initial Lookahead
The premature case-inference branches `(prevLetter === "" && isNextUpper)` and `(prevLetter === "" && isNextLower)` were eliminated. When a corrupted character occurs at a word boundary without an anchoring preceding letter, it falls through cleanly to the generic Unicode letter wildcard `\p{L}{min,max}`. Literal case strictness is preserved across the rest of the token and for intra-word corrupted characters with anchored preceding context (`isPrevUpper` / `isPrevLower`).

---

## 4. Code Examples & Diff Snippets

### `src/core/common/GisEncodingNormalizer.ts`
```diff
-    const hasUpper = /[A-ZÁÉÍÓÚÑÜ]/.test(corruptedString);
-    const hasLower = /[a-záéíóúñü]/.test(corruptedString);
+    const hasUpper = /\p{Lu}/u.test(corruptedString);
+    const hasLower = /\p{Ll}/u.test(corruptedString);

     if (hasUpper && !hasLower) {
-      return `[A-ZÁÉÍÓÚÑÜ]{${minLetters},${maxLetters}}`;
+      return `\\p{Lu}{${minLetters},${maxLetters}}`;
     }
     if (hasLower && !hasUpper) {
-      return `[a-záéíóúñü]{${minLetters},${maxLetters}}`;
+      return `\\p{Ll}{${minLetters},${maxLetters}}`;
     }
...
-    if (
-      (isPrevUpper && (isNextUpper || nextLetter === "")) ||
-      (prevLetter === "" && isNextUpper)
-    ) {
-      return `[A-ZÁÉÍÓÚÑÜ]{${minLetters},${maxLetters}}`;
-    }
+    if (isPrevUpper && (isNextUpper || nextLetter === "")) {
+      return `\\p{Lu}{${minLetters},${maxLetters}}`;
+    }

-    if (
-      (isPrevLower && (isNextLower || nextLetter === "")) ||
-      (prevLetter === "" && isNextLower)
-    ) {
-      return `[a-záéíóúñü]{${minLetters},${maxLetters}}`;
-    }
+    if (isPrevLower && (isNextLower || nextLetter === "")) {
+      return `\\p{Ll}{${minLetters},${maxLetters}}`;
+    }

-    return `[A-Za-zÁÉÍÓÚáéíóúÑñÜü]{${minLetters},${maxLetters}}`;
+    return `\\p{L}{${minLetters},${maxLetters}}`;
```

---

## 5. Verification & Testing

Dedicated unit tests were added to `tests/unit/utils/common/GisEncodingNormalizer.test.ts`:
1. Tolerance of corrupted Luso surname letter (`Ç`): `"EPAMINONDAS MENDONÇA"` vs `"EPAMINONDAS MENDONA"` -> `true`.
2. Rejection of corrupted Luso surname when `ignoreEncodingArtifacts: false` -> `false`.
3. Strict case-sensitivity verification with `Ç`: uppercase DB vs lowercase corrupted -> `false`.
4. Tolerance of non-Ç Luso letter (`Ã`): `"CACHOEIRA DO SUL ÃGUA BRANCA"` vs `"CACHOEIRA DO SUL GUA BRANCA"` -> `true`.
5. Tolerance of word-initial Title Case capital letters: `"Cachoeira do Sul Água Branca"` vs `"Cachoeira do Sul gua Branca"` -> `true`.

### Automated Suite Results
* **Vitest Unit Suite**: 29 files, 318 passed (100% green, 5 new tests).
* **React Doctor**: 100/100 Great, 0 issues.
* **ESLint 9**: 0 errors, 0 warnings.
* **Next.js Turbopack Build**: Clean production build.
