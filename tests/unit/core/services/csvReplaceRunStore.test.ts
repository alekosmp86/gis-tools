import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplaceRunStore } from "@/core/services/replaceRunStoreFactory";
import { ShpReplaceRunStatus, type ShpReplaceRunClient, type ShpReplaceRunParams } from "@/core/services/replaceRunTypes";
import type { DbConfig } from "@/core/types/db";

const PASSWORD = "s3cret-pw";

const connection: DbConfig = {
  host: "tgt",
  port: "6543",
  db_name: "tdb",
  user: "u",
  password: PASSWORD,
  schema_name: "geo",
  table_name: "parcelas",
};

const runParams = (overrides: Partial<ShpReplaceRunParams> = {}): ShpReplaceRunParams => ({
  file: new Blob(["id,nombre\n1,a\n"]),
  fileName: "datos.csv",
  connection,
  mapping: { sourceByTarget: { nombre: "nombre" }, defaults: {} },
  sourceSrid: 4326,
  resetSequences: true,
  pollIntervalMs: 1,
  ...overrides,
});

const DONE_RESULT = {
  sourceRows: 1,
  stagedRows: 1,
  previousRows: 0,
  insertedRows: 1,
  dryRun: false,
  targetModified: true,
  sequencesAdjusted: [],
  analyze: { status: "ok" },
};

function fakeClient(jobId: string): ShpReplaceRunClient {
  return {
    upload: vi.fn(async () => ({ uploadId: `up-${jobId}`, size: 1 })),
    start: vi.fn(async () => ({ jobId })),
    status: vi.fn(async () => ({
      jobId,
      tableKey: "k",
      state: "done" as const,
      phase: null,
      dryRun: false,
      startedAt: 1,
      result: DONE_RESULT as never,
    })),
  };
}

async function untilSettled(store: { getSnapshot: () => { status: string } }): Promise<void> {
  for (let attempt = 0; attempt < 200 && !["done", "failed"].includes(store.getSnapshot().status); attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

describe("ReplaceRunStore factory", () => {
  describe("CR-12: instance independence", () => {
    it("should keep the state of one store untouched while another store runs", async () => {
      const first = new ReplaceRunStore(fakeClient("job-1"));
      const second = new ReplaceRunStore(fakeClient("job-2"));

      await first.start(runParams());
      await untilSettled(first);

      expect(first.getSnapshot().status).toBe(ShpReplaceRunStatus.DONE);
      expect(first.getSnapshot().jobId).toBe("job-1");
      expect(second.getSnapshot().status).toBe(ShpReplaceRunStatus.IDLE);
      expect(second.getSnapshot().jobId).toBeNull();
    });

    it("should only notify the subscribers of the store that changed", async () => {
      const first = new ReplaceRunStore(fakeClient("job-1"));
      const second = new ReplaceRunStore(fakeClient("job-2"));
      const firstListener = vi.fn();
      const secondListener = vi.fn();
      first.subscribe(firstListener);
      second.subscribe(secondListener);

      await first.start(runParams());
      await untilSettled(first);

      expect(firstListener).toHaveBeenCalled();
      expect(secondListener).not.toHaveBeenCalled();
    });

    it("should use the client it was built with and not the client of another store", async () => {
      const firstClient = fakeClient("job-1");
      const secondClient = fakeClient("job-2");
      const first = new ReplaceRunStore(firstClient);
      const second = new ReplaceRunStore(secondClient);

      await first.start(runParams());
      await untilSettled(first);

      expect(firstClient.start).toHaveBeenCalledTimes(1);
      expect(secondClient.start).not.toHaveBeenCalled();
      expect(secondClient.upload).not.toHaveBeenCalled();
      expect(second.getSnapshot().status).toBe(ShpReplaceRunStatus.IDLE);
    });

    it("should allow both stores to run at the same time without sharing the busy guard", async () => {
      const first = new ReplaceRunStore(fakeClient("job-1"));
      const second = new ReplaceRunStore(fakeClient("job-2"));

      await Promise.all([first.start(runParams()), second.start(runParams())]);
      await Promise.all([untilSettled(first), untilSettled(second)]);

      expect(first.getSnapshot().jobId).toBe("job-1");
      expect(second.getSnapshot().jobId).toBe("job-2");
    });

    it("should reset one store without touching the other", async () => {
      const first = new ReplaceRunStore(fakeClient("job-1"));
      const second = new ReplaceRunStore(fakeClient("job-2"));
      await Promise.all([first.start(runParams()), second.start(runParams())]);
      await Promise.all([untilSettled(first), untilSettled(second)]);

      first.reset();

      expect(first.getSnapshot().status).toBe(ShpReplaceRunStatus.IDLE);
      expect(second.getSnapshot().status).toBe(ShpReplaceRunStatus.DONE);
    });

    it("should return the idle state as the server snapshot", () => {
      const store = new ReplaceRunStore(fakeClient("job-1"));

      expect(store.getServerSnapshot().status).toBe(ShpReplaceRunStatus.IDLE);
    });
  });

  describe("CR-12: run behavior shared by every store", () => {
    it("should upload, start with the password, keep the password out of the rerun params and reach DONE", async () => {
      const client = fakeClient("job-1");
      const store = new ReplaceRunStore(client);

      await store.start(runParams());
      await untilSettled(store);

      expect(client.start).toHaveBeenCalledWith(
        expect.objectContaining({ password: PASSWORD, uploadId: "up-job-1", confirm: true, table_name: "parcelas" })
      );
      expect(store.getSnapshot().status).toBe(ShpReplaceRunStatus.DONE);
      expect(store.getSnapshot().uploadId).toBe("up-job-1");
      expect(JSON.stringify(store.getSnapshot())).not.toContain(PASSWORD);
    });

    it("should fail with the server message when the upload is rejected", async () => {
      const client = fakeClient("job-1");
      client.upload = vi.fn(async () => {
        throw new Error("Solo se admiten archivos .csv o .txt.");
      });
      const store = new ReplaceRunStore(client);

      await store.start(runParams());

      expect(store.getSnapshot()).toMatchObject({
        status: ShpReplaceRunStatus.FAILED,
        error: "Solo se admiten archivos .csv o .txt.",
      });
      expect(client.start).not.toHaveBeenCalled();
    });

    it("should skip the upload when an uploadId is already known", async () => {
      const client = fakeClient("job-1");
      const store = new ReplaceRunStore(client);

      await store.start(runParams({ uploadId: "kept-id" }));
      await untilSettled(store);

      expect(client.upload).not.toHaveBeenCalled();
      expect(client.start).toHaveBeenCalledWith(expect.objectContaining({ uploadId: "kept-id" }));
    });
  });
});

describe("csvReplaceRunStore", () => {
  interface Calls {
    xhrOpen: Array<[string, string]>;
    xhrHeaders: Record<string, string>;
    fetches: Array<{ url: string; init?: RequestInit }>;
  }

  let calls: Calls;

  beforeEach(() => {
    calls = { xhrOpen: [], xhrHeaders: {}, fetches: [] };
    class FakeXhr {
      status = 200;
      responseText = JSON.stringify({ success: true, uploadId: "csv-up-1", size: 9 });
      upload: Record<string, unknown> = {};
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open(method: string, url: string) {
        calls.xhrOpen.push([method, url]);
      }
      setRequestHeader(name: string, value: string) {
        calls.xhrHeaders[name] = value;
      }
      send() {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.fetches.push({ url, init });
        if (url.includes("-replace/start")) {
          return Response.json({ success: true, jobId: "csv-job-1" });
        }
        return Response.json({
          success: true,
          job: { jobId: "csv-job-1", tableKey: "k", state: "done", phase: null, dryRun: false, startedAt: 1, result: DONE_RESULT },
        });
      })
    );
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("CR-2: routes", () => {
    it("should upload to the CSV upload route with the datos.csv file name header", async () => {
      const csvStore = await import("@/core/services/csvReplaceRunStore");

      await csvStore.start(runParams());
      await untilSettled(csvStore);

      expect(calls.xhrOpen).toEqual([["POST", "/api/db/csv-replace/upload"]]);
      expect(calls.xhrHeaders["x-file-name"]).toBe("datos.csv");
    });

    it("should start the job on the CSV start route and poll the CSV status route with the job id", async () => {
      const csvStore = await import("@/core/services/csvReplaceRunStore");

      await csvStore.start(runParams());
      await untilSettled(csvStore);

      const urls = calls.fetches.map((entry) => entry.url);
      expect(urls[0]).toBe("/api/db/csv-replace/start");
      expect(urls.slice(1).every((url) => url === "/api/db/csv-replace/status?jobId=csv-job-1")).toBe(true);
      expect(urls.some((url) => url.includes("shp-replace"))).toBe(false);
      expect(calls.xhrOpen.some(([, url]) => url.includes("shp-replace"))).toBe(false);
    });

    it("should send the uploadId returned by the CSV upload in the start body", async () => {
      const csvStore = await import("@/core/services/csvReplaceRunStore");

      await csvStore.start(runParams());
      await untilSettled(csvStore);

      const body = JSON.parse(String(calls.fetches[0].init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ uploadId: "csv-up-1", confirm: true, table_name: "parcelas", sourceSrid: 4326 });
    });

    it("should reach DONE with the job result", async () => {
      const csvStore = await import("@/core/services/csvReplaceRunStore");

      await csvStore.start(runParams());
      await untilSettled(csvStore);

      expect(csvStore.getSnapshot()).toMatchObject({ status: ShpReplaceRunStatus.DONE, result: DONE_RESULT });
    });

    it("should not expose rerun because the CSV flow has no analysis pass", async () => {
      const csvStore = await import("@/core/services/csvReplaceRunStore");

      expect("rerun" in csvStore).toBe(false);
    });
  });

  describe("CR-12: independence from the shapefile store", () => {
    it("should leave the shapefile store idle when the CSV store runs", async () => {
      const csvStore = await import("@/core/services/csvReplaceRunStore");
      const shpStore = await import("@/core/services/shpReplaceRunStore");

      await csvStore.start(runParams());
      await untilSettled(csvStore);

      expect(csvStore.getSnapshot().status).toBe(ShpReplaceRunStatus.DONE);
      expect(shpStore.getSnapshot().status).toBe(ShpReplaceRunStatus.IDLE);
      expect(shpStore.getSnapshot().jobId).toBeNull();
    });

    it("should leave the CSV store idle when the shapefile store runs and use shapefile routes there", async () => {
      const csvStore = await import("@/core/services/csvReplaceRunStore");
      const shpStore = await import("@/core/services/shpReplaceRunStore");

      await shpStore.start(runParams({ fileName: "x.zip" }));
      await untilSettled(shpStore);

      expect(csvStore.getSnapshot().status).toBe(ShpReplaceRunStatus.IDLE);
      expect(calls.xhrOpen).toEqual([["POST", "/api/db/shp-replace/upload"]]);
      expect(calls.fetches[0].url).toBe("/api/db/shp-replace/start");
    });

    it("should not notify the shapefile subscribers when the CSV store changes", async () => {
      const csvStore = await import("@/core/services/csvReplaceRunStore");
      const shpStore = await import("@/core/services/shpReplaceRunStore");
      const shpListener = vi.fn();
      shpStore.subscribe(shpListener);

      await csvStore.start(runParams());
      await untilSettled(csvStore);

      expect(shpListener).not.toHaveBeenCalled();
    });

    it("should reset the CSV store without touching a finished shapefile run", async () => {
      const csvStore = await import("@/core/services/csvReplaceRunStore");
      const shpStore = await import("@/core/services/shpReplaceRunStore");
      await shpStore.start(runParams({ fileName: "x.zip" }));
      await untilSettled(shpStore);
      await csvStore.start(runParams());
      await untilSettled(csvStore);

      csvStore.reset();

      expect(csvStore.getSnapshot().status).toBe(ShpReplaceRunStatus.IDLE);
      expect(shpStore.getSnapshot().status).toBe(ShpReplaceRunStatus.DONE);
    });
  });
});
