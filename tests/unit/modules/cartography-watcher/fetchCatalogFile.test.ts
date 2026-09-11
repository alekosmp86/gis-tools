import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCatalogFile } from "@/modules/cartography-watcher/ui/watcherClient";

describe("fetchCatalogFile", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should stream chunks, invoke onProgress, and return File when Content-Length is provided", async () => {
    // Arrange
    const chunk1 = new TextEncoder().encode("header,val\n");
    const chunk2 = new TextEncoder().encode("1,test\n");
    const totalBytes = chunk1.length + chunk2.length;
    const progressCalls: Array<{ phase: string; current: number; total: number }> = [];

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "Content-Disposition": 'attachment; filename="ciudades.csv"',
        "Content-Length": String(totalBytes),
      }),
      body: stream,
    });

    // Act
    const file = await fetchCatalogFile(
      "dataset-1",
      "res-1",
      "fallback.csv",
      (phase: string, current: number, total: number) => {
        progressCalls.push({ phase, current, total });
      }
    );

    // Assert
    expect(file.name).toBe("ciudades.csv");
    expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    expect(progressCalls[0]).toEqual({
      phase: "Descargando archivo...",
      current: chunk1.length,
      total: totalBytes,
    });
    expect(progressCalls[progressCalls.length - 1]).toEqual({
      phase: "Descargando archivo...",
      current: totalBytes,
      total: totalBytes,
    });
    const text = await file.text();
    expect(text).toBe("header,val\n1,test\n");
  });

  it("should use fallbackName when Content-Disposition does not have filename", async () => {
    // Arrange
    const chunk = new TextEncoder().encode("data");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: stream,
    });

    // Act
    const file = await fetchCatalogFile("dataset-1", "res-1", "fallback.csv");

    // Assert
    expect(file.name).toBe("fallback.csv");
  });

  it("should fallback to blob reading when response body is null", async () => {
    // Arrange
    const blob = new Blob(["test-content"]);
    const progressCalls: Array<{ phase: string; current: number; total: number }> = [];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      blob: vi.fn().mockResolvedValue(blob),
    });

    // Act
    const file = await fetchCatalogFile(
      "dataset-1",
      "res-1",
      "fallback.csv",
      (phase: string, current: number, total: number) => {
        progressCalls.push({ phase, current, total });
      }
    );

    // Assert
    expect(file.name).toBe("fallback.csv");
    expect(progressCalls).toHaveLength(1);
    expect(progressCalls[0].current).toBe(blob.size);
  });

  it("should throw descriptive error when response is not ok", async () => {
    // Arrange
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    // Act & Assert
    await expect(fetchCatalogFile("dataset-1", "res-1", "fallback.csv")).rejects.toThrow(
      "No se pudo obtener el archivo del catálogo (HTTP 404)."
    );
  });

  it("should throttle progress callbacks during multi-chunk streaming and report terminal 100%", async () => {
    // Arrange
    const chunkSize = 10 * 1024;
    const chunkCount = 10;
    const totalBytes = chunkSize * chunkCount;
    const chunks: Uint8Array[] = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
      chunks.push(new Uint8Array(chunkSize).fill(65));
    }

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "Content-Disposition": 'attachment; filename="large.csv"',
        "Content-Length": String(totalBytes),
      }),
      body: stream,
    });

    const progressCalls: Array<{ phase: string; current: number; total: number }> = [];

    // Act
    const file = await fetchCatalogFile(
      "dataset-large",
      "res-large",
      "fallback.csv",
      (phase: string, current: number, total: number) => {
        progressCalls.push({ phase, current, total });
      }
    );

    // Assert
    expect(file.name).toBe("large.csv");
    expect(progressCalls.length).toBeLessThan(chunkCount);
    expect(progressCalls.length).toBe(3);
    expect(progressCalls[0]).toEqual({
      phase: "Descargando archivo...",
      current: chunkSize,
      total: totalBytes,
    });
    expect(progressCalls[1]).toEqual({
      phase: "Descargando archivo...",
      current: 8 * chunkSize,
      total: totalBytes,
    });
    expect(progressCalls[progressCalls.length - 1]).toEqual({
      phase: "Descargando archivo...",
      current: totalBytes,
      total: totalBytes,
    });
  });

  it("should report total as 0 during streaming when Content-Length is absent, and report 100% on completion", async () => {
    // Arrange
    const chunk1 = new TextEncoder().encode("part-1\n");
    const chunk2 = new TextEncoder().encode("part-2\n");
    const totalBytes = chunk1.length + chunk2.length;
    const progressCalls: Array<{ phase: string; current: number; total: number }> = [];

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "Content-Disposition": 'attachment; filename="no-length.csv"',
      }),
      body: stream,
    });

    // Act
    const file = await fetchCatalogFile(
      "dataset-1",
      "res-1",
      "fallback.csv",
      (phase: string, current: number, total: number) => {
        progressCalls.push({ phase, current, total });
      }
    );

    // Assert
    expect(file.name).toBe("no-length.csv");
    expect(progressCalls[0]).toEqual({
      phase: "Descargando archivo...",
      current: chunk1.length,
      total: 0,
    });
    expect(progressCalls[progressCalls.length - 1]).toEqual({
      phase: "Descargando archivo...",
      current: totalBytes,
      total: totalBytes,
    });
  });
});
