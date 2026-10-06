import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const runComparisonSync = vi.fn();
vi.mock("@/core/workers/comparisonWorkerSync", () => ({
  runComparisonSync: (...args: unknown[]) => runComparisonSync(...args),
}));

const generatePatches = vi.fn();
const sqlCtor = vi.fn();
const shpCtor = vi.fn();
const extractEpsg = vi.fn();

vi.mock("@/core/workers/comparison/SqlPatchGenerator", () => ({
  SqlPatchGenerator: class {
    constructor(opts: unknown) {
      sqlCtor(opts);
    }
    generatePatches(...args: unknown[]) {
      return generatePatches(...args);
    }
  },
}));
vi.mock("@/core/binary/BinaryShpReader", () => ({
  BinaryShpReader: class {
    constructor(buf: unknown) {
      shpCtor(buf);
    }
  },
}));
vi.mock("@/core/spatial/ProjectionEngine", () => ({
  ProjectionEngine: { extractEpsg: (...a: unknown[]) => extractEpsg(...a) },
}));

import { runInWorker, generateSqlPatchesInWorker } from "@/core/services/workerBridge";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string | null }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(public url: unknown) {
    FakeWorker.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage!({ data });
  }
}

const lastWorker = () => FakeWorker.instances[FakeWorker.instances.length - 1];
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  FakeWorker.instances = [];
  runComparisonSync.mockReset();
  generatePatches.mockReset();
  sqlCtor.mockReset();
  shpCtor.mockReset();
  extractEpsg.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Case = {
  name: string;
  call: (input: never, onProgress?: (p: string, c: number, t: number) => void) => Promise<unknown>;
  messageType: string;
  fallbackMessage: string;
};

const cases: Case[] = [
  {
    name: "runInWorker",
    call: runInWorker as unknown as Case["call"],
    messageType: "RUN_COMPARISON",
    fallbackMessage: "Error desconocido en el Web Worker.",
  },
  {
    name: "generateSqlPatchesInWorker",
    call: generateSqlPatchesInWorker as unknown as Case["call"],
    messageType: "GENERATE_SQL",
    fallbackMessage: "Error en el Web Worker al generar parches SQL.",
  },
];

describe.each(cases)("workerBridge $name (Worker available)", (c) => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker);
  });

  it("should post a typed message with the payload to a newly created worker", () => {
    const input = { marker: 1 } as never;

    void c.call(input).catch(() => {});

    expect(FakeWorker.instances).toHaveLength(1);
    expect(lastWorker().postMessage).toHaveBeenCalledTimes(1);
    expect(lastWorker().postMessage).toHaveBeenCalledWith({ type: c.messageType, payload: input });
    expect(String(lastWorker().url)).toContain("comparisonWorker.ts");
  });

  it("should forward PROGRESS to onProgress without settling or terminating", async () => {
    const onProgress = vi.fn();
    let settled = false;
    const p = c.call({} as never, onProgress).finally(() => (settled = true));
    p.catch(() => {});

    lastWorker().emit({ type: "PROGRESS", phase: "load", current: 2, total: 5 });
    await tick();

    expect(onProgress).toHaveBeenCalledWith("load", 2, 5);
    expect(settled).toBe(false);
    expect(lastWorker().terminate).not.toHaveBeenCalled();
  });

  it("should not throw on PROGRESS when onProgress is omitted", () => {
    void c.call({} as never).catch(() => {});

    expect(() =>
      lastWorker().emit({ type: "PROGRESS", phase: "x", current: 1, total: 1 })
    ).not.toThrow();
  });

  it("should terminate the worker and resolve with the payload on DONE", async () => {
    const p = c.call({} as never);
    const payload = { result: "ok" };

    lastWorker().emit({ type: "DONE", payload });

    await expect(p).resolves.toBe(payload);
    expect(lastWorker().terminate).toHaveBeenCalledTimes(1);
  });

  it("should terminate the worker and reject with Error(message) on ERROR", async () => {
    const p = c.call({} as never);

    lastWorker().emit({ type: "ERROR", message: "boom" });

    await expect(p).rejects.toThrow(new Error("boom"));
    expect(lastWorker().terminate).toHaveBeenCalledTimes(1);
  });

  it("should ignore unknown message types", async () => {
    let settled = false;
    const p = c.call({} as never).finally(() => (settled = true));
    p.catch(() => {});

    lastWorker().emit({ type: "WHATEVER" });
    await tick();

    expect(settled).toBe(false);
    expect(lastWorker().terminate).not.toHaveBeenCalled();
  });

  it("should terminate and reject with errorEvent.message on worker.onerror", async () => {
    const p = c.call({} as never);

    lastWorker().onerror!({ message: "worker crashed" });

    await expect(p).rejects.toThrow("worker crashed");
    expect(lastWorker().terminate).toHaveBeenCalledTimes(1);
  });

  it("should reject with the function-specific Spanish fallback when errorEvent.message is nullish", async () => {
    const pUndefined = c.call({} as never);
    lastWorker().onerror!({});
    await expect(pUndefined).rejects.toThrow(c.fallbackMessage);

    const pNull = c.call({} as never);
    lastWorker().onerror!({ message: null });
    await expect(pNull).rejects.toThrow(c.fallbackMessage);
  });

  it("should keep an empty-string errorEvent.message (not nullish) as the rejection message", async () => {
    const p = c.call({} as never);

    lastWorker().onerror!({ message: "" });

    await expect(p).rejects.toThrow(new Error(""));
  });
});

describe("workerBridge runInWorker (no Worker)", () => {
  it("should delegate to runComparisonSync with input and onProgress", async () => {
    vi.stubGlobal("Worker", undefined);
    const summary = { done: true };
    runComparisonSync.mockResolvedValue(summary);
    const input = { a: 1 } as never;
    const onProgress = vi.fn();

    const result = await runInWorker(input, onProgress);

    expect(result).toBe(summary);
    expect(runComparisonSync).toHaveBeenCalledWith(input, onProgress);
  });
});

describe("workerBridge generateSqlPatchesInWorker (no Worker)", () => {
  const makeInput = (fileDataset: Record<string, unknown>) =>
    ({
      discrepancyItems: [{ id: 1 }],
      fileDataset,
      dbSchemaName: "public",
      dbTableName: "t",
      mappingConfig: { m: 1 },
      dbColumnTypes: { c: "int4" },
    }) as never;

  beforeEach(() => {
    vi.stubGlobal("Worker", undefined);
  });

  it("should build the generator with reader, srid and isBinaryDbf when all buffers/prj are present", async () => {
    const shpBuffer = new Uint8Array([1]);
    extractEpsg.mockReturnValue(4326);
    generatePatches.mockResolvedValue("summary");
    const onProgress = vi.fn();
    const input = makeInput({ shpBuffer, dbfBuffer: new Uint8Array([2]), prjText: "PRJ" });

    const result = await generateSqlPatchesInWorker(input, onProgress);

    expect(result).toBe("summary");
    expect(shpCtor).toHaveBeenCalledWith(shpBuffer);
    expect(extractEpsg).toHaveBeenCalledWith("PRJ");
    const opts = sqlCtor.mock.calls[0][0];
    expect(opts).toMatchObject({
      dbSchemaName: "public",
      dbTableName: "t",
      mappingConfig: { m: 1 },
      dbColumnTypes: { c: "int4" },
      isBinaryDbf: true,
      fileSrid: 4326,
    });
    expect(opts.shpReader).not.toBeNull();
    expect(generatePatches).toHaveBeenCalledWith([{ id: 1 }], onProgress, true);
  });

  it("should use null reader, undefined srid and isBinaryDbf false when buffers and prj are absent", async () => {
    generatePatches.mockResolvedValue("s");

    await generateSqlPatchesInWorker(makeInput({}));

    expect(shpCtor).not.toHaveBeenCalled();
    expect(extractEpsg).not.toHaveBeenCalled();
    const opts = sqlCtor.mock.calls[0][0];
    expect(opts.shpReader).toBeNull();
    expect(opts.fileSrid).toBeUndefined();
    expect(opts.isBinaryDbf).toBe(false);
    expect(generatePatches).toHaveBeenCalledWith([{ id: 1 }], undefined, true);
  });

  it("should coerce a null EPSG extraction result to undefined fileSrid", async () => {
    extractEpsg.mockReturnValue(null);
    generatePatches.mockResolvedValue("s");

    await generateSqlPatchesInWorker(makeInput({ prjText: "PRJ" }));

    expect(sqlCtor.mock.calls[0][0].fileSrid).toBeUndefined();
  });

  it("should treat an empty dbfBuffer object as binary (Boolean of a truthy typed array)", async () => {
    generatePatches.mockResolvedValue("s");

    await generateSqlPatchesInWorker(makeInput({ dbfBuffer: new Uint8Array(0) }));

    expect(sqlCtor.mock.calls[0][0].isBinaryDbf).toBe(true);
  });
});
