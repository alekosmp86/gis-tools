/**
 * GisEncodingNormalizer.ts
 *
 * Domain service for detecting, repairing, and tolerating GIS export encoding glitches
 * and mojibake algorithmically WITHOUT hardcoded string lookup tables.
 *
 * Covers:
 * 1. Algorithmic UTF-8 unmojibake (reversing UTF-8 bytes decoded under Windows-1252 / ISO-8859-1).
 * 2. Generic detection of foreign encoding glyphs (Hangul syllables, CJK ideographs, replacement chars, control bytes).
 * 3. Dynamic context-aware alignment preserving strict case and punctuation sensitivity.
 */

export interface AttributeEquivalenceOptions {
  readonly ignoreEncodingArtifacts?: boolean;
}

export class GisEncodingNormalizer {
  /**
   * Character class matching characters that NEVER legitimately appear in Spanish/Uruguayan GIS text.
   * Includes:
   * - Hangul Syllables and Jamo (\uAC00-\uD7AF, \u1100-\u11FF, \u3130-\u318F)
   * - CJK Unified Ideographs and Extensions (\u4E00-\u9FFF, \u3400-\u4DBF, \uF900-\uFAFF)
   * - Japanese Kana (\u3040-\u30FF)
   * - Fullwidth and Halfwidth forms (\uFF00-\uFFEF)
   * - Unicode Replacement Character (\uFFFD)
   * - Private Use Areas (\uE000-\uF8FF)
   * - ASCII control characters (\x00-\x08, \x0B-\x0C, \x0E-\x1F, \x7F-\x9F)
   */
  private static readonly CORRUPTED_GLYPH_REGEX: RegExp =
    /[\uFFFD\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uFF00-\uFFEF\uE000-\uF8FF\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

  private static readonly CORRUPTED_GLYPH_GLOBAL_REGEX: RegExp =
    /[\uFFFD\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uFF00-\uFFEF\uE000-\uF8FF\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]+/g;

  /**
   * Fast Windows-1252 reverse lookup table for non-Latin1 Unicode code points (0x80 - 0x9F range).
   */
  private static readonly WIN1252_LOOKUP: Readonly<Record<number, number>> = {
    0x20ac: 0x80, // €
    0x201a: 0x82, // ‚
    0x0192: 0x83, // ƒ
    0x201e: 0x84, // „
    0x2026: 0x85, // …
    0x2020: 0x86, // †
    0x2021: 0x87, // ‡
    0x02c6: 0x88, // ˆ
    0x2030: 0x89, // ‰
    0x0160: 0x8a, // Š
    0x2039: 0x8b, // ‹
    0x0152: 0x8c, // Œ
    0x017d: 0x8e, // Ž
    0x2018: 0x91, // ‘
    0x2019: 0x92, // ’
    0x201c: 0x93, // “
    0x201d: 0x94, // ”
    0x2022: 0x95, // •
    0x2013: 0x96, // –
    0x2014: 0x97, // —
    0x02dc: 0x98, // ˜
    0x2122: 0x99, // ™
    0x0161: 0x9a, // š
    0x203a: 0x9b, // ›
    0x0153: 0x9c, // œ
    0x017e: 0x9e, // ž
    0x0178: 0x9f, // Ÿ
  };

  /**
   * Detects whether a string contains foreign encoding artifacts or corrupted glyphs.
   */
  public static hasCorruptedGlyphs(value: string): boolean {
    if (!value || typeof value !== "string") {
      return false;
    }
    return GisEncodingNormalizer.CORRUPTED_GLYPH_REGEX.test(value);
  }

  /**
   * Algorithmic unmojibake: Reverses UTF-8 byte sequences incorrectly decoded as Windows-1252 / ISO-8859-1.
   * Generically handles all accented letters (Ã‘ -> Ñ, Ã± -> ñ, Ã¡ -> á, etc.) with ZERO hardcoded pairs.
   */
  public static algorithmicUnmojibake(value: string): string {
    if (!value || typeof value !== "string") {
      return value;
    }

    // Quick filter: only evaluate if UTF-8 multi-byte lead characters (Ã, Â, etc.) are present
    if (!/[ÃÂ]/.test(value)) {
      return value;
    }

    try {
      const byteList: number[] = [];
      for (let charIndex = 0; charIndex < value.length; charIndex++) {
        const codePoint = value.charCodeAt(charIndex);
        if (codePoint < 256) {
          byteList.push(codePoint);
        } else {
          const mappedByte = GisEncodingNormalizer.WIN1252_LOOKUP[codePoint];
          if (mappedByte !== undefined) {
            byteList.push(mappedByte);
          } else {
            // Contains a non-Latin1 character that cannot be part of single-byte mojibake
            return value;
          }
        }
      }

      const decodedString = new TextDecoder("utf-8", { fatal: true }).decode(
        new Uint8Array(byteList)
      );
      return decodedString;
    } catch {
      // If decoding fails, it was not valid UTF-8 mojibake, return unchanged
      return value;
    }
  }

  /**
   * Repairs known encoding artifacts in a single string where possible.
   */
  public static repairEncoding(value: string): string {
    return GisEncodingNormalizer.algorithmicUnmojibake(value);
  }

  /**
   * Resolves the regex wildcard pattern for a corrupted span, strictly enforcing case sensitivity.
   */
  private static resolveGlitchWildcard(
    corruptedString: string,
    matchIndex: number,
    matchLength: number
  ): string {
    const minLetters = matchLength;
    const maxLetters = matchLength * 2;

    const hasUpper = /\p{Lu}/u.test(corruptedString);
    const hasLower = /\p{Ll}/u.test(corruptedString);

    // If the entire corrupted string has only one case, enforce that exact case
    if (hasUpper && !hasLower) {
      return `\\p{Lu}{${minLetters},${maxLetters}}`;
    }
    if (hasLower && !hasUpper) {
      return `\\p{Ll}{${minLetters},${maxLetters}}`;
    }

    // In mixed-case strings, inspect the immediate token context
    let prevLetter = "";
    for (let index = matchIndex - 1; index >= 0; index--) {
      const char = corruptedString[index];
      if (/\p{L}/u.test(char)) {
        prevLetter = char;
        break;
      }
      if (/\s|[.,;:\-_]/.test(char)) {
        break;
      }
    }

    let nextLetter = "";
    for (
      let index = matchIndex + matchLength;
      index < corruptedString.length;
      index++
    ) {
      const char = corruptedString[index];
      if (/\p{L}/u.test(char)) {
        nextLetter = char;
        break;
      }
      if (/\s|[.,;:\-_]/.test(char)) {
        break;
      }
    }

    const isPrevUpper = prevLetter !== "" && /\p{Lu}/u.test(prevLetter);
    const isPrevLower = prevLetter !== "" && /\p{Ll}/u.test(prevLetter);
    const isNextUpper = nextLetter !== "" && /\p{Lu}/u.test(nextLetter);
    const isNextLower = nextLetter !== "" && /\p{Ll}/u.test(nextLetter);

    // Uppercase token context
    if (isPrevUpper && (isNextUpper || nextLetter === "")) {
      return `\\p{Lu}{${minLetters},${maxLetters}}`;
    }

    // Lowercase token context
    if (isPrevLower && (isNextLower || nextLetter === "")) {
      return `\\p{Ll}{${minLetters},${maxLetters}}`;
    }

    return `\\p{L}{${minLetters},${maxLetters}}`;
  }

  /**
   * Matches a corrupted string against a clean Spanish reference string by turning
   * corrupted glyphs into strictly-bounded Spanish letter wildcards.
   */
  private static matchesCorruptedAgainstClean(
    corruptedString: string,
    cleanString: string
  ): boolean {
    if (!GisEncodingNormalizer.hasCorruptedGlyphs(corruptedString)) {
      return false;
    }
    if (GisEncodingNormalizer.hasCorruptedGlyphs(cleanString)) {
      return false;
    }

    // Length difference cannot exceed reasonable multi-byte artifact expansion
    if (Math.abs(corruptedString.length - cleanString.length) > 5) {
      return false;
    }

    let patternString = "^";
    let lastIndex = 0;
    const regexMatcher = new RegExp(
      GisEncodingNormalizer.CORRUPTED_GLYPH_GLOBAL_REGEX
    );
    let matchResult: RegExpExecArray | null;

    while (
      (matchResult = regexMatcher.exec(corruptedString)) !== null
    ) {
      const matchIndex = matchResult.index;
      const matchText = matchResult[0];
      const precedingSlice = corruptedString.slice(lastIndex, matchIndex);

      patternString += precedingSlice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      patternString += GisEncodingNormalizer.resolveGlitchWildcard(
        corruptedString,
        matchIndex,
        matchText.length
      );
      lastIndex = matchIndex + matchText.length;
    }

    patternString +=
      corruptedString
        .slice(lastIndex)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";

    try {
      const dynamicRegex = new RegExp(patternString, "u");
      return dynamicRegex.test(cleanString);
    } catch {
      return false;
    }
  }

  /**
   * Evaluates if two attribute values are equivalent.
   * Strictly preserves case sensitivity and punctuation sensitivity.
   */
  public static areAttributesEquivalent(
    databaseValue: unknown,
    fileValue: unknown,
    options?: AttributeEquivalenceOptions
  ): boolean {
    // Exact match fast path
    if (databaseValue === fileValue) {
      return true;
    }

    if (
      databaseValue === null ||
      databaseValue === undefined ||
      fileValue === null ||
      fileValue === undefined
    ) {
      return false;
    }

    const stringDb = String(databaseValue).trim();
    const stringFile = String(fileValue).trim();

    if (stringDb === stringFile) {
      return true;
    }

    // If encoding artifact tolerance is explicitly disabled, enforce strict difference
    if (options?.ignoreEncodingArtifacts === false) {
      return false;
    }

    // 1. Algorithmic unmojibake (generic reversal of UTF-8 misdecoded as Latin1/Win1252)
    const unmojibakeDb = GisEncodingNormalizer.algorithmicUnmojibake(stringDb);
    const unmojibakeFile =
      GisEncodingNormalizer.algorithmicUnmojibake(stringFile);

    if (unmojibakeDb === unmojibakeFile) {
      return true;
    }

    // 2. Dynamic corrupted glyph alignment (Hangul DBCS, CJK, \uFFFD, etc.)
    if (
      GisEncodingNormalizer.matchesCorruptedAgainstClean(
        unmojibakeFile,
        unmojibakeDb
      ) ||
      GisEncodingNormalizer.matchesCorruptedAgainstClean(
        unmojibakeDb,
        unmojibakeFile
      )
    ) {
      return true;
    }

    return false;
  }
}
