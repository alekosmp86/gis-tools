import { describe, expect, it, vi } from "vitest";
import { DirectUrlDownloader } from "@/modules/cartography-watcher/services/DirectUrlDownloader";
import {
  DIRECT_DOWNLOAD_MAX_BYTES,
  DIRECT_DOWNLOAD_TIMEOUT_MS,
  MISSING_PRJ_WARNING,
} from "@/modules/cartography-watcher/constants";
import { buildShapefileZip, buildZip } from "./support/zipFixtures";

const TARGET_URL = "https://mapas.example/wfs?x=1";

function okFetch(body: Uint8Array | string, init: ResponseInit = { status: 200 }) {
  return vi.fn<typeof fetch>(async () => new Response(body as BodyInit, init));
}

describe("DirectUrlDownloader constants", () => {
  it("should use 60 s timeout and 100 MB cap", () => {
    expect(DIRECT_DOWNLOAD_TIMEOUT_MS).toBe(60_000);
    expect(DIRECT_DOWNLOAD_MAX_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe("DirectUrlDownloader.downloadShapefileZip", () => {
  it("should return the bytes and no warnings for a full shapefile zip", async () => {
    const zip = buildShapefileZip(true);
    const fetchFn = okFetch(zip);

    const result = await new DirectUrlDownloader(fetchFn).downloadShapefileZip(TARGET_URL);

    expect(Buffer.compare(result.content, zip)).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(TARGET_URL);
  });

  it("should send a timeout signal to fetch", async () => {
    const fetchFn = okFetch(buildShapefileZip());

    await new DirectUrlDownloader(fetchFn).downloadShapefileZip(TARGET_URL);

    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("should surface the .prj warning", async () => {
    const result = await new DirectUrlDownloader(
      okFetch(buildShapefileZip(false))
    ).downloadShapefileZip(TARGET_URL);
    expect(result.warnings).toEqual([MISSING_PRJ_WARNING]);
  });

  it.each([404, 500, 503])("should refuse HTTP %i naming the status", async (status) => {
    const downloader = new DirectUrlDownloader(okFetch("err", { status }));
    await expect(downloader.downloadShapefileZip(TARGET_URL)).rejects.toThrow(`HTTP ${status}`);
  });

  it("should never return a service error body as a file", async () => {
    const downloader = new DirectUrlDownloader(okFetch("<ServiceException/>", { status: 200 }));
    await expect(downloader.downloadShapefileZip(TARGET_URL)).rejects.toThrow(
      /no devolvió un archivo ZIP/
    );
  });

  it("should refuse a zip without shapefile parts", async () => {
    const downloader = new DirectUrlDownloader(okFetch(buildZip(["a.shp", "a.dbf"])));
    await expect(downloader.downloadShapefileZip(TARGET_URL)).rejects.toThrow(".shx");
  });

  it("should report a connection failure with a Spanish message", async () => {
    const downloader = new DirectUrlDownloader(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(downloader.downloadShapefileZip(TARGET_URL)).rejects.toThrow(
      /No se pudo conectar con la URL: fetch failed/
    );
  });

  it("should report a timeout when fetch rejects with TimeoutError", async () => {
    const downloader = new DirectUrlDownloader(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }, 5000);
    await expect(downloader.downloadShapefileZip(TARGET_URL)).rejects.toThrow(
      /no respondió en 5 segundos/
    );
  });

  it("should really time out a hanging fetch that honours the signal", async () => {
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const downloader = new DirectUrlDownloader(hanging, 20);

    await expect(downloader.downloadShapefileZip(TARGET_URL)).rejects.toThrow(
      /no respondió en/
    );
  });

  describe("size cap", () => {
    it("should accept a body of exactly maxBytes", async () => {
      const zip = buildShapefileZip();
      const downloader = new DirectUrlDownloader(okFetch(zip), 1000, zip.length);
      await expect(downloader.downloadShapefileZip(TARGET_URL)).resolves.toBeDefined();
    });

    it("should refuse a body one byte over maxBytes", async () => {
      const zip = buildShapefileZip();
      const downloader = new DirectUrlDownloader(okFetch(zip), 1000, zip.length - 1);
      await expect(downloader.downloadShapefileZip(TARGET_URL)).rejects.toThrow(/tamaño máximo/);
    });

    it("should refuse early when Content-Length declares more than the cap", async () => {
      const fetchFn = okFetch(buildShapefileZip(), {
        status: 200,
        headers: { "Content-Length": "999999" },
      });
      const downloader = new DirectUrlDownloader(fetchFn, 1000, 1000);
      await expect(downloader.downloadShapefileZip(TARGET_URL)).rejects.toThrow(/tamaño máximo/);
    });

    it("should abort a streamed body that grows past the cap without Content-Length", async () => {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(600));
        },
        cancel() {
          cancelled = true;
        },
      });
      const downloader = new DirectUrlDownloader(async () => new Response(stream), 1000, 1000);

      await expect(downloader.downloadShapefileZip(TARGET_URL)).rejects.toThrow(/tamaño máximo/);
      expect(cancelled).toBe(true);
    });

    it("should state the cap in whole megabytes", async () => {
      const downloader = new DirectUrlDownloader(
        okFetch(buildShapefileZip()),
        1000,
        2 * 1024 * 1024 - 1
      );
      const zipTooBig = new DirectUrlDownloader(
        okFetch(new Uint8Array(2 * 1024 * 1024)),
        1000,
        2 * 1024 * 1024 - 1
      );
      await expect(downloader.downloadShapefileZip(TARGET_URL)).resolves.toBeDefined();
      await expect(zipTooBig.downloadShapefileZip(TARGET_URL)).rejects.toThrow(/2 MB/);
    });
  });
});
