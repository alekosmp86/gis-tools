import type { Page, Route } from "@playwright/test";
import type {
  CutPlan,
  IndicatorsPlan,
  LoadResult,
  RejectedRow,
} from "../../../src/modules/coverage-loads/indicators/types";
import type {
  JobGates,
  JobMode,
  JobStageId,
  JobState,
  JobStatus,
  JobTarget,
  StageEntry,
  StageState,
  TestReport,
} from "../../../src/modules/coverage-loads/shp/job/types";
import type { ShpPlan } from "../../../src/modules/coverage-loads/shp/types";
import { PROFILES_STORAGE_KEY } from "./db-db-sync.mocks";

export const DESA_CONNECTION = {
  host: "db-desa.example.test",
  port: "5432",
  database: "hgdesa",
  user: "cargas_cobertura",
  password: "contrasena-ficticia",
};

const PROD_CONNECTION = { ...DESA_CONNECTION, host: "db-prod.example.test", database: "hgprod" };

export function buildConnectionProfilesSeed(): { key: string; value: string } {
  const now = Date.now();
  const profiles = [DESA_CONNECTION, PROD_CONNECTION].map((connection, index) => ({
    id: `profile-cargas-${index + 1}`,
    name: `${connection.database} @ ${connection.host}:${connection.port} (${connection.user})`,
    config: {
      host: connection.host,
      port: connection.port,
      db_name: connection.database,
      user: connection.user,
      schema_name: "",
      table_name: "",
    },
    updatedAt: now - index * 60_000,
  }));
  return { key: PROFILES_STORAGE_KEY, value: JSON.stringify(profiles) };
}

const AUGUST_FILE_NAME = "IndicadoresLTE_20260801.csv";
const SEPTEMBER_FILE_NAME = "IndicadoresLTE_20260901.csv";
const SHP_FILE_NAME = "LTEUruguay_20260901.shp";

const CSV_HEADER = "Departamento;Localidad;%;Cobertura";
const SHP_SIZE_BYTES = 6 * 1024 * 1024;

function buildCsvFile(name: string, rowCount: number): { name: string; mimeType: string; buffer: Buffer } {
  const rows = Array.from({ length: rowCount }, (_, index) => `Departamento ${index % 19};Localidad ${index};${90 - (index % 40)}.5;SI`);
  return { name, mimeType: "text/csv", buffer: Buffer.from([CSV_HEADER, ...rows].join("\r\n")) };
}

export const INDICATOR_FILES = [buildCsvFile(AUGUST_FILE_NAME, 610), buildCsvFile(SEPTEMBER_FILE_NAME, 615)];

export const SHP_FILE = { name: SHP_FILE_NAME, mimeType: "application/octet-stream", buffer: Buffer.alloc(SHP_SIZE_BYTES) };

const REJECTED_ROWS: RejectedRow[] = [
  { file: SEPTEMBER_FILE_NAME, line: 41, text: "Salto;Villa Constitución;9x.5;SI", reason: 'El porcentaje "9x.5" no es un número.' },
  { file: SEPTEMBER_FILE_NAME, line: 187, text: "Rocha;La Paloma;105;SI", reason: "El porcentaje 105 supera el máximo de 100." },
  { file: SEPTEMBER_FILE_NAME, line: 402, text: "Artigas;Baltasar Brum;88.2;TAL VEZ", reason: 'La cobertura "TAL VEZ" no es SI ni NO.' },
];

const INCOMPLETE_MESSAGE = "corte 2026-09-01 incompleto: 612 de 615 filas, 3 rechazadas";

const AUGUST_CUT: CutPlan = {
  fileName: AUGUST_FILE_NAME,
  fechaact: "2026-08-01",
  totalRows: 610,
  validRows: 610,
  rejectedRows: [],
  existingRows: 610,
  incomplete: false,
  shrinks: false,
  replaceMessage: "corte 2026-08-01: 610 filas existentes serán reemplazadas por 610 nuevas",
  incompleteMessage: null,
  shrinkMessage: null,
};

const SEPTEMBER_CUT: CutPlan = {
  fileName: SEPTEMBER_FILE_NAME,
  fechaact: "2026-09-01",
  totalRows: 615,
  validRows: 612,
  rejectedRows: REJECTED_ROWS,
  existingRows: 0,
  incomplete: true,
  shrinks: false,
  replaceMessage: "corte 2026-09-01: 612 filas nuevas; no hay filas existentes para esa fecha",
  incompleteMessage: INCOMPLETE_MESSAGE,
  shrinkMessage: null,
};

const READY_PLAN: IndicatorsPlan = {
  cuts: [AUGUST_CUT, SEPTEMBER_CUT],
  fileErrors: [],
  privilegeShortfalls: [],
  canLoad: true,
  requiresAcceptShrink: false,
  hasIncompleteCut: true,
  blockers: [],
};

const SHRINKING_CUT: CutPlan = {
  ...SEPTEMBER_CUT,
  existingRows: 615,
  shrinks: true,
  replaceMessage: "corte 2026-09-01: 615 filas existentes serán reemplazadas por 612 nuevas",
  shrinkMessage: "corte 2026-09-01: el historial tiene 615 filas y quedarían 612; el corte se reduce",
};

const SHRINK_PLAN: IndicatorsPlan = {
  ...READY_PLAN,
  cuts: [SHRINKING_CUT],
  requiresAcceptShrink: true,
};

const DELETE_SHORTFALL_MESSAGE =
  "Faltan privilegios sobre historico.h_cobertura_lte_localidad: DELETE. El privilegio DELETE sobre el historial puede requerir un GRANT de un DBA.";

const NO_DELETE_PLAN: IndicatorsPlan = {
  cuts: [{ ...AUGUST_CUT, replaceMessage: "corte 2026-08-01: 610 filas existentes serán reemplazadas por 610 nuevas" }],
  fileErrors: [],
  privilegeShortfalls: [
    {
      table: "historico.h_cobertura_lte_localidad",
      tableExists: true,
      missing: ["DELETE"],
      message: DELETE_SHORTFALL_MESSAGE,
    },
  ],
  canLoad: false,
  requiresAcceptShrink: false,
  hasIncompleteCut: false,
  blockers: [DELETE_SHORTFALL_MESSAGE],
};

const LOAD_RESULT: LoadResult = {
  cuts: [
    {
      fileName: AUGUST_FILE_NAME,
      fechaact: "2026-08-01",
      replacedRows: 610,
      insertedRows: 610,
      storedRows: 610,
      rejectedRows: 0,
      incomplete: false,
      incompleteMessage: null,
    },
    {
      fileName: SEPTEMBER_FILE_NAME,
      fechaact: "2026-09-01",
      replacedRows: 0,
      insertedRows: 612,
      storedRows: 612,
      rejectedRows: 3,
      incomplete: true,
      incompleteMessage: INCOMPLETE_MESSAGE,
    },
  ],
  totalInserted: 1222,
  totalReplaced: 610,
  hasIncompleteCut: true,
  rejectedRows: REJECTED_ROWS,
};

export const IndicatorsScenario = {
  READY: { plan: READY_PLAN, result: LOAD_RESULT },
  SHRINK: { plan: SHRINK_PLAN, result: LOAD_RESULT },
  NO_DELETE: { plan: NO_DELETE_PLAN, result: LOAD_RESULT },
} as const;

export type IndicatorsScenarioData = { plan: IndicatorsPlan; result: LoadResult };

const API_ROOT = "/api/m/coverage-loads";
const REPORT_RUN_DAY = "20261019";

const REPORT_FILES = {
  localidad: { name: `reporte_cobertura_lte_localidad__${REPORT_RUN_DAY}.csv`, rows: 612 },
  mayor50: { name: `reporte_cobertura_lte_localidad_mayor50__${REPORT_RUN_DAY}.csv`, rows: 241 },
  novedad: { name: `reporte_cobertura_lte_localidad_novedad__${REPORT_RUN_DAY}.csv`, rows: 14 },
} as const;

function buildReportBody(rowCount: number): string {
  const rows = Array.from({ length: rowCount }, (_, index) => `Departamento ${index % 19};Localidad ${index};91.3;01-09-2026`);
  return ["departamento;localidad;porcentajecobertura;fecha_novedad", ...rows].join("\n");
}

function apiPattern(endpoint: string): RegExp {
  return new RegExp(String.raw`${API_ROOT}/${endpoint}(\?.*)?$`);
}

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

export async function mockIndicatorsApi(page: Page, scenario: IndicatorsScenarioData): Promise<void> {
  await page.route(apiPattern("indicators/plan"), (route) => fulfillJson(route, { success: true, plan: scenario.plan }));
  await page.route(apiPattern("indicators/load"), (route) => fulfillJson(route, { success: true, result: scenario.result }));
  await page.route(apiPattern("indicators/reports"), (route) => {
    const { kind } = route.request().postDataJSON() as { kind: keyof typeof REPORT_FILES };
    const report = REPORT_FILES[kind];
    return route.fulfill({
      status: 200,
      contentType: "text/csv",
      headers: { "Content-Disposition": `attachment; filename="${report.name}"` },
      body: buildReportBody(report.rows),
    });
  });
}

const SHP_JOB_ID = "6f1c2a40-5b7e-4d0a-9c3e-0a1b2c3d4e5f";
const SHP_TARGET: JobTarget = { table: "lte", prefix: "LTEUruguay", fechaact: "2026-09-01" };
const STARTED_AT = "2026-10-19T14:02:10.000Z";
const MS_PER_MINUTE = 60_000;
const STAGE_ORDER: JobStageId[] = ["COPYING_FILE", "READING", "STAGING", "SUBDIVIDING", "REPAIRING", "SWAPPING", "FINALIZING"];

export const SHP_PLAN_READY: ShpPlan = {
  jobId: SHP_JOB_ID,
  target: SHP_TARGET,
  defaultMode: "LOAD",
  availableModes: ["LOAD", "TEST"],
  currentRows: 18432,
  leftovers: [],
  privilegeShortfalls: [],
  blockers: [],
  expectedMs: 14 * MS_PER_MINUTE,
  canStart: true,
};

export const SHP_PLAN_BLOCKED: ShpPlan = {
  ...SHP_PLAN_READY,
  leftovers: ["shp_stage_lte", "shp_work_lte"],
  privilegeShortfalls: [
    "Faltan privilegios sobre public.lte: DELETE.",
    "Falta el privilegio CREATE sobre el esquema public (necesario para las tablas de trabajo).",
  ],
  blockers: ["Otra sesión tiene tomado el bloqueo de carga de esta tabla."],
  canStart: false,
};

interface StatusSpec {
  mode: JobMode;
  state: JobState;
  stage: JobStageId | null;
  stageStates: Partial<Record<JobStageId, StageState>>;
  overallFraction: number;
  stageFraction: number;
  elapsedMs: number;
}

function buildStages(stageStates: StatusSpec["stageStates"]): StageEntry[] {
  return STAGE_ORDER.map((id) => ({
    id,
    state: stageStates[id] ?? "PENDING",
    startedAt: null,
    endedAt: null,
    durationMs: null,
  }));
}

function buildStatus(spec: StatusSpec, overrides: Partial<JobStatus> = {}): JobStatus {
  const finished = spec.state !== "RUNNING";
  return {
    schemaVersion: 1,
    jobId: SHP_JOB_ID,
    mode: spec.mode,
    target: SHP_TARGET,
    source: { fileName: SHP_FILE_NAME, sizeBytes: SHP_SIZE_BYTES, receivedBytes: SHP_SIZE_BYTES },
    state: spec.state,
    stage: spec.stage,
    stages: buildStages(spec.stageStates),
    progress: {
      bytesRead: finished ? SHP_SIZE_BYTES : Math.round(SHP_SIZE_BYTES * 0.9),
      bytesTotal: SHP_SIZE_BYTES,
      rowsCopied: 18420,
      piecesTotal: 184320,
      piecesRepaired: finished ? 184320 : 114278,
      stageFraction: spec.stageFraction,
      overallFraction: spec.overallFraction,
    },
    expectedMs: 14 * MS_PER_MINUTE,
    startedAt: STARTED_AT,
    updatedAt: new Date(Date.parse(STARTED_AT) + spec.elapsedMs).toISOString(),
    heartbeatAt: null,
    pid: null,
    nodeVersion: null,
    gates: null,
    testReport: null,
    leftovers: [],
    cancelRequested: false,
    error: null,
    ...overrides,
  };
}

const PASSED_GATES: JobGates = { stagingRows: 18420, maxVertices: 247, invalidPieces: 0, areaRelativeDiff: 3.1e-9, passed: true };
const FAILED_GATES: JobGates = { stagingRows: 18420, maxVertices: 247, invalidPieces: 37, areaRelativeDiff: 4.2e-5, passed: false };

const ALL_DONE: StatusSpec["stageStates"] = Object.fromEntries(STAGE_ORDER.map((id) => [id, "DONE"]));
const THROUGH_REPAIR: StatusSpec["stageStates"] = {
  COPYING_FILE: "DONE",
  READING: "DONE",
  STAGING: "DONE",
  SUBDIVIDING: "DONE",
  REPAIRING: "DONE",
  FINALIZING: "DONE",
  SWAPPING: "SKIPPED",
};

const TEST_REPORT: TestReport = {
  current: { rows: 18432, vertices: 9412330, area: 176214998761 },
  new: { rows: 18420, vertices: 9409871, area: 176215204115 },
  diff: { rows: -12, vertices: -2459, area: 205354 },
};

export const SHP_STATUS_RUNNING = buildStatus({
  mode: "LOAD",
  state: "RUNNING",
  stage: "REPAIRING",
  stageStates: { COPYING_FILE: "DONE", READING: "DONE", STAGING: "DONE", SUBDIVIDING: "DONE", REPAIRING: "RUNNING" },
  overallFraction: 0.45,
  stageFraction: 0.62,
  elapsedMs: 6 * MS_PER_MINUTE + 32_000,
});

export const SHP_STATUS_SUCCEEDED = buildStatus(
  { mode: "LOAD", state: "SUCCEEDED", stage: null, stageStates: ALL_DONE, overallFraction: 1, stageFraction: 1, elapsedMs: 12 * MS_PER_MINUTE + 48_000 },
  { gates: PASSED_GATES }
);

export const SHP_STATUS_TEST_SUCCEEDED = buildStatus(
  { mode: "TEST", state: "SUCCEEDED", stage: null, stageStates: THROUGH_REPAIR, overallFraction: 1, stageFraction: 1, elapsedMs: 9 * MS_PER_MINUTE + 5_000 },
  { gates: PASSED_GATES, testReport: TEST_REPORT }
);

export const SHP_STATUS_GATE_FAILED = buildStatus(
  {
    mode: "LOAD",
    state: "FAILED",
    stage: "REPAIRING",
    stageStates: { COPYING_FILE: "DONE", READING: "DONE", STAGING: "DONE", SUBDIVIDING: "DONE", REPAIRING: "FAILED" },
    overallFraction: 0.6,
    stageFraction: 1,
    elapsedMs: 8 * MS_PER_MINUTE + 20_000,
  },
  {
    gates: FAILED_GATES,
    error: {
      code: "GATE_FAILED",
      stage: "REPAIRING",
      message: "Piezas inválidas tras la reparación: 37 (máximo permitido: 0). Diferencia relativa de área: 4.20e-5 (máximo permitido: 1.00e-6).",
    },
  }
);

const RUNNING_LOG = [
  "2026-10-19 14:02:11 INFO  Carga iniciada: public.lte desde LTEUruguay_20260901.shp",
  "2026-10-19 14:02:12 INFO  Bloqueo de la tabla public.lte tomado",
  "2026-10-19 14:03:40 INFO  Lectura del SHP completa: 18420 registros",
  "2026-10-19 14:04:55 INFO  Tabla de trabajo shp_stage_lte cargada: 18420 filas",
  "2026-10-19 14:06:31 INFO  Subdivisión completa: 184320 piezas",
  "2026-10-19 14:08:42 INFO  Reparando geometrías: 114278 de 184320 piezas",
].join("\n");

const FINISHED_LOG = [
  RUNNING_LOG,
  "2026-10-19 14:12:50 INFO  Verificaciones de calidad superadas",
  "2026-10-19 14:14:58 INFO  Carga completada",
].join("\n");

const FAILED_LOG = [RUNNING_LOG, "2026-10-19 14:10:30 ERROR Verificaciones de calidad no superadas"].join("\n");

export const SHP_LOGS = { running: RUNNING_LOG, finished: FINISHED_LOG, failed: FAILED_LOG };

export interface ShpScenario {
  plan: ShpPlan;
  status: JobStatus;
  log: string;
}

export async function mockShpApi(page: Page, scenario: ShpScenario): Promise<void> {
  await page.route(apiPattern("shp/upload"), (route) =>
    fulfillJson(route, { success: true, jobId: SHP_JOB_ID, target: SHP_TARGET, sizeBytes: SHP_SIZE_BYTES })
  );
  await page.route(apiPattern("shp/plan"), (route) => fulfillJson(route, { success: true, plan: scenario.plan }));
  await page.route(apiPattern("shp/start"), (route) => fulfillJson(route, { success: true, jobId: SHP_JOB_ID }));
  await page.route(apiPattern("shp/status"), (route) => fulfillJson(route, { success: true, status: scenario.status, stale: false }));
  await page.route(apiPattern("shp/jobs"), (route) => fulfillJson(route, { success: true, jobs: [] }));
  await page.route(apiPattern("shp/log"), (route) =>
    route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: scenario.log })
  );
  await page.route(apiPattern("shp/cancel"), (route) => fulfillJson(route, { success: true, jobId: SHP_JOB_ID, outcome: "REQUESTED" }));
  await page.route(apiPattern("shp/discard"), (route) => fulfillJson(route, { success: true }));
}

export const SHP_JOB_MEMORY_KEY = "coverage-loads.shp.activeJobId";
export const SHP_JOB_ID_VALUE = SHP_JOB_ID;
