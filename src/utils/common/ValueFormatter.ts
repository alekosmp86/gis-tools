/**
 * ValueFormatter
 * Object-Oriented service for formatting counts, quantities, currency, and byte sizes for UI display.
 */
export class ValueFormatter {
  public static readonly DEFAULT_LOCALE = "es-UY";

  private readonly locale: string;

  constructor(locale: string = ValueFormatter.DEFAULT_LOCALE) {
    this.locale = locale;
  }

  /**
   * Formats an integer or general count with standard thousands separators (e.g. 12500 -> "12.500").
   */
  public formatNumber(
    value: number | string | null | undefined,
    fallback: string = "0"
  ): string {
    if (value === null || value === undefined || value === "") return fallback;
    const parsedNumber = typeof value === "number" ? value : Number(value);
    if (isNaN(parsedNumber)) return fallback;
    return parsedNumber.toLocaleString(this.locale);
  }

  /**
   * Formats byte size into human-readable units (e.g. 1048576 -> "1,00 MB").
   */
  public formatFileSize(
    bytes: number | null | undefined,
    fallback: string = "0 B"
  ): string {
    if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) {
      return fallback;
    }
    if (bytes === 0) {
      return "0 B";
    }

    const kiloUnit = 1024;
    const sizeUnits = ["B", "KB", "MB", "GB", "TB"];
    const unitIndex = Math.floor(Math.log(bytes) / Math.log(kiloUnit));
    const formattedValue = bytes / Math.pow(kiloUnit, unitIndex);

    return `${formattedValue.toLocaleString(this.locale, {
      minimumFractionDigits: unitIndex > 0 ? 2 : 0,
      maximumFractionDigits: 2,
    })} ${sizeUnits[unitIndex]}`;
  }

  public static formatNumber(
    value: number | string | null | undefined,
    fallback: string = "0"
  ): string {
    const formatter = new ValueFormatter();
    return formatter.formatNumber(value, fallback);
  }

  public static formatFileSize(
    bytes: number | null | undefined,
    fallback: string = "0 B"
  ): string {
    const formatter = new ValueFormatter();
    return formatter.formatFileSize(bytes, fallback);
  }
}

/** Convenience exports */
export const formatNumber = ValueFormatter.formatNumber;
export const formatFileSize = ValueFormatter.formatFileSize;
