import type { ClientConnection, JobStatusView, StartRequest } from "@/modules/routine-jobs/ui/clientTypes";
import type { CargarPadronesRunSnapshot } from "@/modules/routine-jobs/ui/cargarPadronesRunStore";
import type { SavedDbProfile } from "@/core/types/db";
import type { CargarPadronesResult, TypeReport } from "@/modules/routine-jobs/jobs/cargar-padrones/types";

export const SECRET = "s3cr3t-pw-9";

export function connectionOf(overrides: Partial<ClientConnection> = {}): ClientConnection {
  return { host: "db.example.test", port: "5432", db_name: "gis_dev", user: "carto", password: SECRET, ...overrides };
}

export function profileOf(name: string, overrides: Partial<SavedDbProfile["config"]> = {}): SavedDbProfile {
  return {
    id: name,
    name,
    updatedAt: 1,
    config: { host: "db.example.test", port: "5432", db_name: "gis_dev", user: "carto", schema_name: "", table_name: "", ...overrides },
  };
}

export function requestOf(overrides: Partial<StartRequest> = {}): StartRequest {
  return {
    connection: connectionOf(),
    schema: "catastro",
    ruralTable: "padron_rural",
    urbanoTable: "padron_urbano",
    targetTable: "padron_destino",
    options: { repair: true, clearMode: "delete", resetSequences: true },
    dryRun: false,
    confirm: false,
    ...overrides,
  };
}

export function typeReportOf(base: number, overrides: Partial<TypeReport> = {}): TypeReport {
  return {
    rowsRead: base + 1,
    groups: base + 2,
    rowsMerged: base + 3,
    repaired: base + 4,
    insertedInvalid: 0,
    repairedInUnion: 0,
    noGeometry: base + 5,
    nullKeyRows: base + 6,
    attributeConflicts: 0,
    attributeConflictSamples: [],
    inserted: base + 7,
    ...overrides,
  };
}

export function resultOf(overrides: Partial<CargarPadronesResult> = {}): CargarPadronesResult {
  return {
    dryRun: false,
    targetModified: true,
    outcomeUnknown: false,
    report: { rural: typeReportOf(100), urbano: typeReportOf(200) },
    totals: { rowsRead: 301, groups: 302, rowsMerged: 303, inserted: 304 },
    ambiguousLocalityCodes: [],
    warnings: [],
    stepTimings: [
      { label: "Leer rurales", ms: 1234 },
      { label: "Insertar destino", ms: 2000 },
    ],
    analyze: { status: "ok" },
    ...overrides,
  };
}

export function jobOf(overrides: Partial<JobStatusView> = {}): JobStatusView {
  return { jobId: "job-42", state: "RUNNING", step: "Leyendo tablas", current: 2, total: 5, dryRun: false, startedAt: 1000, ...overrides };
}

export function snapshotOf(overrides: Partial<CargarPadronesRunSnapshot> = {}): CargarPadronesRunSnapshot {
  return { phase: "idle", ...overrides };
}

/** Removes every value="..." attribute so a secret typed into an input cannot count as visible text. */
export function withoutValueAttributes(html: string): string {
  return html.replace(/\svalue="[^"]*"/g, "");
}

export function openingTags(html: string, tagName: string): string[] {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "g")) ?? [];
}

/** The attribute string of the first <button> whose inner markup contains the text, or null. */
export function buttonAttributes(html: string, text: string): string | null {
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (match[2].includes(text)) return match[1];
  }
  return null;
}

export const isDisabledAttributes = (attributes: string): boolean => /\sdisabled(=""|\s|$)/.test(` ${attributes}`);
