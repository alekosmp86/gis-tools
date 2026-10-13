import { SCHEMA_PRIVILEGE_REQUIRED, TARGET_SCHEMA } from "../constants";
import { JOB_MODE } from "../job/types.ts";
import type { JobStatus } from "../job/types.ts";
import type { ShpDbInspection, ShpPlan } from "../types";
import type { TableLockView } from "./tableLock";

const TABLE_MISSING = (table: string) => `La tabla ${TARGET_SCHEMA}.${table} no existe en esta base de datos.`;
const POSTGIS_MISSING = "La extensión PostGIS no está instalada en esta base de datos.";
const ADVISORY_HELD = "Otra sesión tiene tomado el bloqueo de carga de esta tabla.";
const LOCK_OTHER = (table: string) => `Ya hay una carga de ${table} en curso.`;
const LOCK_OWN = "Esta carga ya fue iniciada.";
const SCHEMA_SHORTFALL = `Falta el privilegio ${SCHEMA_PRIVILEGE_REQUIRED} sobre el esquema ${TARGET_SCHEMA} (necesario para las tablas de trabajo).`;
const TABLE_SHORTFALL = (table: string, missing: readonly string[]) =>
  `Faltan privilegios sobre ${TARGET_SCHEMA}.${table}: ${missing.join(", ")}.`;

function listBlockers(status: JobStatus, inspection: ShpDbInspection, lock: TableLockView): string[] {
  const table = status.target.table;
  const blockers: string[] = [];
  if (!inspection.tableExists) blockers.push(TABLE_MISSING(table));
  if (!inspection.postgisAvailable) blockers.push(POSTGIS_MISSING);
  if (inspection.advisoryLockHeld) blockers.push(ADVISORY_HELD);
  if (lock === "OTHER") blockers.push(LOCK_OTHER(table));
  if (lock === "OWN") blockers.push(LOCK_OWN);
  return blockers;
}

function listShortfalls(table: string, inspection: ShpDbInspection): string[] {
  const shortfalls: string[] = [];
  if (inspection.missingTablePrivileges.length > 0) shortfalls.push(TABLE_SHORTFALL(table, inspection.missingTablePrivileges));
  if (!inspection.schemaCreateGranted) shortfalls.push(SCHEMA_SHORTFALL);
  return shortfalls;
}

/** Pure: what the database and the lock folder said, turned into the plan the client sees. */
export function buildShpPlan(status: JobStatus, inspection: ShpDbInspection, lock: TableLockView): ShpPlan {
  const blockers = listBlockers(status, inspection, lock);
  const privilegeShortfalls = listShortfalls(status.target.table, inspection);
  return {
    jobId: status.jobId,
    target: status.target,
    defaultMode: JOB_MODE.LOAD,
    availableModes: [JOB_MODE.LOAD, JOB_MODE.TEST],
    currentRows: inspection.currentRows,
    leftovers: inspection.leftovers,
    privilegeShortfalls,
    blockers,
    expectedMs: status.expectedMs,
    canStart: blockers.length === 0 && privilegeShortfalls.length === 0,
  };
}
