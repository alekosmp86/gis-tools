import { describe, expect, it } from "vitest";
import { DedupScope, Fuente } from "@/modules/address-dedup/constants";
import { DedupOrchestrator } from "@/modules/address-dedup/services/DedupOrchestrator";
import type { AddressRepository } from "@/modules/address-dedup/services/AddressRepository";
import { toQueryValues } from "@/modules/address-dedup/services/queries/duplicateAnalysisQuery";
import type { DbConnection } from "@/modules/address-dedup/types";
import { FakeRemovalRepository, FINGERPRINT, OPERATION_ID, PLAN, RESULT } from "./fakeRemovalRepository";

const CONNECTION: DbConnection = { host: "db.example", port: 5432, db_name: "carto", user: "op", password: "s3cret" };

const NO_ANALYSIS: AddressRepository = {
  async runDuplicateAnalysis() {
    throw new Error("removal must not call the read repository");
  },
};

describe("DedupOrchestrator removal", () => {
  it("should simulate with the same eight parameters an analysis uses", async () => {
    // Arrange
    const removal = new FakeRemovalRepository();
    const orchestrator = new DedupOrchestrator(NO_ANALYSIS, removal);

    // Act
    const plan = await orchestrator.simulateRemoval({ connection: CONNECTION, provinceId: 7 });

    // Assert
    expect(plan).toBe(PLAN);
    expect(removal.simulated[0].connection).toEqual(CONNECTION);
    expect(toQueryValues(removal.simulated[0].parameters)).toEqual([
      [Fuente.ANTEL, Fuente.TLK, Fuente.IDE],
      7,
      [Fuente.ANTEL, Fuente.TLK],
      [Fuente.IDE],
      2,
      3,
      false,
      DedupScope.REMOVAL_GROUPS,
    ]);
  });

  it("should honour the protected-sibling toggle in the removal parameters", async () => {
    // Arrange
    const removal = new FakeRemovalRepository();
    const orchestrator = new DedupOrchestrator(NO_ANALYSIS, removal);

    // Act
    await orchestrator.simulateRemoval({ connection: CONNECTION, provinceId: 3, protectedSiblingRemovesLone: true });

    // Assert
    expect(removal.simulated[0].parameters.protectedSiblingRemovesLone).toBe(true);
    expect(removal.simulated[0].parameters.provinceId).toBe(3);
  });

  it("should execute with the confirmation split from the connection and parameters", async () => {
    // Arrange
    const removal = new FakeRemovalRepository();
    const orchestrator = new DedupOrchestrator(NO_ANALYSIS, removal);

    // Act
    const result = await orchestrator.executeRemoval({
      connection: CONNECTION,
      provinceId: 7,
      operationId: OPERATION_ID,
      responsable: "operador",
      motivo: "baja",
      expectedFingerprint: FINGERPRINT,
    });

    // Assert
    expect(result).toEqual(RESULT);
    expect(removal.executed[0].confirmation).toEqual({
      operationId: OPERATION_ID,
      responsable: "operador",
      motivo: "baja",
      expectedFingerprint: FINGERPRINT,
    });
    expect(removal.executed[0].request.parameters.provinceId).toBe(7);
  });

  it("should let a repository failure reach the caller", async () => {
    // Arrange
    const orchestrator = new DedupOrchestrator(NO_ANALYSIS, new FakeRemovalRepository(PLAN, new Error("boom")));

    // Act & Assert
    await expect(orchestrator.simulateRemoval({ connection: CONNECTION, provinceId: 7 })).rejects.toThrow("boom");
  });
});
