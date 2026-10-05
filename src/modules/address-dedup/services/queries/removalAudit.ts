import { buildRemovalReference, RemovalRefusedError } from "../../domain/removal";
import { ADVISORY_LOCK_NAMESPACE, AUDIT_REQUIRED_COLUMNS, AUDIT_TABLE, AUDIT_TABLE_NAME, RemovalTable } from "../../removalConstants";
import type { RemovalAuditRecord, RemovalConfirmation, RemovalPlan, RemovalResult } from "../../removalTypes";
import type { DuplicateAnalysisParameters } from "../../types";
import type { Queryable } from "./runDuplicateAnalysis";

/** The audit table is `carto.baja_direccion_operacion`; the app only reads and inserts, never creates it. */
const AUDIT_TABLE_EXISTS_SQL = `SELECT to_regclass('${AUDIT_TABLE}') IS NOT NULL AS present`;

const AUDIT_COLUMNS_SQL = `
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'carto' AND table_name = $1`;

const AUDIT_PRIVILEGES_SQL = `
SELECT has_table_privilege(current_user, $1, 'SELECT') AS can_select,
       has_table_privilege(current_user, $1, 'INSERT') AS can_insert`;

const DELETE_PRIVILEGE_SQL = `
SELECT t AS table_name FROM unnest($1::text[]) AS t
WHERE NOT has_table_privilege(current_user, t, 'DELETE')`;

const FIND_OPERATION_SQL = `
SELECT resultado,
       (referencia = $2 AND incluir_internas = $3::boolean AND huella = $4 AND responsable = $5 AND motivo = $6) AS same_parameters
FROM ${AUDIT_TABLE}
WHERE operacion = $1::uuid`;

const RECORD_OPERATION_SQL = `
INSERT INTO ${AUDIT_TABLE} (operacion, referencia, incluir_internas, huella, responsable, motivo, ejecutor_bd, resultado)
VALUES ($1::uuid, $2, $3::boolean, $4, $5, $6, current_user, $7::jsonb)`;

/** The removal never includes internal units, so every audit row says so. */
const INCLUDES_INTERNAL_UNITS = false;

const DELETION_TABLES: ReadonlyArray<string> = Object.values(RemovalTable).map((table) => `carto.${table}`);

/** Serialises equal operation ids; released automatically when the transaction ends. */
export async function acquireOperationLock(queryable: Queryable, operationId: string): Promise<void> {
  await queryable.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
    ADVISORY_LOCK_NAMESPACE,
    operationId,
  ]);
}

async function assertAuditTableExists(queryable: Queryable): Promise<void> {
  const result = await queryable.query(AUDIT_TABLE_EXISTS_SQL, []);
  if (!(result.rows[0] as { present: boolean }).present) {
    throw new RemovalRefusedError(
      `La tabla de auditoria ${AUDIT_TABLE} no existe en esta base. Debe crearla un administrador antes de ejecutar bajas.`
    );
  }
}

async function assertAuditTableShape(queryable: Queryable): Promise<void> {
  const result = await queryable.query(AUDIT_COLUMNS_SQL, [AUDIT_TABLE_NAME]);
  const present = new Set(result.rows.map((row) => (row as { column_name: string }).column_name));
  const missing = AUDIT_REQUIRED_COLUMNS.filter((column) => !present.has(column));
  if (missing.length > 0) {
    throw new RemovalRefusedError(
      `La tabla de auditoria ${AUDIT_TABLE} existe con otra estructura; faltan columnas: ${missing.join(", ")}.`
    );
  }
}

async function assertAuditPrivileges(queryable: Queryable): Promise<void> {
  const result = await queryable.query(AUDIT_PRIVILEGES_SQL, [AUDIT_TABLE]);
  const privileges = result.rows[0] as { can_select: boolean; can_insert: boolean };
  const missing = [
    ...(privileges.can_select ? [] : ["SELECT"]),
    ...(privileges.can_insert ? [] : ["INSERT"]),
  ];
  if (missing.length > 0) {
    throw new RemovalRefusedError(
      `El usuario conectado no tiene el privilegio ${missing.join(" ni ")} sobre ${AUDIT_TABLE}.`
    );
  }
}

async function assertDeletePrivileges(queryable: Queryable): Promise<void> {
  const result = await queryable.query(DELETE_PRIVILEGE_SQL, [DELETION_TABLES]);
  const lacking = result.rows.map((row) => (row as { table_name: string }).table_name);
  if (lacking.length > 0) {
    throw new RemovalRefusedError(
      `El usuario conectado no tiene el privilegio DELETE sobre: ${lacking.join(", ")}.`
    );
  }
}

/**
 * Everything the removal needs from the database, checked before any lock or delete: the audit
 * table exists with every column and the role can read and insert into it, and the role can delete
 * from the seven tables. Each failure is a refusal with nothing written.
 */
export async function assertRemovalPreconditions(queryable: Queryable): Promise<void> {
  await assertAuditTableExists(queryable);
  await assertAuditTableShape(queryable);
  await assertAuditPrivileges(queryable);
  await assertDeletePrivileges(queryable);
}

function toStoredResult(record: RemovalAuditRecord): RemovalResult {
  return {
    operationId: record.operationId,
    fingerprint: record.fingerprint,
    state: record.state,
    counts: record.counts,
    deletedByTable: record.deletedByTable,
    pending: record.pending,
    recovered: true,
  };
}

/**
 * Returns the stored result when this operation id already ran with identical parameters, null
 * when it never ran, and refuses when it ran with anything different.
 */
export async function findPriorOperation(
  queryable: Queryable,
  confirmation: RemovalConfirmation,
  parameters: DuplicateAnalysisParameters
): Promise<RemovalResult | null> {
  const result = await queryable.query(FIND_OPERATION_SQL, [
    confirmation.operationId,
    buildRemovalReference(parameters),
    INCLUDES_INTERNAL_UNITS,
    confirmation.expectedFingerprint,
    confirmation.responsable,
    confirmation.motivo,
  ]);
  const row = result.rows[0] as { resultado: RemovalAuditRecord; same_parameters: boolean } | undefined;
  if (!row) return null;
  if (!row.same_parameters) {
    throw new RemovalRefusedError("El UUID ya fue utilizado con otros parametros.");
  }
  return toStoredResult(row.resultado);
}

export async function recordOperation(
  queryable: Queryable,
  confirmation: RemovalConfirmation,
  parameters: DuplicateAnalysisParameters,
  plan: RemovalPlan,
  removalResult: RemovalResult
): Promise<void> {
  const record: RemovalAuditRecord = {
    ...removalResult,
    provinceId: parameters.provinceId,
    protectedSiblingRemovesLone: parameters.protectedSiblingRemovesLone,
    targets: plan.targets,
  };
  await queryable.query(RECORD_OPERATION_SQL, [
    confirmation.operationId,
    buildRemovalReference(parameters),
    INCLUDES_INTERNAL_UNITS,
    confirmation.expectedFingerprint,
    confirmation.responsable,
    confirmation.motivo,
    JSON.stringify(record),
  ]);
}
