import { assertTargetsInScope, buildBlockers, type MasterReference } from "../../domain/removal";
import { MASTER_REFERENCE_COLUMNS, MASTER_SCAN_EXCLUDED_TABLES } from "../../removalConstants";
import type { ResolvedRemoval } from "../../removalTypes";
import type { DuplicateAnalysisParameters } from "../../types";
import { toQueryValues } from "./duplicateAnalysisQuery";
import { mapRemovalPlanRow } from "./mapRemovalRow";
import { REMOVAL_PLAN_SQL } from "./removalPlanQuery";
import type { Queryable } from "./runDuplicateAnalysis";

/** A `carto` table with a column that points at an address master, quoted for use in SQL. */
export interface MasterReferenceColumn {
  readonly qualifiedTable: string;
  readonly quotedColumn: string;
  readonly label: string;
}

const LIST_MASTER_REFERENCES_SQL = `
SELECT format('%I.%I', n.nspname, c.relname) AS qualified_table,
       quote_ident(a.attname) AS quoted_column,
       format('%s.%s (%s)', n.nspname, c.relname, a.attname) AS label
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'carto'
  AND c.relkind IN ('r', 'p')
  AND NOT (c.relname = ANY($1::text[]))
  AND a.attname = ANY($2::text[])
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY 1, 2;
`;

/** Every table, other than the ones deleted from, that can hold a reference to an address master. */
export async function listMasterReferenceColumns(queryable: Queryable): Promise<MasterReferenceColumn[]> {
  const result = await queryable.query(LIST_MASTER_REFERENCES_SQL, [
    [...MASTER_SCAN_EXCLUDED_TABLES],
    [...MASTER_REFERENCE_COLUMNS],
  ]);
  return result.rows.map((row) => {
    const raw = row as Record<string, string>;
    return { qualifiedTable: raw.qualified_table, quotedColumn: raw.quoted_column, label: raw.label };
  });
}

async function findReferencedMasters(
  queryable: Queryable,
  column: MasterReferenceColumn,
  masterIds: ReadonlyArray<string>
): Promise<MasterReference[]> {
  const result = await queryable.query(
    `SELECT DISTINCT ${column.quotedColumn}::text AS master_id FROM ${column.qualifiedTable} WHERE ${column.quotedColumn}::text = ANY($1::text[])`,
    [[...masterIds]]
  );
  return result.rows.map((row) => ({
    masterId: String((row as Record<string, unknown>).master_id),
    tableLabel: column.label,
  }));
}

async function scanMasterReferences(
  queryable: Queryable,
  masterIds: ReadonlyArray<string>
): Promise<MasterReference[]> {
  if (masterIds.length === 0) return [];
  const references: MasterReference[] = [];
  for (const column of await listMasterReferenceColumns(queryable)) {
    references.push(...(await findReferencedMasters(queryable, column, masterIds)));
  }
  return references;
}

/**
 * Recomputes the removal plan from live data. `simulateRemoval` and `executeRemoval` both call
 * exactly this, so the plan a user reviews and the plan that is deleted are produced by one code
 * path. Throws if any target lacks a REMOVE reason; collects, never skips, every blocked target.
 */
export async function resolveRemovalPlan(
  queryable: Queryable,
  parameters: DuplicateAnalysisParameters
): Promise<ResolvedRemoval> {
  const result = await queryable.query(REMOVAL_PLAN_SQL, toQueryValues(parameters));
  const row = mapRemovalPlanRow(result.rows[0] as Record<string, unknown>);
  assertTargetsInScope(row.outOfScopeCount);

  const references = await scanMasterReferences(queryable, row.targets.masterIds);

  return {
    plan: {
      fingerprint: row.fingerprint,
      counts: row.counts,
      blockers: buildBlockers(row.verdicts, references),
      targets: row.planTargets,
      snapshot: row.snapshot,
    },
    targets: row.targets,
  };
}
