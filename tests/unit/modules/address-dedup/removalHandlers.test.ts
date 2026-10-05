import { describe, expect, it } from "vitest";
import { createDedupHandlers } from "@/modules/address-dedup/api/handlers";
import { RemovalRefusedError } from "@/modules/address-dedup/domain/removal";
import { MOTIVO_MAX_LENGTH, OPERATION_ID_PATTERN, RESPONSABLE_MAX_LENGTH } from "@/modules/address-dedup/removalConstants";
import { DedupOrchestrator } from "@/modules/address-dedup/services/DedupOrchestrator";
import type { AddressRepository } from "@/modules/address-dedup/services/AddressRepository";
import { FakeRemovalRepository, FINGERPRINT, OPERATION_ID, PLAN } from "./fakeRemovalRepository";

const PASSWORD = "hunter2-very-secret";
const BASE_URL = "http://localhost/api/m/address-dedup/removal";

const SIMULATE_BODY = {
  connection: { host: "db.example", port: "5432", db_name: "carto", user: "operator", password: PASSWORD },
  provinceId: 7,
};

const EXECUTE_BODY = {
  ...SIMULATE_BODY,
  operationId: OPERATION_ID,
  responsable: " operador ",
  motivo: "CGEO-2192",
  expectedFingerprint: FINGERPRINT,
};

const NO_ANALYSIS: AddressRepository = {
  async runDuplicateAnalysis() {
    throw new Error("the removal handlers must not run the read analysis");
  },
};

function handlersFor(removal: FakeRemovalRepository) {
  return createDedupHandlers(new DedupOrchestrator(NO_ANALYSIS, removal));
}

function post(path: string, body: unknown): Request {
  return new Request(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("removal handlers", () => {
  describe("simulateRemoval", () => {
    it("should answer the fingerprint, counts and blockers, and keep the snapshot server-side", async () => {
      // Arrange
      const removal = new FakeRemovalRepository();

      // Act
      const response = await handlersFor(removal).simulateRemoval(post("simulate", SIMULATE_BODY));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(payload).toEqual({
        success: true,
        fingerprint: PLAN.fingerprint,
        counts: PLAN.counts,
        blockers: [],
        targets: PLAN.targets,
      });
      expect(JSON.stringify(payload)).not.toContain("stays-server-side");
      expect(removal.simulated[0].connection.password).toBe(PASSWORD);
      expect(removal.simulated[0].parameters.provinceId).toBe(7);
    });

    it("should pass the protected-sibling toggle through to the parameters", async () => {
      // Arrange
      const removal = new FakeRemovalRepository();

      // Act
      await handlersFor(removal).simulateRemoval(
        post("simulate", { ...SIMULATE_BODY, protectedSiblingRemovesLone: true })
      );

      // Assert
      expect(removal.simulated[0].parameters.protectedSiblingRemovesLone).toBe(true);
    });

    it.each([
      ["a body that is not JSON", "not json"],
      ["a missing password", { ...SIMULATE_BODY, connection: { ...SIMULATE_BODY.connection, password: "" } }],
      ["an invalid province", { ...SIMULATE_BODY, provinceId: 0 }],
      ["a non-boolean toggle", { ...SIMULATE_BODY, protectedSiblingRemovesLone: "yes" }],
    ])("should answer 400 for %s and never reach the repository", async (_description, body) => {
      // Arrange
      const removal = new FakeRemovalRepository();

      // Act
      const response = await handlersFor(removal).simulateRemoval(post("simulate", body));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).success).toBe(false);
      expect(removal.simulated).toEqual([]);
    });

    it("should scrub the password from a failure and answer 500", async () => {
      // Arrange
      const removal = new FakeRemovalRepository(PLAN, new Error(`password authentication failed for ${PASSWORD}`));

      // Act
      const response = await handlersFor(removal).simulateRemoval(post("simulate", SIMULATE_BODY));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(500);
      expect(JSON.stringify(payload)).not.toContain(PASSWORD);
      expect(payload.error).toContain("***");
    });
  });

  describe("executeRemoval", () => {
    it("should hand the orchestrator only the connection, province, confirmation and fingerprint", async () => {
      // Arrange
      const removal = new FakeRemovalRepository();
      const body = {
        ...EXECUTE_BODY,
        urns: ["cgeo:TLK:wstlk:id:12"],
        addressIds: [1, 2],
        decision: "REMOVE",
        scope: "ALL_DUPLICATE_GROUPS",
      };

      // Act
      const response = await handlersFor(removal).executeRemoval(post("execute", body));

      // Assert
      expect(response.status).toBe(200);
      expect(removal.executed).toHaveLength(1);
      const { request, confirmation } = removal.executed[0];
      expect(Object.keys(request).sort()).toEqual(["connection", "parameters"]);
      expect(JSON.stringify(request)).not.toContain("cgeo:TLK:wstlk:id:12");
      expect(Object.keys(confirmation).sort()).toEqual([
        "expectedFingerprint",
        "motivo",
        "operationId",
        "responsable",
      ]);
      expect(confirmation).toEqual({
        operationId: OPERATION_ID,
        responsable: "operador",
        motivo: "CGEO-2192",
        expectedFingerprint: FINGERPRINT,
      });
    });

    it.each([
      ["responsable", "responsable", RESPONSABLE_MAX_LENGTH],
      ["motivo", "motivo", MOTIVO_MAX_LENGTH],
    ])("should accept a %s of exactly the maximum length and reject one character more", async (_label, field, max) => {
      // Arrange
      const atLimit = new FakeRemovalRepository();
      const overLimit = new FakeRemovalRepository();

      // Act
      const accepted = await handlersFor(atLimit).executeRemoval(post("execute", { ...EXECUTE_BODY, [field]: "x".repeat(max) }));
      const rejected = await handlersFor(overLimit).executeRemoval(
        post("execute", { ...EXECUTE_BODY, [field]: "x".repeat(max + 1) })
      );

      // Assert
      expect(accepted.status).toBe(200);
      expect(atLimit.executed).toHaveLength(1);
      expect(rejected.status).toBe(400);
      expect((await rejected.json()).error).toContain(String(max));
      expect(overLimit.executed).toEqual([]);
    });

    it.each([
      ["responsable", "responsable", RESPONSABLE_MAX_LENGTH],
      ["motivo", "motivo", MOTIVO_MAX_LENGTH],
    ])("should accept a %s of exactly the maximum length and reject one character more", async (_label, field, max) => {
      // Arrange
      const atLimit = new FakeRemovalRepository();
      const overLimit = new FakeRemovalRepository();

      // Act
      const accepted = await handlersFor(atLimit).executeRemoval(post("execute", { ...EXECUTE_BODY, [field]: "x".repeat(max) }));
      const rejected = await handlersFor(overLimit).executeRemoval(
        post("execute", { ...EXECUTE_BODY, [field]: "x".repeat(max + 1) })
      );

      // Assert
      expect(accepted.status).toBe(200);
      expect(atLimit.executed).toHaveLength(1);
      expect(rejected.status).toBe(400);
      expect((await rejected.json()).error).toContain(String(max));
      expect(overLimit.executed).toEqual([]);
    });

    it("should answer the removal result", async () => {
      // Arrange
      const removal = new FakeRemovalRepository();

      // Act
      const response = await handlersFor(removal).executeRemoval(post("execute", EXECUTE_BODY));
      const payload = await response.json();

      // Assert
      expect(payload.success).toBe(true);
      expect(payload.operationId).toBe(OPERATION_ID);
      expect(payload.state).toBe("BD_ELIMINADA_PENDIENTE_INDICES");
      expect(payload.recovered).toBe(false);
      expect(payload.pending).toContain("Solr");
    });

    it("should generate the operation id on the server when the client sends none", async () => {
      // Arrange
      const removal = new FakeRemovalRepository();
      const bodyWithoutId = { ...EXECUTE_BODY, operationId: undefined };

      // Act
      const response = await handlersFor(removal).executeRemoval(post("execute", bodyWithoutId));
      const payload = await response.json();

      // Assert
      expect(payload.operationId).toMatch(OPERATION_ID_PATTERN);
      expect(removal.executed[0].confirmation.operationId).toBe(payload.operationId);
    });

    it.each([
      ["a malformed operation id", { operationId: "abc" }],
      ["a blank responsable", { responsable: "  " }],
      ["a missing motivo", { motivo: undefined }],
      ["a missing fingerprint", { expectedFingerprint: undefined }],
      ["a malformed fingerprint", { expectedFingerprint: "not-md5" }],
    ])("should answer 400 for %s and never reach the repository", async (_description, overrides) => {
      // Arrange
      const removal = new FakeRemovalRepository();

      // Act
      const response = await handlersFor(removal).executeRemoval(post("execute", { ...EXECUTE_BODY, ...overrides }));

      // Assert
      expect(response.status).toBe(400);
      expect(removal.executed).toEqual([]);
    });

    it("should answer 409 when the removal refuses, so the caller knows nothing was written", async () => {
      // Arrange
      const removal = new FakeRemovalRepository(PLAN, new RemovalRefusedError("Cambió el alcance"));

      // Act
      const response = await handlersFor(removal).executeRemoval(post("execute", EXECUTE_BODY));

      // Assert
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("Cambió el alcance");
    });

    it("should scrub the password from an unexpected failure and answer 500", async () => {
      // Arrange
      const removal = new FakeRemovalRepository(PLAN, new Error(`connection to ${PASSWORD} lost`));

      // Act
      const response = await handlersFor(removal).executeRemoval(post("execute", EXECUTE_BODY));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(500);
      expect(JSON.stringify(payload)).not.toContain(PASSWORD);
    });
  });
});
