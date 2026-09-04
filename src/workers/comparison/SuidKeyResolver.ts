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

  private resolveRecordValue(record: Record<string, unknown>, columnName: string): unknown {
    if (record[columnName] !== undefined) {
      return record[columnName];
    }
    const lowerCol = columnName.toLowerCase();
    for (const [key, value] of Object.entries(record)) {
      if (key.toLowerCase() === lowerCol) {
        return value;
      }
    }
    return undefined;
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
    let hasAtLeastOneValidPart = false;

    for (let index = 0; index < suidColumns.length; index++) {
      const columnName = suidColumns[index];
      const rawValue = this.resolveRecordValue(record, columnName);
      const cleaned = this.cleanKeyString(rawValue);
      if (cleaned !== "") {
        hasAtLeastOneValidPart = true;
      }
      parts.push(cleaned);
    }

    if (!hasAtLeastOneValidPart) {
      return "";
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
      const rawValue = this.resolveRecordValue(record, columnName);
      const cleaned = this.cleanRawValue(rawValue);
      if (cleaned !== "") {
        parts.push(cleaned);
      }
    }
    return parts.join(" | ");
  }
}
