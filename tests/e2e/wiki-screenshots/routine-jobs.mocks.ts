import type { Page, Route } from "@playwright/test";
import type { CatalogTable, ResolvedColumn, TableListing } from "../../../src/core/types/tableCatalog";
import { AnalyzeStatus } from "../../../src/core/types/replace";
import { MONTHLY_TABLES } from "../../../src/modules/routine-jobs/config/monthlyTables";
import {
  ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE,
  GEOMETRY_STATE,
  PAIR_STATUS,
  PAIR_TIER,
  SKIP_REASON,
  type ActualizarTableRole,
} from "../../../src/modules/routine-jobs/jobs/actualizar-padron/constants";
import type {
  ActualizarPadronResult,
  ActualizarTargetReport,
  PadronGeometryChange,
  PadronInserted,
  PadronPair,
  SkippedReport,
} from "../../../src/modules/routine-jobs/jobs/actualizar-padron/types";
import { REQUIRED_COLUMNS_BY_ROLE, type TableRole } from "../../../src/modules/routine-jobs/jobs/cargar-padrones/constants";
import type { CargarPadronesResult, TypeReport } from "../../../src/modules/routine-jobs/jobs/cargar-padrones/types";
import type {
  ActualizarJobStatusView,
  ClientConnection,
  JobStatusView,
} from "../../../src/modules/routine-jobs/ui/clientTypes";

export const FAKE_CONNECTION: ClientConnection = {
  host: "db.example.test",
  port: "5432",
  db_name: "gis_dev",
  user: "carto",
  password: "contrasena-ficticia",
};

const API_ROOT = "/api/m/routine-jobs";
const GEOMETRY_COLUMNS: ReadonlySet<string> = new Set(["geom", "geometry"]);
const NUMERIC_COLUMNS: ReadonlySet<string> = new Set(["gid", "id", "id_province", "id_cadastral_locality", "id_territorial_unit_type"]);
const CARGAR_JOB_ID = "job-cargar-padrones-0001";
const ACTUALIZAR_JOB_ID = "job-actualizar-padron-0001";
const PLAN_ID = "plan-2026-11-09-7f3a9c";
const MS_PER_SECOND = 1000;

const tableOf = (name: string): CatalogTable => ({ name, kind: "TABLE" });

const SCHEMA_TABLES: Record<string, CatalogTable[]> = {
  [MONTHLY_TABLES.cargarPadrones.schema]: [
    "catastro_paislocalidades",
    "catastro_paisrural",
    "catastro_paisurbano",
    MONTHLY_TABLES.actualizarPadrones.staging.table,
  ].map(tableOf),
  [MONTHLY_TABLES.actualizarPadrones.target.schema]: [
    "addresses_master",
    "cadastral_locality",
    MONTHLY_TABLES.actualizarPadrones.target.table,
    MONTHLY_TABLES.actualizarPadrones.province.table,
    MONTHLY_TABLES.actualizarPadrones.locality.table,
    MONTHLY_TABLES.actualizarPadrones.type.table,
  ].map(tableOf),
};

const resolvedColumnOf = (logical: string): ResolvedColumn => {
  const dataType = GEOMETRY_COLUMNS.has(logical) ? "geometry" : NUMERIC_COLUMNS.has(logical) ? "integer" : "text";
  return { logical, status: "resolved", column: logical, dataType };
};

function requiredColumnsOf(role: string): readonly string[] {
  const cargar = REQUIRED_COLUMNS_BY_ROLE[role as TableRole];
  if (cargar !== undefined) return cargar;
  return ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE[role as ActualizarTableRole] ?? [];
}

const apiPattern = (endpoint: string): RegExp => new RegExp(String.raw`${API_ROOT}/${endpoint}(\?.*)?$`);

const fulfillJson = (route: Route, body: unknown): Promise<void> =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function mockCatalog(page: Page): Promise<void> {
  await page.route(apiPattern("catalog/tables"), (route) => {
    const { schema } = route.request().postDataJSON() as { schema: string };
    const tables = SCHEMA_TABLES[schema];
    const listing: TableListing = { schemaExists: tables !== undefined, tables: tables ?? [] };
    return fulfillJson(route, { success: true, ...listing });
  });
  await page.route(apiPattern("catalog/columns"), (route) => {
    const { role } = route.request().postDataJSON() as { role: string };
    return fulfillJson(route, { success: true, columns: requiredColumnsOf(role).map(resolvedColumnOf) });
  });
}

function typeReportOf(overrides: Partial<TypeReport>): TypeReport {
  return {
    rowsRead: 0,
    groups: 0,
    rowsMerged: 0,
    repaired: 0,
    insertedInvalid: 0,
    repairedInUnion: 0,
    noGeometry: 0,
    nullKeyRows: 0,
    attributeConflicts: 0,
    attributeConflictSamples: [],
    inserted: 0,
    ...overrides,
  };
}

const RURAL_REPORT = typeReportOf({ rowsRead: 48210, repaired: 37, noGeometry: 12, groups: 47950, rowsMerged: 260, inserted: 47950 });
const URBANO_REPORT = typeReportOf({
  rowsRead: 1284512,
  repaired: 412,
  noGeometry: 25,
  nullKeyRows: 3,
  groups: 1279870,
  rowsMerged: 4642,
  inserted: 1279870,
});

const CARGAR_TIMINGS = [
  { label: "Vaciar la tabla destino", ms: 1840 },
  { label: "Cargar padrón rural", ms: 9320 },
  { label: "Cargar padrón urbano", ms: 61450 },
  { label: "Actualizar estadísticas", ms: 4210 },
];

function cargarResultOf(dryRun: boolean): CargarPadronesResult {
  return {
    dryRun,
    targetModified: !dryRun,
    outcomeUnknown: false,
    report: { rural: RURAL_REPORT, urbano: URBANO_REPORT },
    totals: { rowsRead: 1332722, groups: 1327820, rowsMerged: 4902, inserted: 1327820 },
    ambiguousLocalityCodes: [],
    ambiguousLocalityTotal: 0,
    warnings: dryRun
      ? [
          "449 geometrías inválidas del origen se repararon con ST_MakeValid antes de agrupar.",
          "37 filas rurales y 25 filas urbanas no tienen geometría: no se cargaron.",
        ]
      : [],
    stepTimings: CARGAR_TIMINGS,
    analyze: dryRun
      ? { status: AnalyzeStatus.SKIPPED }
      : { status: AnalyzeStatus.OK },
  };
}

function cargarJobOf(dryRun: boolean): JobStatusView {
  const startedAt = Date.now() - 80 * MS_PER_SECOND;
  return {
    jobId: CARGAR_JOB_ID,
    state: "DONE",
    step: null,
    dryRun,
    startedAt,
    finishedAt: startedAt + 77 * MS_PER_SECOND,
    result: cargarResultOf(dryRun),
  };
}

export async function mockCargarPadronesApi(page: Page): Promise<void> {
  let dryRun = true;
  await mockCatalog(page);
  await page.route(apiPattern("cargar-padrones/start"), (route) => {
    dryRun = (route.request().postDataJSON() as { dryRun: boolean }).dryRun;
    return fulfillJson(route, { success: true, jobId: CARGAR_JOB_ID });
  });
  await page.route(apiPattern("cargar-padrones/status"), (route) =>
    fulfillJson(route, { success: true, job: cargarJobOf(dryRun) }),
  );
}

const zeroReasonCounts = (): SkippedReport["byReason"] =>
  Object.fromEntries(Object.values(SKIP_REASON).map((reason) => [reason, 0])) as SkippedReport["byReason"];

const SKIPPED: SkippedReport = {
  byReason: {
    ...zeroReasonCounts(),
    [SKIP_REASON.LOCALIDAD_NO_ENCONTRADA]: 2140,
    [SKIP_REASON.LOCALIDAD_AMBIGUA]: 320,
    [SKIP_REASON.SIN_GEOMETRIA]: 150,
  },
  byDepartment: [
    { name: "CANELONES", count: 1240 },
    { name: "MALDONADO", count: 610 },
    { name: "ROCHA", count: 420 },
    { name: "SALTO", count: 340 },
  ],
  byLocality: [
    { name: "Ciudad de la Costa", count: 980 },
    { name: "Punta del Este", count: 410 },
    { name: "La Paloma", count: 380 },
    { name: "Termas del Daymán", count: 260 },
  ],
  byLocalityAndReason: [
    { department: "CANELONES", locality: "Ciudad de la Costa", reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, count: 980 },
    { department: "MALDONADO", locality: "Punta del Este", reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, count: 410 },
    { department: "ROCHA", locality: "La Paloma", reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, count: 380 },
  ],
  samples: [],
  skippedRows: [],
  collidingKeys: [],
  collidingKeyCount: 0,
};

const insertedOf = (id: number, locality: string, number: string): PadronInserted => ({
  id,
  department: "CANELONES",
  locality,
  typePadron: "URBANO",
  provinceId: 3,
  localityId: 120,
  number,
});

const pendingGeometryOf = (index: number, number: string): PadronGeometryChange => ({
  department: "SALTO",
  locality: null,
  typePadron: "RURAL",
  provinceId: 14,
  localityId: null,
  number,
  oldId: 48100 + index,
  state: GEOMETRY_STATE.PENDING,
  oldAreaM2: 1250000,
  newAreaM2: 1480000 + index * 90000,
  areaChangePct: 18.4 + index * 3.2,
  centroidLat: -31.38 - index * 0.01,
  centroidLon: -57.96 + index * 0.01,
});

const PENDING_GEOMETRIES: PadronGeometryChange[] = [
  pendingGeometryOf(0, "1345"),
  pendingGeometryOf(1, "2210"),
  pendingGeometryOf(2, "3098"),
  pendingGeometryOf(3, "4127"),
];

function pairOf(status: PadronPair["status"], oldNumber: string, newNumber: string, oldId: number): PadronPair {
  const pending = status === PAIR_STATUS.NOT_APPLIED_PENDING;
  return {
    status,
    tier: pending ? PAIR_TIER.LOOSE : PAIR_TIER.STRICT,
    changes: ["number"],
    oldId,
    old: { typePadron: "URBANO", provinceId: 3, localityId: 120, number: oldNumber, department: "CANELONES", locality: "Pando" },
    new: { typePadron: "URBANO", provinceId: 3, localityId: 120, number: newNumber, department: "CANELONES", locality: "Pando" },
    overlap: pending ? 0.91 : 0.99,
    areaRatio: pending ? 1.06 : 1.01,
    oldAreaM2: 640,
    newAreaM2: pending ? 678 : 646,
    areaChangePct: pending ? 5.9 : 0.9,
    centroidLat: -34.72,
    centroidLon: -55.96,
  };
}

const PAIRS: PadronPair[] = [
  pairOf(PAIR_STATUS.APPLIED, "5501", "5501A", 71001),
  pairOf(PAIR_STATUS.APPLIED, "5520", "5520A", 71002),
  pairOf(PAIR_STATUS.NOT_APPLIED_PENDING, "6014", "6014B", 71003),
  pairOf(PAIR_STATUS.NOT_APPLIED_PENDING, "6120", "6122", 71004),
];

const TARGET_TABLE = `${MONTHLY_TABLES.actualizarPadrones.target.schema}.${MONTHLY_TABLES.actualizarPadrones.target.table}`;

const TARGET: ActualizarTargetReport = {
  table: TARGET_TABLE,
  schema: MONTHLY_TABLES.actualizarPadrones.target.schema,
  inserted: 842,
  insertedList: [insertedOf(900001, "Pando", "7001"), insertedOf(900002, "Pando", "7002"), insertedOf(900003, "Toledo", "310")],
  updated: 336,
  updateApplied: true,
  unchanged: 1320100,
  unchangedWithinTolerance: 3400,
  changed: 340,
  missing: 0,
  missingSamples: [],
  missingByClass: { REPLACED_ONE: 0, SUBDIVIDED: 0, PARTIAL: 0, ORPHAN: 0 },
  missingReview: [],
  ambiguous: 0,
  ambiguousSamples: [],
  geometryChanges: PENDING_GEOMETRIES,
  geometryPending: 4,
  pairs: PAIRS,
  pairsTotal: 4,
  pairsApplied: 2,
  pairsLoose: 2,
  pairsPending: 2,
  pairsNotApplied: 0,
  choicesUnapplied: 0,
  removed: 0,
};

const ACTUALIZAR_TIMINGS = [
  { label: "Leer origen y destino", ms: 18400 },
  { label: "Clasificar padrones", ms: 52100 },
  { label: "Aplicar cambios", ms: 31800 },
];

function actualizarResultOf(dryRun: boolean): ActualizarPadronResult {
  return {
    dryRun,
    targetModified: !dryRun,
    outcomeUnknown: false,
    totals: { rowsRead: 1327820, candidates: 1325210, repaired: 0, skipped: 2610 },
    skipped: SKIPPED,
    target: TARGET,
    ...(dryRun
      ? { planId: PLAN_ID }
      : {
          backup: {
            token: "backup-token-0001",
            fileName: "padron-revert-carto-padron-20261109-104200.sql.gz",
            bytes: 3_460_000,
            counts: { updated: 336, paired: 2, inserted: 842, addressMasterRows: 0, deleted: 0 },
          },
        }),
    warnings: dryRun
      ? ["Hay 2610 filas de origen omitidas: ver el motivo en la tabla de filas omitidas.", "4 geometrías cambiaron más que el umbral y quedan pendientes."]
      : [],
    stepTimings: ACTUALIZAR_TIMINGS,
  };
}

function actualizarJobOf(dryRun: boolean): ActualizarJobStatusView {
  const startedAt = Date.now() - 110 * MS_PER_SECOND;
  return {
    jobId: ACTUALIZAR_JOB_ID,
    state: "DONE",
    step: null,
    dryRun,
    startedAt,
    finishedAt: startedAt + 102 * MS_PER_SECOND,
    result: actualizarResultOf(dryRun),
  };
}

export async function mockActualizarPadronApi(page: Page): Promise<void> {
  let dryRun = true;
  await mockCatalog(page);
  await page.route(apiPattern("actualizar-padron/start"), (route) => {
    dryRun = (route.request().postDataJSON() as { dryRun: boolean }).dryRun;
    return fulfillJson(route, { success: true, jobId: ACTUALIZAR_JOB_ID });
  });
  await page.route(apiPattern("actualizar-padron/status"), (route) =>
    fulfillJson(route, { success: true, job: actualizarJobOf(dryRun) }),
  );
  await page.route(apiPattern("actualizar-padron/backup"), (route) =>
    route.fulfill({ status: 200, contentType: "application/gzip", body: Buffer.from("respaldo ficticio") }),
  );
  await page.route(apiPattern("actualizar-padron/pending-csv"), (route) =>
    route.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: "padron\r\n1345\r\n" }),
  );
}
