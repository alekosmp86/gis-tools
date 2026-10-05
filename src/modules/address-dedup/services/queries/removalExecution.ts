import { assertDeletedMatchesPlan, RemovalRefusedError } from "../../domain/removal";
import { GLOBAL_GUARD_TABLES, LOCKED_TABLES, RemovalTable } from "../../removalConstants";
import type { RemovalPlan, RemovalTargets } from "../../removalTypes";
import { listMasterReferenceColumns } from "./resolveRemovalPlan";
import type { Queryable } from "./runDuplicateAnalysis";

const LOCK_MODE = "SHARE ROW EXCLUSIVE";

const TargetKey = {
  ADDRESS_IDS: "ADDRESS_IDS",
  MASTER_IDS: "MASTER_IDS",
  URNS: "URNS",
} as const;

type TargetKey = (typeof TargetKey)[keyof typeof TargetKey];

interface DeleteStep {
  readonly table: RemovalTable;
  readonly predicate: string;
  readonly key: TargetKey;
}

/** The delete order of `carto.baja_direccion_base_v1`; children first, the master last. */
const DELETE_STEPS: ReadonlyArray<DeleteStep> = [
  { table: RemovalTable.INTERNAL_ADDRESS_ACCESS_POINT, predicate: "id_internal_address = ANY($1::bigint[])", key: TargetKey.ADDRESS_IDS },
  { table: RemovalTable.TERRITORIAL_UNIT_ACCESS_POINT, predicate: "id_access_point = ANY($1::bigint[])", key: TargetKey.ADDRESS_IDS },
  { table: RemovalTable.COMPACT_ADDRESS, predicate: "urn = ANY($1::text[])", key: TargetKey.URNS },
  { table: RemovalTable.INTERNAL_ADDRESS, predicate: "id = ANY($1::bigint[])", key: TargetKey.ADDRESS_IDS },
  { table: RemovalTable.ACCESS_POINT, predicate: "id = ANY($1::bigint[])", key: TargetKey.ADDRESS_IDS },
  { table: RemovalTable.ADDRESS, predicate: "id = ANY($1::bigint[])", key: TargetKey.ADDRESS_IDS },
  { table: RemovalTable.ADDRESSES_MASTER, predicate: "addresses_master_id = ANY($1::bigint[])", key: TargetKey.MASTER_IDS },
];

function lockStatement(qualifiedTable: string): string {
  return `LOCK TABLE ${qualifiedTable} IN ${LOCK_MODE} MODE`;
}

export async function lockRemovalTables(queryable: Queryable): Promise<void> {
  await queryable.query(`LOCK TABLE ${LOCKED_TABLES.join(", ")} IN ${LOCK_MODE} MODE`, []);
}

/** Locks every other table that can reference a master, so none can gain a reference mid-removal. */
export async function lockMasterReferenceTables(queryable: Queryable): Promise<void> {
  for (const column of await listMasterReferenceColumns(queryable)) {
    await queryable.query(lockStatement(column.qualifiedTable), []);
  }
}

export async function assertGlobalGuardsClear(queryable: Queryable): Promise<void> {
  for (const table of GLOBAL_GUARD_TABLES) {
    const result = await queryable.query(`SELECT EXISTS (SELECT 1 FROM ${table}) AS has_rows`, []);
    if ((result.rows[0] as { has_rows: boolean }).has_rows) {
      throw new RemovalRefusedError(
        "Baja detenida: comentarios o entidades plurales contienen registros. Revise antes de continuar."
      );
    }
  }
}

function valuesFor(step: DeleteStep, targets: RemovalTargets): string[] {
  switch (step.key) {
    case TargetKey.ADDRESS_IDS:
      return [...targets.addressIds];
    case TargetKey.MASTER_IDS:
      return [...targets.masterIds];
    case TargetKey.URNS:
      return [...targets.urns];
  }
}

async function deleteStep(
  queryable: Queryable,
  step: DeleteStep,
  targets: RemovalTargets
): Promise<number> {
  const result = await queryable.query(
    `WITH deleted AS (DELETE FROM carto.${step.table} WHERE ${step.predicate} RETURNING 1) SELECT count(*)::int AS deleted FROM deleted`,
    [valuesFor(step, targets)]
  );
  return Number((result.rows[0] as { deleted: number }).deleted);
}

/**
 * Deletes exactly the resolved targets, in order, and checks each table's deleted count against
 * the plan. A mismatch throws, which rolls the whole transaction back.
 */
export async function deleteRemovalTargets(
  queryable: Queryable,
  plan: RemovalPlan,
  targets: RemovalTargets
): Promise<Record<RemovalTable, number>> {
  const deleted = {} as Record<RemovalTable, number>;
  for (const step of DELETE_STEPS) {
    deleted[step.table] = await deleteStep(queryable, step, targets);
    assertDeletedMatchesPlan(step.table, deleted[step.table], plan.counts.rowsByTable[step.table]);
  }
  return deleted;
}
