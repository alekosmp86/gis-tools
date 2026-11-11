import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createCentrosAnepRunStore } from "@/modules/routine-jobs/ui/centrosAnepRunStore";
import { centrosAnepAnalysisKeyOf } from "@/modules/routine-jobs/ui/centrosAnepAnalysisKey";
import type { CentrosAnepJobStatusView, CentrosAnepStartRequest } from "@/modules/routine-jobs/ui/clientTypes";
import { centrosTablesBody } from "../centros-anep/centrosFixtures";

const PASSWORD = "s3cret-pw";
const POLL_MS = 2000;

const request = (overrides: Partial<CentrosAnepStartRequest> = {}): CentrosAnepStartRequest => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: PASSWORD },
  tables: centrosTablesBody(),
  dryRun: true,
  confirm: false,
  ...overrides,
});

const job = (changes: Partial<CentrosAnepJobStatusView> = {}): CentrosAnepJobStatusView =>
  ({ jobId: "job-1", state: "RUNNING", step: null, dryRun: true, startedAt: 1, ...changes }) as unknown as CentrosAnepJobStatusView;

interface FakeClient {
  start: Mock<(request: CentrosAnepStartRequest) => Promise<{ jobId: string }>>;
  readStatus: Mock<(jobId: string) => Promise<CentrosAnepJobStatusView>>;
}

const flush = async (): Promise<void> => {
  for (let tick = 0; tick < 30; tick++) await Promise.resolve();
};

function makeHarness() {
  const client: FakeClient = {
    start: vi.fn<(request: CentrosAnepStartRequest) => Promise<{ jobId: string }>>(),
    readStatus: vi.fn<(jobId: string) => Promise<CentrosAnepJobStatusView>>(),
  };
  let nextHandle = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const store = createCentrosAnepRunStore({
    client,
    setTimer: (fn, ms) => {
      const handle = nextHandle++;
      pending.set(handle, { fn, ms });
      return handle;
    },
    clearTimer: (handle) => {
      pending.delete(handle as number);
    },
    now: () => 0,
  });
  const poll = async (): Promise<void> => {
    for (const [handle, timer] of Array.from(pending.entries())) {
      pending.delete(handle);
      timer.fn();
    }
    await flush();
  };
  return { client, pending, store, poll };
}

describe("centrosAnepRunStore (CA-15)", () => {
  let h: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    h = makeHarness();
  });

  it("should start idle with no plan", () => {
    expect(h.store.getSnapshot()).toMatchObject({ phase: "idle" });
    expect(h.store.getSnapshot().plan).toBeUndefined();
  });

  it("should record the plan of the run: dry run flag, staging table and the analysis key", async () => {
    h.client.start.mockResolvedValue({ jobId: "job-1" });
    const dry = request();

    await h.store.start(dry);

    expect(h.store.getSnapshot()).toMatchObject({ phase: "running", jobId: "job-1" });
    expect(h.store.getSnapshot().plan).toEqual({
      dryRun: true,
      centrosStaging: "bdj_carto.ine_centros_anep",
      analysisKey: centrosAnepAnalysisKeyOf(dry),
    });
    expect(h.pending.size).toBe(1);
    expect(Array.from(h.pending.values())[0].ms).toBe(POLL_MS);
  });

  it("should plan a real run with dryRun false", async () => {
    h.client.start.mockResolvedValue({ jobId: "job-1" });

    await h.store.start(request({ dryRun: false, confirm: true }));

    expect(h.store.getSnapshot().plan?.dryRun).toBe(false);
  });

  it("should finish as done with the job when the poll answers DONE", async () => {
    h.client.start.mockResolvedValue({ jobId: "job-1" });
    h.client.readStatus.mockResolvedValue(job({ state: "DONE" }));
    await h.store.start(request());

    await h.poll();

    expect(h.store.getSnapshot()).toMatchObject({ phase: "done", job: { state: "DONE" } });
    expect(h.pending.size).toBe(0);
  });

  it("should finish as failed with the server error when the poll answers FAILED", async () => {
    h.client.start.mockResolvedValue({ jobId: "job-1" });
    h.client.readStatus.mockResolvedValue(job({ state: "FAILED", error: "falló la conexión" } as Partial<CentrosAnepJobStatusView>));
    await h.store.start(request());

    await h.poll();

    expect(h.store.getSnapshot().phase).toBe("failed");
  });

  it("should fail with the Spanish message when start is refused", async () => {
    h.client.start.mockRejectedValue(Object.assign(new Error("Ya hay una carga de centros ANEP en curso para esta tabla."), { status: 409 }));

    await h.store.start(request());

    expect(h.store.getSnapshot()).toMatchObject({
      phase: "failed",
      error: "Ya hay una carga de centros ANEP en curso para esta tabla.",
    });
    expect(h.client.readStatus).not.toHaveBeenCalled();
  });

  it("should use the centros ANEP fallback message when start rejects with a non-Error", async () => {
    h.client.start.mockRejectedValue("boom");

    await h.store.start(request());

    expect(h.store.getSnapshot().error).toBe("No se pudo iniciar la carga de centros ANEP.");
  });

  it("should ignore a second start while one is in flight", async () => {
    h.client.start.mockResolvedValue({ jobId: "job-1" });

    await h.store.start(request());
    await h.store.start(request());

    expect(h.client.start).toHaveBeenCalledOnce();
  });

  it("should return to idle on reset and notify subscribers", async () => {
    h.client.start.mockResolvedValue({ jobId: "job-1" });
    await h.store.start(request());
    const listener = vi.fn();
    const unsubscribe = h.store.subscribe(listener);

    h.store.reset();
    unsubscribe();
    h.store.reset();

    expect(h.store.getSnapshot().phase).toBe("idle");
    expect(listener).toHaveBeenCalled();
    expect(h.pending.size).toBe(0);
  });
});
