import { describe, expect, it } from "vitest";
import { parseContentDispositionFileName } from "@/modules/coverage-loads/shared/domain/contentDisposition";

describe("parseContentDispositionFileName (AC-21)", () => {
  it.each([
    ['attachment; filename="reporte_cobertura_lte_localidad__20261009.csv"', "reporte_cobertura_lte_localidad__20261009.csv"],
    ["attachment; filename=reporte.csv", "reporte.csv"],
    ['attachment; filename="con espacio.csv"', "con espacio.csv"],
    ['attachment; FILENAME="mayusculas.csv"', "mayusculas.csv"],
    ['attachment; filename="uno.csv"; size=3', "uno.csv"],
    ["attachment;filename=sin_espacio.csv", "sin_espacio.csv"],
  ])("should read the file name from %j", (header, expected) => {
    // Arrange, Act & Assert
    expect(parseContentDispositionFileName(header)).toBe(expected);
  });

  it("should return null when there is no header", () => {
    // Arrange, Act & Assert
    expect(parseContentDispositionFileName(null)).toBeNull();
  });

  it.each(["attachment", "inline", ""])("should return null when the header %j gives no file name", (header) => {
    // Arrange, Act & Assert
    expect(parseContentDispositionFileName(header)).toBeNull();
  });
});
