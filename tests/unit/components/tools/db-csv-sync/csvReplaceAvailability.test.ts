import { describe, expect, it } from "vitest";
import { getCsvReplaceUnavailableReason } from "@/components/tools/db-csv-sync/csvReplaceAvailability";

describe("csvReplaceAvailability", () => {
  describe("CR-1: getCsvReplaceUnavailableReason", () => {
    it("should return null when the original CSV file is available", () => {
      const file = new File(["id\n1"], "datos.csv");

      expect(getCsvReplaceUnavailableReason(file)).toBeNull();
    });

    it("should return a Spanish reason asking to reload the CSV when the file is missing", () => {
      expect(getCsvReplaceUnavailableReason(null)).toBe(
        "El reemplazo completo necesita el archivo CSV original. Vuelva a cargarlo en el paso anterior."
      );
    });

    it("should treat an empty file object as available because only its absence blocks the mode", () => {
      expect(getCsvReplaceUnavailableReason(new File([], "vacio.csv"))).toBeNull();
    });
  });
});
