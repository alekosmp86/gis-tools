import { buildQualifiedTableLabel, quoteIdentifier } from "@/core/services/sqlStatements";
import type { SequenceRef } from "@/core/services/replaceSequences";
import type { SourceLayout } from "../domain/loadSql";
import type { CargarPadronesParams, RunSession } from "../types";
import type { ResolvedLayouts } from "./resolveLayouts";
import { unmappedSequences } from "./sequences";

const SEQUENCE_PRIVILEGES: readonly string[] = ["UPDATE", "USAGE"];
const TARGET_PRIVILEGE = "SELECT";

const sequencePrivilegeSql = (privilege: string): string =>
  `SELECT has_sequence_privilege($1::text, '${privilege}') AS has_privilege`;

const TARGET_PRIVILEGE_SQL = `SELECT has_table_privilege($1::text, '${TARGET_PRIVILEGE}') AS has_privilege`;

const qualifiedNameOf = (schema: string, name: string): string => `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;

async function holdsPrivilege(session: RunSession, sql: string, object: string): Promise<boolean> {
  const result = await session.query(sql, [object]);
  return Boolean(result.rows[0]?.has_privilege);
}

async function assertSequencePrivilege(session: RunSession, sequence: SequenceRef, privilege: string): Promise<void> {
  const object = qualifiedNameOf(sequence.schema, sequence.name);
  if (await holdsPrivilege(session, sequencePrivilegeSql(privilege), object)) return;
  const label = buildQualifiedTableLabel(sequence.schema, sequence.name);
  throw new Error(
    `No tiene privilegio ${privilege} sobre la secuencia ${label}, necesario para reiniciarla y ajustarla. Puede desactivar "Reiniciar secuencias del destino" o solicitar el permiso.`
  );
}

async function assertTargetSelect(session: RunSession, target: SourceLayout): Promise<void> {
  const object = qualifiedNameOf(target.schema, target.table);
  if (await holdsPrivilege(session, TARGET_PRIVILEGE_SQL, object)) return;
  throw new Error(
    `No tiene privilegio ${TARGET_PRIVILEGE} sobre la tabla ${buildQualifiedTableLabel(target.schema, target.table)}, necesario para calcular el máximo de las columnas de secuencia.`
  );
}

export async function assertResetPrivileges(
  session: RunSession,
  layouts: ResolvedLayouts,
  params: CargarPadronesParams
): Promise<void> {
  if (!params.options.resetSequences || params.dryRun) return;
  const sequences = unmappedSequences(layouts);
  if (sequences.length === 0) return;
  for (const sequence of sequences) {
    for (const privilege of SEQUENCE_PRIVILEGES) {
      await assertSequencePrivilege(session, sequence, privilege);
    }
  }
  await assertTargetSelect(session, layouts.target);
}
