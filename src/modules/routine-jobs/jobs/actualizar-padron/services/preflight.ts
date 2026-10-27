import { buildQualifiedTableLabel, resolveSchemaName } from "@/core/services/sqlStatements";
import { GENERIC_SRID, PADRON_COLUMN, PRIVILEGE, WORK_COLUMN } from "../constants";
import { parseGeometryType } from "../domain/geometryType";
import type { TableLayout } from "../domain/layouts";
import { buildStagingCountSql, buildStagingSridProbeSql } from "../domain/populateSql";
import {
  isSameSequence,
  parseSequenceName,
  sequenceLabelOf,
  sequenceReferenceOf,
  type SequenceReference,
} from "../domain/sequenceReference";
import type { ActualizarPadronParams, RunSession } from "../types";
import type { ResolvedActualizarLayouts } from "./resolveLayouts";

const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la actualización para escribir en la tabla de trabajo. Sin confirmación solo se permite el análisis sin cargar.";

const PRIVILEGE_SQL =
  "SELECT has_table_privilege(current_user, format('%I.%I', $1::text, $2::text), $3::text) AS has_privilege";

const REFERENCING_TABLES_SQL = `SELECT DISTINCT referencing.relname AS referencing_table
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class referenced ON referenced.oid = c.confrelid
JOIN pg_catalog.pg_namespace n ON n.oid = referenced.relnamespace
JOIN pg_catalog.pg_class referencing ON referencing.oid = c.conrelid
WHERE c.contype = 'f' AND n.nspname = $1 AND referenced.relname = $2 AND referencing.oid <> referenced.oid`;

const labelOf = (layout: TableLayout): string => buildQualifiedTableLabel(layout.schema, layout.table);

export function assertRunAllowed(params: ActualizarPadronParams): void {
  if (!params.dryRun && !params.confirm) {
    throw new Error(CONFIRM_REQUIRED_MESSAGE);
  }
}

function padronSequencesOf(resolved: ResolvedActualizarLayouts): SequenceReference[] {
  const idColumn = resolved.padron.columns[PADRON_COLUMN.ID];
  const idDefault = resolved.padronCatalog.find((entry) => entry.column_name === idColumn)?.column_default;
  return [parseSequenceName(resolved.padronIdSequence), sequenceReferenceOf(idDefault)].filter(
    (sequence): sequence is SequenceReference => sequence !== undefined
  );
}

function sequenceIssues(resolved: ResolvedActualizarLayouts): string[] {
  const padronSequences = padronSequencesOf(resolved);
  return resolved.workCatalog.flatMap((entry) => {
    const workSequence = sequenceReferenceOf(entry.column_default);
    if (!workSequence || !padronSequences.some((padronSequence) => isSameSequence(workSequence, padronSequence))) return [];
    return [
      `La columna "${entry.column_name}" de ${labelOf(resolved.work)} usa la secuencia ${sequenceLabelOf(workSequence)} de ${labelOf(resolved.padron)}: los ids de la tabla padrón no se pueden compartir. Quite ese valor por defecto.`,
    ];
  });
}

function notNullIssues(resolved: ResolvedActualizarLayouts): string[] {
  const written = new Set(Object.values(resolved.work.columns));
  return resolved.workCatalog
    .filter((entry) => !entry.is_nullable && !entry.column_default && !entry.is_identity && !written.has(entry.column_name))
    .map(
      (entry) =>
        `La columna "${entry.column_name}" de ${labelOf(resolved.work)} es NOT NULL sin valor por defecto y el proceso no la escribe.`
    );
}

function workSridIssues(resolved: ResolvedActualizarLayouts): string[] {
  const geometryName = resolved.work.columns[WORK_COLUMN.GEOMETRY];
  const geometry = resolved.workCatalog.find((entry) => entry.column_name === geometryName);
  const typing = geometry ? parseGeometryType(geometry.data_type) : undefined;
  if (!typing || typing.srid === GENERIC_SRID || typing.srid === resolved.work.srid) return [];
  return [
    `La columna geométrica "${geometryName}" de ${labelOf(resolved.work)} tiene SRID ${typing.srid}; debe ser ${resolved.work.srid} (el de la tabla padrón) o 0.`,
  ];
}

export function assertWorkTableSafe(resolved: ResolvedActualizarLayouts): void {
  const issues = [...sequenceIssues(resolved), ...notNullIssues(resolved), ...workSridIssues(resolved)];
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
}

export async function assertStagingHasRows(session: RunSession, staging: TableLayout): Promise<void> {
  const result = await session.query(buildStagingCountSql(staging));
  if (Number(result.rows[0]?.count ?? 0) === 0) {
    throw new Error(`La tabla ${labelOf(staging)} no tiene filas: no hay datos que actualizar.`);
  }
}

export async function assertStagingSridSupported(session: RunSession, staging: TableLayout, targetSrid: number): Promise<void> {
  const result = await session.query(buildStagingSridProbeSql(staging, targetSrid));
  const unsupported = Number(result.rows[0]?.unsupported ?? 0);
  if (unsupported > 0) {
    throw new Error(
      `La tabla ${labelOf(staging)} tiene ${unsupported} geometrías con SRID 0 o desconocido: no se pueden transformar al SRID ${targetSrid} de la tabla padrón.`
    );
  }
}

async function assertPrivilege(session: RunSession, layout: TableLayout, privilege: string): Promise<void> {
  const result = await session.query(PRIVILEGE_SQL, [resolveSchemaName(layout.schema), layout.table, privilege]);
  if (!result.rows[0]?.has_privilege) {
    throw new Error(`No tiene privilegio ${privilege} sobre la tabla ${labelOf(layout)}.`);
  }
}

export async function assertWorkWritePrivileges(session: RunSession, work: TableLayout): Promise<void> {
  await assertPrivilege(session, work, PRIVILEGE.INSERT);
  await assertPrivilege(session, work, PRIVILEGE.DELETE);
}

async function assertNoReferencingTables(session: RunSession, work: TableLayout): Promise<void> {
  const referencing = await session.query(REFERENCING_TABLES_SQL, [resolveSchemaName(work.schema), work.table]);
  if (referencing.rows.length > 0) {
    const names = referencing.rows.map((row: Record<string, unknown>) => String(row.referencing_table)).join(", ");
    throw new Error(
      `No se puede usar TRUNCATE en ${labelOf(work)}: otras tablas tienen claves foráneas hacia ella (${names}). Use la opción DELETE.`
    );
  }
}

export async function assertTruncatable(session: RunSession, work: TableLayout): Promise<void> {
  await assertPrivilege(session, work, PRIVILEGE.TRUNCATE);
  await assertNoReferencingTables(session, work);
}
