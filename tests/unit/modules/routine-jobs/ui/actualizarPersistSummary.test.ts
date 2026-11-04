import { describe, expect, it } from "vitest";
import { persistSummaryOf } from "@/modules/routine-jobs/ui/actualizarPersistSummary";

describe("actualizarPersistSummary", () => {
  describe("persistSummaryOf", () => {
    it("should use the singular nouns when every count is one", () => {
      const summary = persistSummaryOf({ inserted: 1, pairsApplied: 1, updated: 1, removed: 1 });

      expect(summary).toBe("Se aplicarán: 1 padrón nuevo, 1 par actualizado, 1 geometría actualizada, 1 padrón eliminado.");
    });

    it("should use the plural nouns when every count is above one", () => {
      const summary = persistSummaryOf({ inserted: 2, pairsApplied: 3, updated: 4, removed: 5 });

      expect(summary).toBe("Se aplicarán: 2 padrones nuevos, 3 pares actualizados, 4 geometrías actualizadas, 5 padrones eliminados.");
    });

    it("should use the plural nouns when a count is zero", () => {
      const summary = persistSummaryOf({ inserted: 0, pairsApplied: 1, updated: 0, removed: 0 });

      expect(summary).toBe("Se aplicarán: 0 padrones nuevos, 1 par actualizado, 0 geometrías actualizadas, 0 padrones eliminados.");
    });

    it("should pick the singular or plural noun per count independently", () => {
      const summary = persistSummaryOf({ inserted: 1, pairsApplied: 0, updated: 5, removed: 1 });

      expect(summary).toBe("Se aplicarán: 1 padrón nuevo, 0 pares actualizados, 5 geometrías actualizadas, 1 padrón eliminado.");
    });

    it("should always end with the removed count, reading 0 padrones eliminados when it is absent (an older result)", () => {
      const summary = persistSummaryOf({ inserted: 2, pairsApplied: 0, updated: 0 });

      expect(summary.endsWith(", 0 padrones eliminados.")).toBe(true);
    });

    it("should report a run that only deletes padrones with every other count at zero", () => {
      const summary = persistSummaryOf({ inserted: 0, pairsApplied: 0, updated: 0, removed: 7 });

      expect(summary).toBe("Se aplicarán: 0 padrones nuevos, 0 pares actualizados, 0 geometrías actualizadas, 7 padrones eliminados.");
    });

    it("should add the reassigned addresses before the final period when there are some", () => {
      const summary = persistSummaryOf({ inserted: 2, pairsApplied: 0, updated: 0, removed: 3, reassigned: 5 });

      expect(summary).toBe(
        "Se aplicarán: 2 padrones nuevos, 0 pares actualizados, 0 geometrías actualizadas, 3 padrones eliminados, 5 direcciones reasignadas."
      );
    });

    it("should use the singular noun for exactly one reassigned address", () => {
      const summary = persistSummaryOf({ inserted: 0, pairsApplied: 0, updated: 0, removed: 1, reassigned: 1 });

      expect(summary.endsWith("1 padrón eliminado, 1 dirección reasignada.")).toBe(true);
    });

    it("should leave the reassigned text out when the count is zero or absent (an older result)", () => {
      const zero = persistSummaryOf({ inserted: 1, pairsApplied: 1, updated: 1, removed: 1, reassigned: 0 });
      const absent = persistSummaryOf({ inserted: 1, pairsApplied: 1, updated: 1, removed: 1 });

      expect(zero).toBe(absent);
      expect(zero).not.toContain("reasignad");
    });
  });
});

describe("persistSummaryOf changed padrones (AP-124)", () => {
  it("should sum the subdivided and the changed-padron reassignments in one reassigned count", () => {
    const summary = persistSummaryOf({ inserted: 0, pairsApplied: 0, updated: 0, removed: 1, reassigned: 5, reassignedChanged: 3 });

    expect(summary.endsWith("1 padrón eliminado, 8 direcciones reasignadas.")).toBe(true);
  });

  it("should report the changed-padron count alone when nothing else is reassigned", () => {
    const summary = persistSummaryOf({ inserted: 0, pairsApplied: 0, updated: 0, removed: 0, reassignedChanged: 1 });

    expect(summary.endsWith("0 padrones eliminados, 1 dirección reasignada.")).toBe(true);
  });

  it("should leave the reassigned text out when both counts are zero or absent", () => {
    const summary = persistSummaryOf({ inserted: 1, pairsApplied: 1, updated: 1, removed: 1, reassigned: 0, reassignedChanged: 0 });

    expect(summary).not.toContain("reasignad");
  });
});
