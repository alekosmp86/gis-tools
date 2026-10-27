import type { ActualizarJobStatusView, ActualizarStartRequest, ClientConnection } from "@/modules/routine-jobs/ui/clientTypes";
import type { ActualizarPadronRunSnapshot } from "@/modules/routine-jobs/ui/actualizarPadronRunStore";
import type { ActualizarPadronResult } from "@/modules/routine-jobs/jobs/actualizar-padron/types";

export const ACTUALIZAR_SECRET = "s3cr3t-pw-9";

function actualizarConnectionOf(overrides: Partial<ClientConnection> = {}): ClientConnection {
  return { host: "db.example.test", port: "5432", db_name: "gis_dev", user: "carto", password: ACTUALIZAR_SECRET, ...overrides };
}

export function actualizarRequestOf(overrides: Partial<ActualizarStartRequest> = {}): ActualizarStartRequest {
  return {
    connection: actualizarConnectionOf(),
    stagingSchema: "bdj_carto",
    stagingTable: "catastro_paispadron_stg",
    workSchema: "carto",
    cartoSchema: "carto",
    workTable: "padron_trabajo",
    padronTable: "padron",
    provinceTable: "province",
    localityTable: "cadastral_locality",
    options: { clearMode: "delete" },
    dryRun: false,
    confirm: true,
    ...overrides,
  };
}

export function actualizarResultOf(overrides: Partial<ActualizarPadronResult> = {}): ActualizarPadronResult {
  return {
    dryRun: false,
    tempModified: true,
    padronModified: false,
    outcomeUnknown: false,
    totals: { rowsRead: 1000, accepted: 950, written: 950, repaired: 4, skipped: 50 },
    skipped: {
      byReason: {
        PROVINCIA_NO_ENCONTRADA: 0,
        PROVINCIA_AMBIGUA: 0,
        LOCALIDAD_NO_ENCONTRADA: 20,
        LOCALIDAD_AMBIGUA: 0,
        CLAVE_NULA: 5,
        SIN_GEOMETRIA: 10,
        CLAVE_DUPLICADA: 15,
      },
      byDepartment: [
        { name: "LA PAZ", count: 30 },
        { name: null, count: 20 },
      ],
      byLocality: [{ name: "VILLA", count: 12 }],
      byLocalityAndReason: [],
      samples: [{ department: "LA PAZ", locality: "VILLA", padron: "1234", reason: "LOCALIDAD_NO_ENCONTRADA" }],
      collidingKeys: [{ typePadron: "URBANO", idProvince: 2, idCadastralLocality: 7, number: "55", rows: 2 }],
      collidingKeyCount: 1,
    },
    warnings: [],
    stepTimings: [
      { label: "Cargar tabla de trabajo", ms: 1234 },
      { label: "Analizar tabla de trabajo", ms: 2000 },
    ],
    analyze: { status: "ok" },
    ...overrides,
  };
}

export function actualizarJobOf(overrides: Partial<ActualizarJobStatusView> = {}): ActualizarJobStatusView {
  return {
    jobId: "job-42",
    state: "RUNNING",
    step: "Cargar tabla de trabajo",
    current: 2,
    total: 5,
    dryRun: false,
    startedAt: 1000,
    ...overrides,
  };
}

export function actualizarSnapshotOf(overrides: Partial<ActualizarPadronRunSnapshot> = {}): ActualizarPadronRunSnapshot {
  return { phase: "idle", ...overrides };
}
