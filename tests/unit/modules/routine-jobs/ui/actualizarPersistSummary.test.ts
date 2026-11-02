import { describe, expect, it } from "vitest";
import { persistSummaryOf } from "@/modules/routine-jobs/ui/actualizarPersistSummary";

describe("actualizarPersistSummary", () => {
  describe("persistSummaryOf", () => {
    it("should use the singular nouns when every count is one", () => {
      const summary = persistSummaryOf({ inserted: 1, pairsApplied: 1, updated: 1 });

      expect(summary).toBe("Se aplicarán: 1 padrón nuevo, 1 par actualizado, 1 geometría actualizada.");
    });

    it("should use the plural nouns when every count is above one", () => {
      const summary = persistSummaryOf({ inserted: 2, pairsApplied: 3, updated: 4 });

      expect(summary).toBe("Se aplicarán: 2 padrones nuevos, 3 pares actualizados, 4 geometrías actualizadas.");
    });

    it("should use the plural nouns when a count is zero", () => {
      const summary = persistSummaryOf({ inserted: 0, pairsApplied: 1, updated: 0 });

      expect(summary).toBe("Se aplicarán: 0 padrones nuevos, 1 par actualizado, 0 geometrías actualizadas.");
    });

    it("should pick the singular or plural noun per count independently", () => {
      const summary = persistSummaryOf({ inserted: 1, pairsApplied: 0, updated: 5 });

      expect(summary).toBe("Se aplicarán: 1 padrón nuevo, 0 pares actualizados, 5 geometrías actualizadas.");
    });
  });
});
