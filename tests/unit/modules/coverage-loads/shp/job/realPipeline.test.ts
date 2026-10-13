import { afterEach, describe, expect, it } from "vitest";
import { createRealPipeline } from "@/modules/coverage-loads/shp/job/realPipeline.ts";
import type { PipelineOutcome } from "@/modules/coverage-loads/shp/job/pipeline.ts";
import type { JobMode } from "@/modules/coverage-loads/shp/job/types.ts";
import { createFakePg } from "../helpers/fakePg.ts";
import type { FakePg } from "../helpers/fakePg.ts";
import { createRecordingContext } from "../helpers/jobTestContext.ts";
import type { RecordingContext } from "../helpers/jobTestContext.ts";
import { CANARY_PASSWORD } from "../helpers/jobTestEnv.ts";
import { buildShp, cwSquare, makeTempDir } from "../helpers/readerTestShp.ts";
import type { RecordSpec, TempShpDir } from "../helpers/readerTestShp.ts";

const temps: TempShpDir[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((t) => t.cleanup()));
});

interface Setup {
  fake: FakePg;
  rec: RecordingContext;
  run: () => Promise<PipelineOutcome>;
}

const TWO_SQUARES: RecordSpec[] = [[cwSquare(0, 0, 10)], [cwSquare(20, 0, 10)]];

async function setup(mode: JobMode = "LOAD", recs: RecordSpec[] = TWO_SQUARES): Promise<Setup> {
  const tmp = await makeTempDir();
  temps.push(tmp);
  const file = await tmp.write("LTEUruguay_20260131.shp", buildShp(recs));
  const fake = createFakePg();
  const rec = createRecordingContext(mode);
  (rec.context as { sourcePath: string }).sourcePath = file;
  const pipeline = createRealPipeline({ clientFactory: fake.factory, copyIn: fake.copyIn });
  return { fake, rec, run: () => pipeline.run(rec.context) };
}

const idx = (texts: string[], needle: string, from = 0): number => texts.findIndex((t, i) => i >= from && t.includes(needle));
const has = (fake: FakePg, needle: string): boolean => fake.texts().some((t) => t.includes(needle));
const invalidPieces = (n: string, maxVertices = "5", area = 200) => ({
  rows: [{ pieces: "2", max_vertices: maxVertices, invalid_pieces: n, vertices: "10", area }],
});

describe("createRealPipeline", () => {
  describe("LOAD happy path", () => {
    it("should run lock, stage, subdivide, repair, one swap transaction, analyze, drop, unlock in order", async () => {
      const { fake, rec, run } = await setup("LOAD");

      const outcome = await run();

      const t = fake.texts();
      expect(outcome).toMatchObject({ kind: "SUCCEEDED", gates: { passed: true, stagingRows: 2 }, leftovers: [] });
      expect(rec.stages).toEqual(["READING", "STAGING", "SUBDIVIDING", "REPAIRING", "SWAPPING", "FINALIZING"]);
      const order = [
        "pg_try_advisory_lock",
        "DROP TABLE IF EXISTS",
        "CREATE UNLOGGED TABLE public.shp_stage_lte",
        "CREATE UNLOGGED TABLE public.shp_work_lte",
        "WITH inserted",
        "WITH repaired",
        "BEGIN",
        "TRUNCATE public.lte",
        "INSERT INTO public.lte",
        "COMMIT",
        "ANALYZE public.lte",
        "pg_advisory_unlock",
      ].map((needle) => idx(t, needle));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(has(fake, "ROLLBACK")).toBe(false);
      const commit = order[9] as number;
      expect(idx(t, "DROP TABLE IF EXISTS", commit)).toBeGreaterThan(commit);
      expect(fake.ended).toBe(1);
    });

    it("should bind fechaact and fuente as parameters and never splice them into SQL", async () => {
      const { fake, run } = await setup("LOAD");

      await run();

      const insert = fake.queries.find((q) => q.text.startsWith("INSERT INTO public.lte"));
      expect(insert?.values).toEqual(["2026-01-31", "EXTERNO/F.Maresca"]);
      expect(insert?.text).not.toContain("2026-01-31");
    });
  });

  describe("TEST mode", () => {
    it("should skip the swap, never touch the target and return current/new/diff", async () => {
      const { fake, rec, run } = await setup("TEST");

      const outcome = await run();

      expect(rec.stages).toEqual(["READING", "STAGING", "SUBDIVIDING", "REPAIRING", "FINALIZING"]);
      for (const forbidden of ["BEGIN", "COMMIT", "TRUNCATE", "INSERT INTO public.lte", "ANALYZE"]) expect(has(fake, forbidden)).toBe(false);
      expect(outcome).toMatchObject({
        kind: "SUCCEEDED",
        testReport: {
          current: { rows: 3, vertices: 15, area: 250 },
          new: { rows: 2, vertices: 10, area: 200 },
          diff: { rows: -1, vertices: -5, area: -50 },
        },
      });
      expect(has(fake, "pg_advisory_unlock")).toBe(true);
    });
  });

  describe("binary COPY stream", () => {
    it("should frame header, one tuple per record with EWKB, and the -1 trailer", async () => {
      const { fake, run } = await setup("LOAD");

      await run();

      const buf = Buffer.concat(fake.copied);
      const signature = Buffer.from([0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00]);
      expect(buf.subarray(0, 11).equals(signature)).toBe(true);
      expect(buf.readInt32BE(11)).toBe(0);
      expect(buf.readInt32BE(15)).toBe(0);
      expect(buf.readInt16BE(buf.length - 2)).toBe(-1);
      let o = 19;
      const recs: number[] = [];
      while (buf.readInt16BE(o) !== -1) {
        expect(buf.readInt16BE(o)).toBe(3);
        expect(buf.readInt32BE(o + 2)).toBe(4);
        recs.push(buf.readInt32BE(o + 6));
        expect(buf.readInt32BE(o + 10)).toBe(4);
        expect(buf.readInt32BE(o + 14)).toBe(5);
        const len = buf.readInt32BE(o + 18);
        expect(buf.subarray(o + 22, o + 27).toString("hex")).toBe("0106000020");
        o += 22 + len;
      }
      expect(recs).toEqual([1, 2]);
      expect(o).toBe(buf.length - 2);
    });
  });

  describe("gate failure", () => {
    it("should end GATE_FAILED, never open the swap transaction and drop the work tables", async () => {
      const { fake, rec, run } = await setup("LOAD");
      fake.responder = (text) => (text.includes("AS invalid_pieces") ? invalidPieces("3") : undefined);

      const outcome = await run();

      expect(outcome).toMatchObject({ kind: "FAILED", error: { code: "GATE_FAILED" } });
      expect(rec.stages).not.toContain("SWAPPING");
      expect(has(fake, "BEGIN")).toBe(false);
      expect(has(fake, "TRUNCATE")).toBe(false);
      const t = fake.texts();
      expect(idx(t, "DROP TABLE IF EXISTS", idx(t, "AS invalid_pieces"))).toBeGreaterThan(0);
      expect(has(fake, "pg_advisory_unlock")).toBe(true);
    });

    it("should fail GATE_FAILED when a piece exceeds 1024 vertices", async () => {
      const { fake, run } = await setup("LOAD");
      fake.responder = (text) => (text.includes("AS invalid_pieces") ? invalidPieces("0", "1025") : undefined);

      expect(await run()).toMatchObject({ kind: "FAILED", error: { code: "GATE_FAILED" } });
    });

    it("should pass the vertex gate at exactly 1024 vertices", async () => {
      const { fake, run } = await setup("LOAD");
      fake.responder = (text) => (text.includes("AS invalid_pieces") ? invalidPieces("0", "1024") : undefined);

      expect(await run()).toMatchObject({ kind: "SUCCEEDED" });
    });

    it("should fail GATE_FAILED when the repaired area drifts by more than 1e-6", async () => {
      const { fake, run } = await setup("LOAD");
      fake.responder = (text) => (text.includes("AS invalid_pieces") ? invalidPieces("0", "5", 200.001) : undefined);

      expect(await run()).toMatchObject({ kind: "FAILED", error: { code: "GATE_FAILED" } });
    });

    it("should fail STAGE_MISMATCH when the staged row count differs from the records copied", async () => {
      const { fake, run } = await setup("LOAD");
      fake.responder = (text) => (text.includes("FROM public.shp_stage_lte") && text.includes("AS area") ? { rows: [{ rows: "1", area: 100 }] } : undefined);

      expect(await run()).toMatchObject({ kind: "FAILED", error: { code: "STAGE_MISMATCH" } });
      expect(has(fake, "DROP TABLE IF EXISTS")).toBe(true);
    });
  });

  describe("table lock", () => {
    it("should fail TABLE_LOCKED without dropping, creating or unlocking anything", async () => {
      const { fake, run } = await setup("LOAD");
      fake.responder = (text) => (text.includes("pg_try_advisory_lock") ? { rows: [{ locked: false }] } : undefined);

      const outcome = await run();

      expect(outcome).toMatchObject({ kind: "FAILED", error: { code: "TABLE_LOCKED" } });
      expect(has(fake, "DROP TABLE")).toBe(false);
      expect(has(fake, "CREATE")).toBe(false);
      expect(has(fake, "pg_advisory_unlock")).toBe(false);
      expect(fake.ended).toBe(1);
    });
  });

  describe("swap failure", () => {
    it("should roll back and keep the old data when the INSERT fails, then drop work tables", async () => {
      const { fake, run } = await setup("LOAD");
      fake.responder = (text) => {
        if (text.startsWith("INSERT INTO public.lte")) throw Object.assign(new Error("disk full"), { code: "53100" });
        return undefined;
      };

      const outcome = await run();

      const t = fake.texts();
      expect(outcome).toMatchObject({ kind: "FAILED", error: { code: "SERVER_RESOURCES" } });
      expect(idx(t, "ROLLBACK")).toBeGreaterThan(idx(t, "BEGIN"));
      expect(has(fake, "COMMIT")).toBe(false);
      expect(idx(t, "DROP TABLE IF EXISTS", idx(t, "ROLLBACK"))).toBeGreaterThan(0);
    });

    it("should roll back with SWAP_MISMATCH when the target row count differs from the pieces", async () => {
      const { fake, run } = await setup("LOAD");
      fake.responder = (text) => (text.startsWith("SELECT count(*)::text AS rows FROM public.lte") ? { rows: [{ rows: "1" }] } : undefined);

      expect(await run()).toMatchObject({ kind: "FAILED", error: { code: "SWAP_MISMATCH" } });
      expect(has(fake, "ROLLBACK")).toBe(true);
      expect(has(fake, "COMMIT")).toBe(false);
    });

    it("should still succeed with leftovers when only housekeeping fails after the commit", async () => {
      const { fake, run } = await setup("LOAD");
      let afterCommit = false;
      fake.responder = (text) => {
        if (text === "COMMIT") afterCommit = true;
        if (afterCommit && text.startsWith("DROP TABLE")) throw new Error("drop refused");
        return undefined;
      };

      const outcome = await run();

      expect(outcome).toMatchObject({ kind: "SUCCEEDED", leftovers: ["public.shp_stage_lte", "public.shp_work_lte"] });
    });
  });

  describe("cancel", () => {
    it("should stop between subdivide batches, send no further batch, and drop the work tables", async () => {
      const { fake, rec, run } = await setup("LOAD");
      fake.responder = (text) => {
        if (text.startsWith("SELECT rec, npoints")) return { rows: [{ rec: 1, npoints: 1_500_000 }, { rec: 2, npoints: 1_500_000 }] };
        if (text.includes("WITH inserted")) {
          rec.abort.abort();
          return { rows: [{ pieces: "1" }] };
        }
        return undefined;
      };

      const outcome = await run();

      expect(outcome).toEqual({ kind: "CANCELLED" });
      expect(fake.texts().filter((t) => t.includes("WITH inserted"))).toHaveLength(1);
      expect(has(fake, "WITH repaired")).toBe(false);
      expect(has(fake, "BEGIN")).toBe(false);
      const t = fake.texts();
      expect(idx(t, "DROP TABLE IF EXISTS", idx(t, "WITH inserted"))).toBeGreaterThan(0);
      expect(has(fake, "pg_advisory_unlock")).toBe(true);
    });

    it("should stop between repair batches", async () => {
      const { fake, rec, run } = await setup("LOAD");
      fake.responder = (text) => {
        if (text.includes("AS first_id")) return { rows: [{ first_id: "1", last_id: "4001", pieces: "4001" }] };
        if (text.includes("WITH repaired")) {
          rec.abort.abort();
          return { rows: [{ repaired: "2000" }] };
        }
        return undefined;
      };

      expect(await run()).toEqual({ kind: "CANCELLED" });
      expect(fake.texts().filter((t) => t.includes("WITH repaired"))).toHaveLength(1);
      expect(has(fake, "TRUNCATE")).toBe(false);
    });

    it("should roll back when cancelled inside the swap transaction before COMMIT", async () => {
      const { fake, rec, run } = await setup("LOAD");
      fake.responder = (text) => {
        if (text.startsWith("SELECT count(*)::text AS rows FROM public.lte")) {
          rec.abort.abort();
          return { rows: [{ rows: "2" }] };
        }
        return undefined;
      };

      expect(await run()).toEqual({ kind: "CANCELLED" });
      expect(has(fake, "ROLLBACK")).toBe(true);
      expect(has(fake, "COMMIT")).toBe(false);
    });

    it("should register a cancel hook that sends pg_cancel_backend for the work pid from a second connection", async () => {
      const { fake, rec, run } = await setup("LOAD");
      let hookDuringRun: (() => void | Promise<void>) | null = null;
      fake.responder = (text) => {
        if (text.includes("WITH repaired")) hookDuringRun = rec.hooks.filter((h) => h !== null).at(-1) ?? null;
        return undefined;
      };
      await run();
      const clientsBefore = fake.clients;

      await (hookDuringRun as (() => void | Promise<void>) | null)?.();

      expect(hookDuringRun).not.toBeNull();
      expect(fake.clients).toBe(clientsBefore + 1);
      expect(fake.queries.find((q) => q.text.includes("pg_cancel_backend"))?.values).toEqual([4242]);
      expect(rec.hooks.at(-1)).toBeNull();
    });
  });

  describe("failure mapping and secrets", () => {
    it("should map a connect failure to DB_CONNECT_FAILED without queries", async () => {
      const { fake, run } = await setup("LOAD");
      fake.connectError = new Error("connect ECONNREFUSED");

      expect(await run()).toMatchObject({ kind: "FAILED", error: { code: "DB_CONNECT_FAILED" } });
      expect(fake.queries).toHaveLength(0);
    });

    it("should map ECONNRESET during a statement to DB_CONNECTION_LOST", async () => {
      const { fake, run } = await setup("LOAD");
      fake.responder = (text) => {
        if (text.includes("WITH repaired")) throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
        return undefined;
      };

      expect(await run()).toMatchObject({ kind: "FAILED", error: { code: "DB_CONNECTION_LOST" } });
    });

    it("should map SQLSTATE 57014 to STATEMENT_TIMEOUT and 42501 to PRIVILEGE_DENIED", async () => {
      const a = await setup("LOAD");
      a.fake.responder = (text) => {
        if (text.includes("WITH inserted")) throw Object.assign(new Error("canceling"), { code: "57014" });
        return undefined;
      };
      const b = await setup("LOAD");
      b.fake.responder = (text) => {
        if (text.startsWith("CREATE UNLOGGED TABLE public.shp_stage")) throw Object.assign(new Error("denied"), { code: "42501" });
        return undefined;
      };

      expect(await a.run()).toMatchObject({ error: { code: "STATEMENT_TIMEOUT" } });
      expect(await b.run()).toMatchObject({ error: { code: "PRIVILEGE_DENIED" } });
    });

    it("should map a shapefile without geometries to SHP_EMPTY before any table is created or COPY is sent", async () => {
      const { fake, run } = await setup("LOAD", [null, null]);

      expect(await run()).toMatchObject({ kind: "FAILED", error: { code: "SHP_EMPTY" } });
      expect(has(fake, "CREATE")).toBe(false);
      expect(fake.copied).toHaveLength(0);
    });

    it("should never put the password into SQL text, bound values, logs, progress or an outcome", async () => {
      const good = await setup("LOAD");
      const bad = await setup("LOAD");
      bad.fake.responder = (text) => {
        if (text.startsWith("TRUNCATE")) throw new Error("boom");
        return undefined;
      };

      const outcomes = [await good.run(), await bad.run()];

      for (const s of [good, bad]) {
        expect(JSON.stringify([s.fake.queries, s.rec.logs, s.rec.progress])).not.toContain(CANARY_PASSWORD);
      }
      expect(JSON.stringify(outcomes)).not.toContain(CANARY_PASSWORD);
    });
  });
});
