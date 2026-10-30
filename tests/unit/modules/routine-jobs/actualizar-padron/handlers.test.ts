import { describe, it, expect, vi } from "vitest";
import { createActualizarPadronHandlers } from "@/modules/routine-jobs/api/actualizarPadronHandlers";
import { createJobStore } from "@/modules/routine-jobs/jobs/shared/jobStore";
import { plannedStepLabels } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plannedSteps";
import { SKIP_REASON } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { ActualizarPadronParams, ActualizarPadronResult, SkippedReport } from "@/modules/routine-jobs/jobs/actualizar-padron/types";

const PASSWORD = "Ac7ual!zar-pw";
const NOW = 1_700_000_000_000;
const LOCK_KEY = "db.local:5432|gis|carto|padron_tmp_actualizacion";
const CONFLICT_MESSAGE = "Ya hay una actualización en curso para esta tabla.";
const START_URL = "http://localhost/api/modules/routine-jobs/actualizar-padron/start";

type Body = Record<string, unknown>;
type RunFn = (params: ActualizarPadronParams) => Promise<ActualizarPadronResult>;

const emptySkipped = (): SkippedReport => ({
  byReason: Object.fromEntries(Object.values(SKIP_REASON).map((reason) => [reason, 0])) as SkippedReport["byReason"],
  byDepartment: [],
  byLocality: [],
  byLocalityAndReason: [],
  samples: [],
  skippedRows: [],
  collidingKeys: [],
  collidingKeyCount: 0,
});

const resultOf = (): ActualizarPadronResult => ({
  dryRun: false,
  targetModified: true,
  outcomeUnknown: false,
  totals: { rowsRead: 20, candidates: 18, repaired: 1, skipped: 2 },
  skipped: emptySkipped(),
  target: {
    table: "carto.padron_tmp_actualizacion",
    schema: "carto",
    inserted: 0,
    insertedList: [],
    updated: 0,
    updateApplied: true,
    unchanged: 0,
    unchangedWithinTolerance: 0,
    changed: 0,
    missing: 0,
    missingSamples: [],
    ambiguous: 0,
    ambiguousSamples: [],
    geometryChanges: [],
    pairs: [],
    pairsTotal: 0,
    pairsApplied: 0,
    pairsNotApplied: 0,
  },
  warnings: [],
  stepTimings: [],
});

const startBody = (): Body => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  stagingSchema: "stg",
  stagingTable: "catastro_paispadron_stg",
  cartoSchema: "carto",
  targetTable: "padron_tmp_actualizacion",
  provinceTable: "province",
  localityTable: "cadastral_locality",
  options: { tolerance: 1, updateGeometries: true, linkAddressMaster: false },
  dryRun: false,
  confirm: true,
});

const withPatch = (patch: (body: Body) => void): Body => {
  const body = startBody();
  patch(body);
  return body;
};

/** A run that stays RUNNING until released, so a second start meets the lock. */
function heldRun(): { run: RunFn; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { run: async () => (await gate, resultOf()), release };
}

function createWiring(run: RunFn = async () => resultOf()) {
  const tracked: Promise<void>[] = [];
  const store = createJobStore<ActualizarPadronResult>(() => NOW);
  const runSpy = vi.fn(run);
  const handlers = createActualizarPadronHandlers({
    store,
    run: runSpy,
    track: (task: Promise<void>) => void tracked.push(task),
  });
  return {
    run: runSpy,
    tryStart: vi.spyOn(store, "tryStart"),
    settle: async (): Promise<void> => {
      await Promise.all(tracked);
    },
    start: (body: unknown = startBody()) =>
      handlers.startActualizarPadron(
        new Request(START_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      ),
  };
}

describe("createActualizarPadronHandlers lock", () => {
  it("should take the lock on host, port, database, carto schema and destination table, with the planned steps", async () => {
    const wiring = createWiring();

    const response = await wiring.start();
    await wiring.settle();

    expect(response.status).toBe(200);
    expect(wiring.tryStart).toHaveBeenCalledWith([LOCK_KEY], false, plannedStepLabels({ dryRun: false }));
  });

  it("should answer 409 with the Spanish message for a second start on the same destination, even with another staging table", async () => {
    const held = heldRun();
    const wiring = createWiring(held.run);
    await wiring.start();

    const second = await wiring.start(withPatch((body) => (body.stagingTable = "otra_staging")));

    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ success: false, error: CONFLICT_MESSAGE });
    held.release();
    await wiring.settle();
  });

  it("should grant a start on a different destination table of the same database", async () => {
    const held = heldRun();
    const wiring = createWiring(held.run);
    const first = await wiring.start();

    const second = await wiring.start(withPatch((body) => (body.targetTable = "padron_otro")));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    held.release();
    await wiring.settle();
  });

  it("should grant a start on the same destination table name in a different carto schema", async () => {
    const held = heldRun();
    const wiring = createWiring(held.run);
    const first = await wiring.start();

    const second = await wiring.start(withPatch((body) => (body.cartoSchema = "otro_esquema")));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    held.release();
    await wiring.settle();
  });

  it("should release the lock once the run settles, so the next start on that destination is accepted", async () => {
    const wiring = createWiring();
    await wiring.start();
    await wiring.settle();

    const next = await wiring.start();
    await wiring.settle();

    expect(next.status).toBe(200);
  });

  it("should answer 400 and never run the job when a real run has no confirm", async () => {
    const wiring = createWiring();

    const response = await wiring.start(withPatch((body) => (body.confirm = false)));
    await wiring.settle();

    expect(response.status).toBe(400);
    expect(wiring.run).not.toHaveBeenCalled();
  });
});
