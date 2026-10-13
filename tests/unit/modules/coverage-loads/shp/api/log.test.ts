import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { LOG_READ_CAP_BYTES } from "@/modules/coverage-loads/shp/constants";
import { createHarness, createTmpRoots, getRequest, makeJob, MISSING_JOB_ID, readJson } from "../helpers/apiTestEnv";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const numberedLines = (count: number) => Array.from({ length: count }, (_, index) => `linea ${index + 1}`).join("\n") + "\n";

async function logFor(options: { content?: string; table?: "lte" | "nbiot" } = {}) {
  const harness = createHarness(await roots.create());
  const { jobId } = await makeJob(harness.root, { table: options.table });
  if (options.content !== undefined) await writeFile(jobPaths(harness.root, jobId).log, options.content);
  return { harness, jobId };
}

describe("GET shp/log", () => {
  it("should serve the last 200 lines by default as a no-store text attachment", async () => {
    // Arrange
    const { harness, jobId } = await logFor({ content: numberedLines(300) });

    // Act
    const response = await harness.handlers.log(getRequest("log", { jobId }));
    const lines = (await response.text()).trimEnd().split("\n");

    // Assert
    expect(response.status).toBe(200);
    expect(lines).toHaveLength(200);
    expect(lines[0]).toBe("linea 101");
    expect(lines[199]).toBe("linea 300");
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("should name the attachment cargar_<table>_<first 8 of the id>.log", async () => {
    // Arrange
    const { harness, jobId } = await logFor({ content: "x\n", table: "nbiot" });

    // Act
    const response = await harness.handlers.log(getRequest("log", { jobId }));

    // Assert
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="cargar_nbiot_${jobId.slice(0, 8)}.log"`);
  });

  it("should honour an explicit tail", async () => {
    // Arrange
    const { harness, jobId } = await logFor({ content: numberedLines(50) });

    // Act
    const lines = (await (await harness.handlers.log(getRequest("log", { jobId, tail: "5" }))).text()).trimEnd().split("\n");

    // Assert
    expect(lines).toEqual(["linea 46", "linea 47", "linea 48", "linea 49", "linea 50"]);
  });

  it("should cap the tail at 5000 lines", async () => {
    // Arrange
    const { harness, jobId } = await logFor({ content: numberedLines(6000) });

    // Act
    const lines = (await (await harness.handlers.log(getRequest("log", { jobId, tail: "999999" }))).text()).trimEnd().split("\n");

    // Assert
    expect(lines).toHaveLength(5000);
    expect(lines[0]).toBe("linea 1001");
  });

  it("should accept exactly 5000 and clamp 0 up to one line", async () => {
    // Arrange
    const { harness, jobId } = await logFor({ content: numberedLines(6000) });

    // Act
    const exact = (await (await harness.handlers.log(getRequest("log", { jobId, tail: "5000" }))).text()).trimEnd().split("\n");
    const zero = (await (await harness.handlers.log(getRequest("log", { jobId, tail: "0" }))).text()).trimEnd().split("\n");

    // Assert
    expect(exact).toHaveLength(5000);
    expect(zero).toEqual(["linea 6000"]);
  });

  it.each(["abc", "-3", "1.5", "", "1e2", " 7"])("should fall back to the default tail for the bad value %j", async (tail) => {
    // Arrange
    const { harness, jobId } = await logFor({ content: numberedLines(300) });

    // Act
    const lines = (await (await harness.handlers.log(getRequest("log", { jobId, tail }))).text()).trimEnd().split("\n");

    // Assert
    expect(lines).toHaveLength(200);
  });

  it("should answer a short log in full without a truncation notice", async () => {
    // Arrange
    const { harness, jobId } = await logFor({ content: "uno\ndos\n" });

    // Act
    const text = await (await harness.handlers.log(getRequest("log", { jobId }))).text();

    // Assert
    expect(text).toBe("uno\ndos\n");
  });

  it("should read only the last 4 MiB of a huge log and say it was truncated", async () => {
    // Arrange: 100 lines of 50 KiB = about 5 MiB, with a marker only in the first line
    const lineBody = "x".repeat(50 * 1024);
    const content = Array.from({ length: 100 }, (_, index) => (index === 0 ? `PRIMERA-LINEA ${lineBody}` : `${index} ${lineBody}`)).join("\n") + "\n";
    const { harness, jobId } = await logFor({ content });
    expect(Buffer.byteLength(content)).toBeGreaterThan(LOG_READ_CAP_BYTES);

    // Act
    const text = await (await harness.handlers.log(getRequest("log", { jobId, tail: "5000" }))).text();

    // Assert
    expect(text.startsWith("[... registro truncado: solo se muestra el final ...]\n")).toBe(true);
    expect(text).not.toContain("PRIMERA-LINEA");
    expect(text).toContain(`99 ${lineBody}`);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(LOG_READ_CAP_BYTES + 100);
  });

  it("should answer 404 in Spanish when the job has no log yet", async () => {
    // Arrange
    const { harness, jobId } = await logFor();

    // Act
    const response = await harness.handlers.log(getRequest("log", { jobId }));

    // Assert
    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ success: false, error: "La carga no tiene registro todavía." });
  });

  it("should answer 404 when the job does not exist", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.log(getRequest("log", { jobId: MISSING_JOB_ID }));

    // Assert
    expect(response.status).toBe(404);
  });

  it("should answer 400 for an invalid job id", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.log(getRequest("log", { jobId: "../x" }));

    // Assert
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe("Identificador de carga inválido.");
  });
});
