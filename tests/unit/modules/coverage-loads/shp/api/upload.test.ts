import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireTableLock } from "@/modules/coverage-loads/shp/job/lock.ts";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import type { JobStatus } from "@/modules/coverage-loads/shp/job/types.ts";
import { BYTES_PER_MIB, DISK_HEADROOM_FACTOR, DISK_SAFETY_MARGIN_BYTES } from "@/modules/coverage-loads/shp/constants";
import {
  countingStream,
  createHarness,
  createTmpRoots,
  exists,
  listJobDirs,
  makeJob,
  readJson,
  readStatusFile,
  uploadRequest,
} from "../helpers/apiTestEnv";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const PAYLOAD = new Uint8Array(Array.from({ length: 2000 }, (_, index) => index % 251));

const pending = (sizeBytes: number, receivedBytes: number) => (status: JobStatus) => {
  status.source.sizeBytes = sizeBytes;
  status.source.receivedBytes = receivedBytes;
};

describe("POST shp/upload", () => {
  it("should store the exact bytes as source.shp and mark the job READY when the sizes match", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      sizeBytes: PAYLOAD.length,
      target: { table: "lte", prefix: "LTEUruguay", fechaact: "2026-01-31" },
    });
    const paths = jobPaths(harness.root, body.jobId);
    expect(new Uint8Array(await readFile(paths.source))).toEqual(PAYLOAD);
    expect(await exists(paths.upload)).toBe(false);
    const status = await readStatusFile(harness.root, body.jobId);
    expect(status.state).toBe("READY");
    expect(status.source).toEqual({ fileName: "LTEUruguay_20260131.shp", sizeBytes: PAYLOAD.length, receivedBytes: PAYLOAD.length });
    expect(status.stages[0]).toMatchObject({ id: "COPYING_FILE", state: "DONE" });
    expect(status.mode).toBe("LOAD");
  });

  it("should receive a real streamed body chunk by chunk", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { stream, state } = countingStream(8, 1024);

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: 8 * 1024, body: stream }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(200);
    expect(state.pulled).toBe(8);
    expect((await readFile(jobPaths(harness.root, body.jobId).source)).length).toBe(8 * 1024);
  });

  it("should refuse with 400 and leave no job folder when fewer bytes arrive than declared", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length + 500, body: PAYLOAD }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(400);
    expect(body).toEqual({ success: false, error: "El archivo recibido no tiene el tamaño declarado; la subida fue descartada." });
    expect(await listJobDirs(harness.root)).toEqual([]);
  });

  it("should abort early, not consuming the whole source, when more bytes arrive than declared", async () => {
    // Arrange: ~200 MB source that must never be fully consumed for a 1 MiB declaration
    const harness = createHarness(await roots.create());
    const chunkBytes = 64 * 1024;
    const totalChunks = 3200;
    const { stream, state } = countingStream(totalChunks, chunkBytes);

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: BYTES_PER_MIB, body: stream }));

    // Assert
    expect(response.status).toBe(400);
    expect(state.pulled).toBeLessThan(200);
    expect(await listJobDirs(harness.root)).toEqual([]);
  });

  it("should delete the job folder and leave no upload.part when the client aborts mid-stream", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const controller = new AbortController();
    const { stream } = countingStream(1000, 1024, { abortAfter: { chunks: 5, controller } });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: 1000 * 1024, body: stream, signal: controller.signal }));

    // Assert
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe("La subida fue interrumpida; se descartó el archivo parcial.");
    expect(await listJobDirs(harness.root)).toEqual([]);
    expect(await exists(path.join(harness.root, "jobs"))).toBe(true);
  });

  it("should not buffer the body: chunks are pulled incrementally while the file grows", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const observedPulls: number[] = [];
    const { stream } = countingStream(40, 4096, { onPull: (pulled) => observedPulls.push(pulled) });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: 40 * 4096, body: stream }));

    // Assert: every chunk was requested one after the other, never all at once
    expect(response.status).toBe(200);
    expect(observedPulls).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
  });

  it("should answer 507 in Spanish when the volume lacks the space the file needs", async () => {
    // Arrange
    const needed = 2000 * DISK_HEADROOM_FACTOR + DISK_SAFETY_MARGIN_BYTES;
    const harness = createHarness(await roots.create(), { freeBytes: async () => needed - 1 });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: 2000, body: PAYLOAD }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(507);
    expect(body.success).toBe(false);
    expect(body.error).toContain("No hay espacio suficiente en disco");
    expect(await listJobDirs(harness.root)).toEqual([]);
  });

  it("should accept the upload when free space equals the required amount exactly", async () => {
    // Arrange
    const needed = PAYLOAD.length * DISK_HEADROOM_FACTOR + DISK_SAFETY_MARGIN_BYTES;
    const harness = createHarness(await roots.create(), { freeBytes: async () => needed });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));

    // Assert
    expect(response.status).toBe(200);
  });

  it("should answer 507 when free space only covers the file but not the bytes other uploads still have to write", async () => {
    // Arrange
    const needed = PAYLOAD.length * DISK_HEADROOM_FACTOR + DISK_SAFETY_MARGIN_BYTES;
    const harness = createHarness(await roots.create(), { freeBytes: async () => needed + 999 });
    await makeJob(harness.root, { state: "UPLOADING", table: "nbiot", mutate: pending(5000, 4000) });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));

    // Assert
    expect(response.status).toBe(507);
    expect((await readJson(response)).error).toContain("No hay espacio suficiente en disco");
    expect(await listJobDirs(harness.root)).toHaveLength(1);
  });

  it("should accept the upload when free space equals the requirement plus the pending bytes of other uploads exactly", async () => {
    // Arrange
    const needed = PAYLOAD.length * DISK_HEADROOM_FACTOR + DISK_SAFETY_MARGIN_BYTES;
    const harness = createHarness(await roots.create(), { freeBytes: async () => needed + 1000 });
    await makeJob(harness.root, { state: "UPLOADING", table: "nbiot", mutate: pending(5000, 4000) });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));

    // Assert
    expect(response.status).toBe(200);
  });

  it("should add the pending bytes of every UPLOADING job and ignore READY and terminal ones", async () => {
    // Arrange
    const needed = PAYLOAD.length * DISK_HEADROOM_FACTOR + DISK_SAFETY_MARGIN_BYTES;
    const harness = createHarness(await roots.create(), { freeBytes: async () => needed + 1999 });
    await makeJob(harness.root, { state: "UPLOADING", table: "nbiot", mutate: pending(1000, 0) });
    await makeJob(harness.root, { state: "UPLOADING", table: "wcdma", mutate: pending(2000, 1000) });
    await makeJob(harness.root, { state: "READY", table: "cobertura5g", mutate: pending(9_000_000, 0) });
    await makeJob(harness.root, { state: "SUCCEEDED", table: "cobertura5g", mutate: pending(9_000_000, 0) });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));

    // Assert: 1000 + 1000 pending bytes are reserved, so one byte short of that is refused
    expect(response.status).toBe(507);
  });

  it("should count the pending bytes of several UPLOADING jobs but not more than they owe", async () => {
    // Arrange
    const needed = PAYLOAD.length * DISK_HEADROOM_FACTOR + DISK_SAFETY_MARGIN_BYTES;
    const harness = createHarness(await roots.create(), { freeBytes: async () => needed + 2000 });
    await makeJob(harness.root, { state: "UPLOADING", table: "nbiot", mutate: pending(1000, 0) });
    await makeJob(harness.root, { state: "UPLOADING", table: "wcdma", mutate: pending(2000, 1000) });
    await makeJob(harness.root, { state: "READY", table: "cobertura5g", mutate: pending(9_000_000, 0) });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));

    // Assert
    expect(response.status).toBe(200);
  });

  it("should never count a negative pending amount when an upload reports more received bytes than declared", async () => {
    // Arrange
    const needed = PAYLOAD.length * DISK_HEADROOM_FACTOR + DISK_SAFETY_MARGIN_BYTES;
    const harness = createHarness(await roots.create(), { freeBytes: async () => needed });
    await makeJob(harness.root, { state: "UPLOADING", table: "nbiot", mutate: pending(100, 500) });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));

    // Assert
    expect(response.status).toBe(200);
  });

  it("should answer 409 when a live job already holds the target table", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const holder = await makeJob(harness.root, { table: "lte" });
    await acquireTableLock(harness.root, "lte", { jobId: holder.jobId, pid: process.pid }, { now: () => harness.clock.now });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(409);
    expect(body.error).toContain("Ya hay una carga de lte en curso");
    expect(await listJobDirs(harness.root)).toEqual([holder.jobId]);
  });

  it("should not be blocked by a lock on a different table", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const holder = await makeJob(harness.root, { table: "wcdma" });
    await acquireTableLock(harness.root, "wcdma", { jobId: holder.jobId, pid: process.pid }, { now: () => harness.clock.now });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));

    // Assert
    expect(response.status).toBe(200);
  });

  it("should answer 400 in Spanish for a file name that breaks the convention", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.upload(uploadRequest({ fileName: "OtroArchivo_20260131.shp", size: 5 }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("no tiene un nombre válido");
  });

  it("should answer 413 when the declared size is above 4 GiB, without creating anything", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: 4 * 1024 * 1024 * 1024 + 1 }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(413);
    expect(body.error).toContain("4 GiB");
    expect(await listJobDirs(harness.root)).toEqual([]);
  });

  it("should answer 400 for a wrong content type, a missing size and a missing name", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const responses = await Promise.all([
      harness.handlers.upload(uploadRequest({ contentType: "text/plain", size: 5 })),
      harness.handlers.upload(uploadRequest({ size: null })),
      harness.handlers.upload(uploadRequest({ fileName: null, size: 5 })),
    ]);

    // Assert
    expect(responses.map((response) => response.status)).toEqual([400, 400, 400]);
    for (const response of responses) expect((await readJson(response)).success).toBe(false);
  });

  it("should answer 500 in Spanish when the volume check itself throws", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), {
      freeBytes: async () => {
        throw new Error("statfs exploded");
      },
    });

    // Act
    const response = await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));
    const body = await readJson(response);

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: "statfs exploded" });
  });

  it("should create the jobs folder on a fresh root", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    await harness.handlers.upload(uploadRequest({ size: PAYLOAD.length, body: PAYLOAD }));

    // Assert
    expect((await readdir(path.join(harness.root, "jobs"))).length).toBe(1);
  });
});
