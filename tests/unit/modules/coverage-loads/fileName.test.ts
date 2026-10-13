import { describe, expect, it } from "vitest";
import { parseIndicatorsFileName } from "@/modules/coverage-loads/indicators/domain/fileName";

describe("parseIndicatorsFileName (AC-1)", () => {
  it("should return the fechaact as YYYY-MM-DD text when the name is valid", () => {
    // Arrange & Act
    const result = parseIndicatorsFileName("IndicadoresLTE_20260901.csv");

    // Assert
    expect(result).toEqual({ ok: true, fechaact: "2026-09-01" });
  });

  it.each([
    ["month 13", "IndicadoresLTE_20261301.csv"],
    ["month 00", "IndicadoresLTE_20260001.csv"],
    ["day 00", "IndicadoresLTE_20260900.csv"],
    ["day 32", "IndicadoresLTE_20260132.csv"],
    ["31 April", "IndicadoresLTE_20260431.csv"],
    ["31 September", "IndicadoresLTE_20260931.csv"],
  ])("should reject the name when the date has %s", (_label, fileName) => {
    // Arrange & Act
    const result = parseIndicatorsFileName(fileName);

    // Assert
    expect(result.ok).toBe(false);
  });

  it.each([
    ["9 digits", "IndicadoresLTE_202609011.csv"],
    ["7 digits", "IndicadoresLTE_2026091.csv"],
    ["only the year", "IndicadoresLTE_2026.csv"],
    ["no digits", "IndicadoresLTE_.csv"],
    ["letters instead of digits", "IndicadoresLTE_2026ab01.csv"],
    ["a lower-case prefix", "indicadoresLTE_20260901.csv"],
    ["a different prefix", "Indicadores_20260901.csv"],
    ["a space before the date", "IndicadoresLTE_ 20260901.csv"],
    ["an upper-case extension", "IndicadoresLTE_20260901.CSV"],
    ["a mixed-case extension", "IndicadoresLTE_20260901.Csv"],
    ["a trailing extension", "IndicadoresLTE_20260901.csv.bak"],
    ["a leading path", "dir/IndicadoresLTE_20260901.csv"],
    ["an empty name", ""],
  ])("should reject the name when it has %s", (_label, fileName) => {
    // Arrange & Act
    const result = parseIndicatorsFileName(fileName);

    // Assert
    expect(result.ok).toBe(false);
  });

  it("should name the offending file in a Spanish message when the name is rejected", () => {
    // Arrange & Act
    const result = parseIndicatorsFileName("IndicadoresLTE_2026.csv");

    // Assert
    expect(result).toEqual({
      ok: false,
      message:
        'El archivo "IndicadoresLTE_2026.csv" no tiene un nombre válido: debe ser IndicadoresLTE_aaaammdd.csv con una fecha real.',
    });
  });

  describe("leap years", () => {
    it.each([
      ["a leap year", "IndicadoresLTE_20240229.csv", "2024-02-29"],
      ["a century divisible by 400", "IndicadoresLTE_20000229.csv", "2000-02-29"],
    ])("should accept 29 February in %s", (_label, fileName, fechaact) => {
      // Arrange & Act
      const result = parseIndicatorsFileName(fileName);

      // Assert
      expect(result).toEqual({ ok: true, fechaact });
    });

    it.each([
      ["a common year", "IndicadoresLTE_20230229.csv"],
      ["a century not divisible by 400", "IndicadoresLTE_19000229.csv"],
    ])("should reject 29 February in %s", (_label, fileName) => {
      // Arrange & Act
      const result = parseIndicatorsFileName(fileName);

      // Assert
      expect(result.ok).toBe(false);
    });

    it("should accept 28 February and 31 December at the calendar edges", () => {
      // Arrange & Act & Assert
      expect(parseIndicatorsFileName("IndicadoresLTE_20230228.csv")).toEqual({ ok: true, fechaact: "2023-02-28" });
      expect(parseIndicatorsFileName("IndicadoresLTE_20261231.csv")).toEqual({ ok: true, fechaact: "2026-12-31" });
      expect(parseIndicatorsFileName("IndicadoresLTE_20260101.csv")).toEqual({ ok: true, fechaact: "2026-01-01" });
    });
  });
});
