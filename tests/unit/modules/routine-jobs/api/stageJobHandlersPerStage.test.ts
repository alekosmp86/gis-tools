import { describe, expect, it, vi } from "vitest";
import { createUnidadTerritorialHandlers } from "@/modules/routine-jobs/api/unidadTerritorialHandlers";
import { createCargarLocalidadesHandlers } from "@/modules/routine-jobs/api/cargarLocalidadesHandlers";
import { parseCargarLocalidadesStartRequest } from "@/modules/routine-jobs/api/cargarLocalidadesRequestParsing";
import { createJobStore } from "@/modules/routine-jobs/jobs/shared/jobStore";
import { plannedUnitStepLabels } from "@/modules/routine-jobs/jobs/unidad-territorial/domain/plannedSteps";
import { plannedLocalityStepLabels } from "@/modules/routine-jobs/jobs/cargar-localidades/domain/plannedSteps";
import { targetLabelsOf } from "@/modules/routine-jobs/jobs/cargar-localidades/domain/tableRoles";
import { CONFIRM_REQUIRED_MESSAGE } from "@/modules/routine-jobs/jobs/cargar-localidades/services/preflight";
import { CONFIRM_REQUIRED_MESSAGE as UNIT_CONFIRM_MESSAGE } from "@/modules/routine-jobs/jobs/unidad-territorial/services/preflight";
import type { UnitResult } from "@/modules/routine-jobs/jobs/unidad-territorial/types";
import type { CargarLocalidadesResult } from "@/modules/routine-jobs/jobs/cargar-localidades/types";

const BASE_URL = "http://localhost/api/modules/routine-jobs";
const NOW = 1_700_000_000_000;
const PASSWORD = "Per-stage-pw!9";
const UNIT_CONFLICT = "Ya hay una actualización de unidades territoriales en curso para esta tabla.";
const LOCALITY_CONFLICT = "Ya hay una carga de localidades en curso para esta tabla.";
const TARGET = { schema: "carto", table: "cadastral_locality" };
const SECOND_TARGET = { schema: "carto", table: "cadastral_locality_2" };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const connection = { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD };

const unitBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  connection,
  localitySchema: "stg",
  localityTable: "localidades_catastrales_stg",
  typeSchema: "carto",
  typeTable: "tipo_unidad",
  targetSchema: "carto",
  targetTable: "territorial_unit",
  options: { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: true },
  dryRun: true,
  confirm: false,
  ...overrides,
});

const localityBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  connection,
  stagingSchema: "stg",
  padronTable: "padron_stg",
  localityStagingTable: "localidades_stg",
  provinceSchema: "carto",
  provinceTable: "province",
  targets: [{ ...TARGET }],
  options: { tolerance: 1, updateGeometries: false },
  dryRun: true,
  confirm: false,
  ...overrides,
});

const post = (path: string, body: unknown): Request =>
  new Request(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const get = (path: string, jobId: string): Request => new Request(`${BASE_URL}/${path}?jobId=${jobId}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonOf(response: Response): Promise<any> {
  return response.json();
}

describe("unidad-territorial handlers through the shared stage job handlers", () => {
  function unitHarness(run: () => Promise<UnitResult>) {
    const store = createJobStore<UnitResult>(() => NOW);
    const tracked: Promise<void>[] = [];
    const runSpy = vi.fn<(params: unknown) => Promise<UnitResult>>(() => run());
    const handlers = createUnidadTerritorialHandlers({ store, run: runSpy, track: (task) => void tracked.push(task) });
    return {
      runSpy,
      start: (body: Record<string, unknown>) => handlers.startUnidadTerritorial(post("unidad-territorial/start", body)),
      status: (jobId: string) => handlers.readUnidadTerritorialStatus(get("unidad-territorial/status", jobId)),
      settle: async () => {
        await Promise.all(tracked);
      },
    };
  }

  const finishedUnit = async (): Promise<UnitResult> => ({ outcomeUnknown: false }) as unknown as UnitResult;

  it("should answer 200 and hand the parsed target to run", async () => {
    const harness = unitHarness(finishedUnit);

    const response = await harness.start(unitBody());
    await harness.settle();

    expect(response.status).toBe(200);
    expect(harness.runSpy.mock.calls[0][0]).toMatchObject({ targetSchema: "carto", targetTable: "territorial_unit", dryRun: true });
  });

  it("should expose the planned unit steps in the status", async () => {
    const gate = deferred<UnitResult>();
    const harness = unitHarness(() => gate.promise);
    const started = await jsonOf(await harness.start(unitBody({ dryRun: true })));

    const view = (await jsonOf(await harness.status(started.jobId))).job;

    expect(view.steps).toEqual(plannedUnitStepLabels({ dryRun: true }));
    gate.resolve({ outcomeUnknown: false } as unknown as UnitResult);
    await harness.settle();
  });

  it("should answer 409 with the unit conflict message while the same target is running", async () => {
    const gate = deferred<UnitResult>();
    const harness = unitHarness(() => gate.promise);
    await harness.start(unitBody());

    const second = await harness.start(unitBody());

    expect(second.status).toBe(409);
    expect((await jsonOf(second)).error).toBe(UNIT_CONFLICT);
    gate.resolve({ outcomeUnknown: false } as unknown as UnitResult);
    await harness.settle();
  });

  it("should answer 200 for another target while the first target is running", async () => {
    const gate = deferred<UnitResult>();
    const harness = unitHarness(() => gate.promise);
    await harness.start(unitBody());

    const other = await harness.start(unitBody({ targetTable: "territorial_unit_2" }));

    expect(other.status).toBe(200);
    gate.resolve({ outcomeUnknown: false } as unknown as UnitResult);
    await harness.settle();
  });

  it("should answer 400 with the distinct-tables message when the target repeats the locality table", async () => {
    const harness = unitHarness(finishedUnit);

    const response = await harness.start(unitBody({ targetSchema: "stg", targetTable: "localidades_catastrales_stg" }));

    expect(response.status).toBe(400);
    expect((await jsonOf(response)).error).toMatch(/distintas/);
    expect(harness.runSpy).not.toHaveBeenCalled();
  });

  it("should answer 400 with the confirmation message on a real run without confirm", async () => {
    const harness = unitHarness(finishedUnit);

    const response = await harness.start(unitBody({ dryRun: false, confirm: false }));

    expect((await jsonOf(response)).error).toBe(UNIT_CONFIRM_MESSAGE);
  });
});

describe("cargar-localidades handlers through the shared stage job handlers", () => {
  function localityHarness(run: () => Promise<CargarLocalidadesResult>) {
    const store = createJobStore<CargarLocalidadesResult>(() => NOW);
    const tracked: Promise<void>[] = [];
    const runSpy = vi.fn<(params: unknown) => Promise<CargarLocalidadesResult>>(() => run());
    const handlers = createCargarLocalidadesHandlers({ store, run: runSpy, track: (task) => void tracked.push(task) });
    return {
      runSpy,
      start: (body: Record<string, unknown>) => handlers.startCargarLocalidades(post("cargar-localidades/start", body)),
      status: (jobId: string) => handlers.readCargarLocalidadesStatus(get("cargar-localidades/status", jobId)),
      settle: async () => {
        await Promise.all(tracked);
      },
    };
  }

  const finishedLocality = async (): Promise<CargarLocalidadesResult> =>
    ({ outcomeUnknown: false }) as unknown as CargarLocalidadesResult;

  it("should answer 200 and expose the planned locality steps of the parsed targets", async () => {
    const gate = deferred<CargarLocalidadesResult>();
    const harness = localityHarness(() => gate.promise);
    const body = localityBody({ dryRun: true, confirm: false });

    const started = await jsonOf(await harness.start(body));
    const view = (await jsonOf(await harness.status(started.jobId))).job;

    expect(view.steps).toEqual(plannedLocalityStepLabels({ dryRun: true, tables: targetLabelsOf(parseCargarLocalidadesStartRequest(body)) }));
    gate.resolve({ outcomeUnknown: false } as unknown as CargarLocalidadesResult);
    await harness.settle();
  });

  it("should answer 409 when one of the two targets of a new start is already running", async () => {
    const gate = deferred<CargarLocalidadesResult>();
    const harness = localityHarness(() => gate.promise);
    await harness.start(localityBody({ targets: [{ ...TARGET }] }));

    const second = await harness.start(localityBody({ targets: [{ ...TARGET }, { ...SECOND_TARGET }], dryRun: false, confirm: true }));

    expect(second.status).toBe(409);
    expect((await jsonOf(second)).error).toBe(LOCALITY_CONFLICT);
    gate.resolve({ outcomeUnknown: false } as unknown as CargarLocalidadesResult);
    await harness.settle();
  });

  it("should answer 200 when the targets of a new start are all free", async () => {
    const gate = deferred<CargarLocalidadesResult>();
    const harness = localityHarness(() => gate.promise);
    await harness.start(localityBody({ targets: [{ ...TARGET }] }));

    const other = await harness.start(localityBody({ targets: [{ ...SECOND_TARGET }] }));

    expect(other.status).toBe(200);
    gate.resolve({ outcomeUnknown: false } as unknown as CargarLocalidadesResult);
    await harness.settle();
  });

  it("should release the targets when the run succeeds so they can start again", async () => {
    const harness = localityHarness(finishedLocality);
    await harness.start(localityBody());
    await harness.settle();

    const again = await harness.start(localityBody());
    await harness.settle();

    expect(again.status).toBe(200);
  });

  it("should answer 400 and take no lock on a real run without confirm", async () => {
    const harness = localityHarness(finishedLocality);

    const rejected = await harness.start(localityBody({ dryRun: false, confirm: false }));
    const valid = await harness.start(localityBody());
    await harness.settle();

    expect(rejected.status).toBe(400);
    expect((await jsonOf(rejected)).error).toBe(CONFIRM_REQUIRED_MESSAGE);
    expect(valid.status).toBe(200);
  });

  it("should never echo the password in the start response", async () => {
    const harness = localityHarness(finishedLocality);

    const response = await harness.start(localityBody());
    await harness.settle();

    expect(await response.clone().text()).not.toContain(PASSWORD);
  });
});
