import { describe, expect, it } from "vitest";
import {
  assertConfirmation,
  assertDeletedMatchesPlan,
  assertExecutable,
  assertTargetsInScope,
  buildBlockers,
  RemovalRefusedError,
  type MasterReference,
  type TargetVerdict,
} from "@/modules/address-dedup/domain/removal";
import { RemovalBlockReason } from "@/modules/address-dedup/removalConstants";
import { COUNTS, FINGERPRINT, OPERATION_ID, PLAN } from "./fakeRemovalRepository";

const CONFIRMATION = {
  operationId: OPERATION_ID,
  responsable: "operador",
  motivo: "baja",
  expectedFingerprint: FINGERPRINT,
};

function verdict(overrides: Partial<TargetVerdict> = {}): TargetVerdict {
  return { urn: "urn:1", masterIds: ["10"], reasonCodes: [], ...overrides };
}

describe("removal domain", () => {
  describe("assertConfirmation", () => {
    it("should accept a complete confirmation", () => {
      // Arrange & Act & Assert
      expect(() => assertConfirmation(CONFIRMATION)).not.toThrow();
    });

    it.each([
      ["operationId", { operationId: "nope" }],
      ["responsable", { responsable: " " }],
      ["motivo", { motivo: "" }],
      ["expectedFingerprint", { expectedFingerprint: "ABC" }],
    ])("should refuse an invalid %s", (_field, overrides) => {
      // Arrange
      const confirmation = { ...CONFIRMATION, ...overrides };

      // Act & Assert
      expect(() => assertConfirmation(confirmation)).toThrow(RemovalRefusedError);
    });
  });

  describe("assertExecutable", () => {
    it("should pass a plan with targets, no blockers and the confirmed fingerprint", () => {
      // Arrange & Act & Assert
      expect(() => assertExecutable(PLAN, FINGERPRINT)).not.toThrow();
    });

    it("should refuse a plan that has blockers, whatever the fingerprint", () => {
      // Arrange
      const blocked = {
        ...PLAN,
        blockers: [{ urn: "u", reasons: [{ code: RemovalBlockReason.MASTER_SHARED, detail: null }] }],
      };

      // Act & Assert
      expect(() => assertExecutable(blocked, FINGERPRINT)).toThrow(/no pueden eliminarse/);
    });

    it("should refuse a plan with no targets", () => {
      // Arrange
      const empty = { ...PLAN, counts: { ...COUNTS, total: 0 } };

      // Act & Assert
      expect(() => assertExecutable(empty, FINGERPRINT)).toThrow("No hay direcciones para eliminar.");
    });

    it("should refuse a fingerprint that differs from the recomputed one", () => {
      // Arrange & Act & Assert
      expect(() => assertExecutable(PLAN, "f".repeat(32))).toThrow(/Simular y confirmar nuevamente/);
    });
  });

  describe("assertTargetsInScope", () => {
    it("should accept zero out-of-scope targets", () => {
      expect(() => assertTargetsInScope(0)).not.toThrow();
    });

    it("should throw when any target lacks a REMOVE reason", () => {
      expect(() => assertTargetsInScope(1)).toThrow(RemovalRefusedError);
    });
  });

  describe("assertDeletedMatchesPlan", () => {
    it("should accept equal counts and refuse any difference", () => {
      // Arrange & Act & Assert
      expect(() => assertDeletedMatchesPlan("address", 2, 2)).not.toThrow();
      expect(() => assertDeletedMatchesPlan("address", 3, 2)).toThrow(/eliminó 3 filas/);
      expect(() => assertDeletedMatchesPlan("address", 1, 2)).toThrow(RemovalRefusedError);
    });
  });

  describe("buildBlockers", () => {
    it("should return no blockers for clean verdicts and no references", () => {
      expect(buildBlockers([verdict()], [])).toEqual([]);
    });

    it("should keep the reasons of a blocked verdict and skip the clean ones", () => {
      // Arrange
      const verdicts = [
        verdict({ urn: "urn:1" }),
        verdict({ urn: "urn:2", reasonCodes: [RemovalBlockReason.NOT_A_DOOR] }),
      ];

      // Act
      const blockers = buildBlockers(verdicts, []);

      // Assert
      expect(blockers).toEqual([{ urn: "urn:2", reasons: [{ code: RemovalBlockReason.NOT_A_DOOR, detail: null }] }]);
    });

    it("should add one MASTER_REFERENCED reason per referencing table, matched on the master id", () => {
      // Arrange
      const references: MasterReference[] = [
        { masterId: "10", tableLabel: "carto.notes (id_address_master)" },
        { masterId: "10", tableLabel: "carto.notes (id_address_master)" },
        { masterId: "99", tableLabel: "carto.other (address_master_id)" },
      ];

      // Act
      const blockers = buildBlockers([verdict()], references);

      // Assert
      expect(blockers).toEqual([
        {
          urn: "urn:1",
          reasons: [{ code: RemovalBlockReason.MASTER_REFERENCED, detail: "carto.notes (id_address_master)" }],
        },
      ]);
    });
  });
});
