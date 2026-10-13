import { afterEach, describe, expect, it } from "vitest";
import {
  CANARY_PASSWORD,
  CONNECTION_BODY,
  createHarness,
  createTmpRoots,
  jsonPost,
  makeJob,
  MISSING_JOB_ID,
  readAllText,
  readJson,
} from "../helpers/apiTestEnv";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

describe("POST shp/plan", () => {
  it("should answer 200 with the plan of a READY job", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { table: "wcdma" });

    // Act
    const response = await harness.handlers.plan(jsonPost("plan", { jobId, connection: CONNECTION_BODY }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.plan).toMatchObject({ jobId, defaultMode: "LOAD", canStart: true, blockers: [], currentRows: 42 });
    expect(harness.repository.calls.map((call) => call.table)).toEqual(["wcdma"]);
  });

  it("should show blockers and canStart false when the database says the table is missing", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.repository.inspection = { ...harness.repository.inspection, tableExists: false };
    const { jobId } = await makeJob(harness.root);

    // Act
    const body = await readJson(await harness.handlers.plan(jsonPost("plan", { jobId, connection: CONNECTION_BODY })));

    // Assert
    expect(body.plan.canStart).toBe(false);
    expect(body.plan.blockers[0]).toContain("no existe");
  });

  it("should answer 404 for a job that does not exist", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.plan(jsonPost("plan", { jobId: MISSING_JOB_ID, connection: CONNECTION_BODY }));

    // Assert
    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ success: false, error: "No existe la carga indicada." });
    expect(harness.repository.calls).toEqual([]);
  });

  it.each(["UPLOADING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const)(
    "should answer 409 when the job is %s instead of READY",
    async (state) => {
      // Arrange
      const harness = createHarness(await roots.create());
      const { jobId } = await makeJob(harness.root, { state });

      // Act
      const response = await harness.handlers.plan(jsonPost("plan", { jobId, connection: CONNECTION_BODY }));

      // Assert
      expect(response.status).toBe(409);
      expect((await readJson(response)).error).toContain(state);
      expect(harness.repository.calls).toEqual([]);
    }
  );

  it.each([
    ["missing", undefined],
    ["not a uuid", "not-a-uuid"],
    ["a path traversal", "../../etc/passwd"],
    ["a number", 7],
  ])("should answer 400 when the jobId is %s", async (_label, jobId) => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.plan(jsonPost("plan", { jobId, connection: CONNECTION_BODY }));

    // Assert
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ success: false, error: "Identificador de carga inválido." });
  });

  it("should answer 400 when the body is not valid JSON", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.plan(jsonPost("plan", "{not json"));

    // Assert
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe("El cuerpo de la solicitud debe ser un JSON válido.");
  });

  it.each([
    ["no connection", undefined],
    ["no password", { ...CONNECTION_BODY, password: "" }],
    ["no user", { ...CONNECTION_BODY, user: "" }],
    ["no database", { ...CONNECTION_BODY, db_name: "" }],
  ])("should answer 400 in Spanish when the connection has %s", async (_label, connection) => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.plan(jsonPost("plan", { jobId, connection }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
    expect(harness.repository.calls).toEqual([]);
  });

  it("should scrub the password from a repository error", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.repository.failure = new Error(`password authentication failed for user "gisuser" using ${CANARY_PASSWORD}`);
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.plan(jsonPost("plan", { jobId, connection: CONNECTION_BODY }));
    const text = JSON.stringify(await readJson(response));

    // Assert
    expect(response.status).toBe(500);
    expect(text).not.toContain(CANARY_PASSWORD);
    expect(text).toContain("***");
  });

  it("should not write anything: the job folder is unchanged and the repository got only read calls", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    const before = await readAllText(harness.root);

    // Act
    await harness.handlers.plan(jsonPost("plan", { jobId, connection: CONNECTION_BODY }));

    // Assert
    expect(await readAllText(harness.root)).toBe(before);
    expect(harness.repository.calls).toHaveLength(1);
    expect(harness.spawn.calls).toEqual([]);
  });
});
