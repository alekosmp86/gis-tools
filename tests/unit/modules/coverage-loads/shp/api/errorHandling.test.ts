import { afterEach, describe, expect, it } from "vitest";
import { HTTP_STATUS } from "@/modules/coverage-loads/shared/httpResponses";
import { createShpHandlers } from "@/modules/coverage-loads/shp/api/handlers";
import {
  CANARY_PASSWORD,
  CONNECTION_BODY,
  createHarness,
  createTmpRoots,
  FakeRepository,
  getRequest,
  jsonPost,
  makeJob,
  MISSING_JOB_ID,
  readJson,
  uploadRequest,
} from "../helpers/apiTestEnv";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

describe("shared HTTP status constants", () => {
  it("should keep the existing codes and add NOT_FOUND 404 and INSUFFICIENT_STORAGE 507", () => {
    // Arrange & Act & Assert
    expect(HTTP_STATUS).toEqual({
      OK: 200,
      BAD_REQUEST: 400,
      NOT_FOUND: 404,
      CONFLICT: 409,
      PAYLOAD_TOO_LARGE: 413,
      SERVER_ERROR: 500,
      INSUFFICIENT_STORAGE: 507,
      GATEWAY_TIMEOUT: 504,
    });
  });
});

describe("shp handlers error envelope", () => {
  async function badRequests() {
    const harness = createHarness(await roots.create());
    return [
      ["upload", await harness.handlers.upload(uploadRequest({ size: null }))],
      ["plan", await harness.handlers.plan(jsonPost("plan", "not json"))],
      ["start", await harness.handlers.start(jsonPost("start", "not json"))],
      ["status", await harness.handlers.status(getRequest("status"))],
      ["cancel", await harness.handlers.cancel(jsonPost("cancel", {}))],
      ["log", await harness.handlers.log(getRequest("log"))],
      ["discard", await harness.handlers.discard(jsonPost("discard", {}))],
    ] as const;
  }

  it("should answer every refusal as { success: false, error } with a Spanish message", async () => {
    // Arrange & Act
    const responses = await badRequests();

    // Assert
    for (const [name, response] of responses) {
      const body = await readJson(response);
      expect(response.status, name).toBe(400);
      expect(body.success, name).toBe(false);
      expect(typeof body.error, name).toBe("string");
      expect(body.error, name).toMatch(/[áéíóúñ]|El |La |Falta|Hay /);
    }
  });

  it("should answer every not-found as 404 in the same envelope", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const body = { jobId: MISSING_JOB_ID, connection: CONNECTION_BODY, mode: "LOAD", confirm: true };

    // Act
    const responses = await Promise.all([
      harness.handlers.plan(jsonPost("plan", body)),
      harness.handlers.start(jsonPost("start", body)),
      harness.handlers.status(getRequest("status", { jobId: MISSING_JOB_ID })),
      harness.handlers.cancel(jsonPost("cancel", body)),
      harness.handlers.log(getRequest("log", { jobId: MISSING_JOB_ID })),
      harness.handlers.discard(jsonPost("discard", body)),
    ]);

    // Assert
    for (const response of responses) {
      expect(response.status).toBe(404);
      const json = await readJson(response);
      expect(json.success).toBe(false);
      expect(typeof json.error).toBe("string");
    }
  });

  it("should scrub the connection password from an unexpected repository error in plan and start", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.repository.failure = new Error(`FATAL: password authentication failed (${CANARY_PASSWORD}) at ${CANARY_PASSWORD}`);
    const { jobId } = await makeJob(harness.root);
    const body = { jobId, connection: CONNECTION_BODY, mode: "LOAD", confirm: true };

    // Act
    const plan = await harness.handlers.plan(jsonPost("plan", body));
    const start = await harness.handlers.start(jsonPost("start", body));

    // Assert
    for (const response of [plan, start]) {
      expect(response.status).toBe(500);
      const text = JSON.stringify(await readJson(response));
      expect(text).not.toContain(CANARY_PASSWORD);
      expect(text).toContain("***");
    }
  });

  it("should map a Postgres lock timeout to 409 and a statement timeout to 504, in Spanish", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    const body = { jobId, connection: CONNECTION_BODY };

    // Act
    harness.repository.failure = Object.assign(new Error("lock not available"), { code: "55P03" });
    const locked = await harness.handlers.plan(jsonPost("plan", body));
    harness.repository.failure = Object.assign(new Error("canceling statement"), { code: "57014" });
    const timedOut = await harness.handlers.plan(jsonPost("plan", body));

    // Assert
    expect(locked.status).toBe(409);
    expect((await readJson(locked)).error).toBe("Otra carga está en curso, intente de nuevo en unos segundos.");
    expect(timedOut.status).toBe(504);
    expect((await readJson(timedOut)).error).toBe("La operación excedió el tiempo máximo.");
  });

  it("should answer 500 with the envelope when the root directory cannot be used at all", async () => {
    // Arrange: the "root" is a path under a regular file, so every filesystem call fails
    const root = await roots.create();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${root}/blocker`, "x");
    const handlers = createShpHandlers({ rootDir: `${root}/blocker/inner`, repository: new FakeRepository(), freeBytes: async () => Number.MAX_SAFE_INTEGER });

    // Act
    const response = await handlers.upload(uploadRequest({ size: 3, body: new Uint8Array([1, 2, 3]) }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
  });
});
