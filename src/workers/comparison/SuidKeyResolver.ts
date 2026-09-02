import { cleanValue, cleanSuid } from "@/utils/common/GisStringSanitizer";

/**
 * SuidKeyResolver
 * Object-Oriented Domain Service for resolving single and composite SUID keys across records.
 */
export class SuidKeyResolver {
  public cleanRawValue(value: unknown): string {
    return cleanValue(value);
  }

  public cleanKeyString(value: unknown): string {
    return cleanSuid(value);
  }

  /**
   * Builds a normalized composite SUID key from a row record and column list.
   */
  public buildCompositeKey(
    record: Record<string, unknown>,
    suidColumns: string[]
  ): string {
    if (!suidColumns || suidColumns.length === 0) {
      return "";
    }
    const parts: string[] = [];
    for (let index = 0; index < suidColumns.length; index++) {
      const columnName = suidColumns[index];
      const rawValue = record[columnName];
      const cleaned = this.cleanKeyString(rawValue);
      if (cleaned === "") {
        return "";
      }
      parts.push(cleaned);
    }
    return parts.join("|");
  }

  /**
   * Builds the raw human-readable composite SUID representation for UI display.
   */
  public buildCompositeRawSuid(
    record: Record<string, unknown>,
    suidColumns: string[]
  ): string {
    if (!suidColumns || suidColumns.length === 0) {
      return "";
    }
    const parts: string[] = [];
    for (let index = 0; index < suidColumns.length; index++) {
      const columnName = suidColumns[index];
      const rawValue = record[columnName];
      const cleaned = this.cleanRawValue(rawValue);
      if (cleaned !== "") {
        parts.push(cleaned);
      }
    }
    return parts.join(" | ");
  }
}
