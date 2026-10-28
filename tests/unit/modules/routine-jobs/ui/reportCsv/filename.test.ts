import { describe, expect, it } from "vitest";
import { reportCsvFilename } from "@/modules/routine-jobs/ui/reportCsv/filename";

describe("reportCsvFilename", () => {
  describe("mode segment", () => {
    it("should name a dry run file with the simulacion segment", () => {
      const generatedAt = new Date(2026, 9, 28, 14, 5, 9);

      expect(reportCsvFilename("cargar-padrones", true, generatedAt)).toBe(
        "carto-cargar-padrones-simulacion-20261028-140509.csv",
      );
    });

    it("should name a real run file with the real segment", () => {
      const generatedAt = new Date(2026, 9, 28, 14, 5, 9);

      expect(reportCsvFilename("cargar-padrones", false, generatedAt)).toBe(
        "carto-cargar-padrones-real-20261028-140509.csv",
      );
    });
  });

  describe("timestamp segment", () => {
    it("should zero pad single digit month, day, hour, minute and second", () => {
      const generatedAt = new Date(2026, 0, 5, 7, 8, 9);

      expect(reportCsvFilename("actualizar-padron", false, generatedAt)).toBe(
        "carto-actualizar-padron-real-20260105-070809.csv",
      );
    });

    it("should render midnight as 000000", () => {
      const generatedAt = new Date(2026, 11, 31, 0, 0, 0);

      expect(reportCsvFilename("cargar-localidades", true, generatedAt)).toBe(
        "carto-cargar-localidades-simulacion-20261231-000000.csv",
      );
    });

    it("should render the last second of the day as 235959", () => {
      const generatedAt = new Date(2026, 6, 15, 23, 59, 59);

      expect(reportCsvFilename("unidad-territorial", false, generatedAt)).toBe(
        "carto-unidad-territorial-real-20260715-235959.csv",
      );
    });
  });

  describe("slug and extension", () => {
    it("should pass the stage slug through unchanged", () => {
      const generatedAt = new Date(2026, 9, 28, 9, 30, 0);

      expect(reportCsvFilename("actualizar-padron", true, generatedAt)).toBe(
        "carto-actualizar-padron-simulacion-20261028-093000.csv",
      );
    });

    it("should always end with the csv extension and start with the carto prefix", () => {
      const filename = reportCsvFilename("cargar-padrones", false, new Date(2026, 1, 1, 1, 1, 1));

      expect(filename.startsWith("carto-")).toBe(true);
      expect(filename.endsWith(".csv")).toBe(true);
    });
  });
});
