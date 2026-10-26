import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { buildCountSql, type SourceLayout, type TargetLayout } from "../domain/loadSql";
import type { CargarPadronesParams, RunSession } from "../types";
import type { ResolvedLayouts } from "./resolveLayouts";

export const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la carga para escribir en la tabla destino. Sin confirmación solo se permite la simulación.";

const TRUNCATE_PRIVILEGE_SQL =
  "SELECT has_table_privilege(current_user, format('%I.%I', $1::text, $2::text), 'TRUNCATE') AS has_privilege";

const REFERENCING_TABLES_SQL = `SELECT DISTINCT referencing.relname AS referencing_table
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class referenced ON referenced.oid = c.confrelid
JOIN pg_catalog.pg_namespace n ON n.oid = referenced.relnamespace
JOIN pg_catalog.pg_class referencing ON referencing.oid = c.conrelid
WHERE c.contype = 'f' AND n.nspname = $1 AND referenced.relname = $2 AND referencing.oid <> referenced.oid`;

export function assertRunAllowed(params: CargarPadronesParams): void {
  if (!params.dryRun && !params.confirm) {
    throw new Error(CONFIRM_REQUIRED_MESSAGE);
  }
}

const labelOf = (layout: SourceLayout): string => buildQualifiedTableLabel(layout.schema, layout.table);

async function assertSourceHasRows(session: RunSession, layout: SourceLayout): Promise<void> {
  const result = await session.query(buildCountSql(layout));
  if (Number(result.rows[0]?.count ?? 0) === 0) {
    throw new Error(`La tabla ${labelOf(layout)} no tiene filas: no hay datos que cargar.`);
  }
}

export async function assertSourcesHaveRows(session: RunSession, layouts: ResolvedLayouts): Promise<void> {
  await assertSourceHasRows(session, layouts.rural);
  await assertSourceHasRows(session, layouts.urbano);
}

async function assertTruncatePrivilege(session: RunSession, target: TargetLayout): Promise<void> {
  const privilege = await session.query(TRUNCATE_PRIVILEGE_SQL, [target.schema, target.table]);
  if (!privilege.rows[0]?.has_privilege) {
    throw new Error(
      `No tiene privilegio TRUNCATE sobre la tabla ${labelOf(target)}. Use la opción DELETE o solicite el permiso.`
    );
  }
}

async function assertNoReferencingTables(session: RunSession, target: TargetLayout): Promise<void> {
  const referencing = await session.query(REFERENCING_TABLES_SQL, [target.schema, target.table]);
  if (referencing.rows.length > 0) {
    const names = referencing.rows.map((row) => String(row.referencing_table)).join(", ");
    throw new Error(
      `No se puede usar TRUNCATE en ${labelOf(target)}: otras tablas tienen claves foráneas hacia ella (${names}). Use la opción DELETE.`
    );
  }
}

export async function assertTruncatable(session: RunSession, target: TargetLayout): Promise<void> {
  await assertTruncatePrivilege(session, target);
  await assertNoReferencingTables(session, target);
}
