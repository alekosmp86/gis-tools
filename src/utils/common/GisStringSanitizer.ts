/**
 * GisStringSanitizer
 * Object-Oriented service for cleaning, normalizing, and standardizing GIS attributes and SUID identifiers.
 */
export class GisStringSanitizer {
  /**
   * Normalizes attribute string values according to GIS domain rules:
   * - Strips surrounding single or double quotes (e.g. '"TA014I111T9"' -> 'TA014I111T9').
   * - Strips non-breaking spaces (\xa0), tabs, and newlines.
   * - Strips floating point '.0' suffixes (e.g. '1002.0' -> '1002').
   */
  public cleanValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    let cleanString = String(value).trim();
    cleanString = cleanString.replace(/^["']|["']$/g, "").trim();
    cleanString = cleanString.replace(/[\r\n\t\xa0]/g, "");
    if (cleanString.endsWith(".0")) {
      cleanString = cleanString.slice(0, -2);
    }
    return cleanString;
  }

  /**
   * Normalizes SUID key strings (lowercased for key lookups).
   */
  public cleanSuid(value: unknown): string {
    return this.cleanValue(value).toLowerCase();
  }

  public static cleanValue(value: unknown): string {
    const sanitizer = new GisStringSanitizer();
    return sanitizer.cleanValue(value);
  }

  public static cleanSuid(value: unknown): string {
    const sanitizer = new GisStringSanitizer();
    return sanitizer.cleanSuid(value);
  }
}

/** Convenience exports */
export const cleanValue = GisStringSanitizer.cleanValue;
export const cleanSuid = GisStringSanitizer.cleanSuid;
