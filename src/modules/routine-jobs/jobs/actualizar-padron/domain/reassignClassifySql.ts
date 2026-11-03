import { cte, q } from "../../shared/sqlFragments";
import { REASSIGN_IDS_TABLE_SQL, SESSION_IDS_COLUMN } from "./reassignTables";
import { referenceRawName, REMOVAL_CTE } from "./replacementSql";

/* AP-112: the classify statement's view of the reassignment: which verdicts move their references, how many rows, and the digest entry. */

export const VERDICT_COLUMN = {
  OLD_ID: "old_id",
  REASON: "reason",
  REFS_TOTAL: "refs_total",
  REASSIGN: "reassign",
} as const;

const CTE_REASSIGN_IDS = "reassign_ids_insert";

const reassigning = (): string => q(VERDICT_COLUMN.REASSIGN);

/** A verdict with no reason and references is a subdivided padrón that AP-109 allows to reassign. */
export const reassignFlagSql = (alias: string): string =>
  `(${alias}.${q(VERDICT_COLUMN.REASON)} IS NULL AND ${alias}.${q(VERDICT_COLUMN.REFS_TOTAL)} > 0)`;

export const DELETE_WITHOUT_REASSIGN = `${q(VERDICT_COLUMN.REASON)} IS NULL AND NOT ${reassigning()}`;

export function reassignIdsInsertCte(): string {
  return cte(
    CTE_REASSIGN_IDS,
    [
      `INSERT INTO ${REASSIGN_IDS_TABLE_SQL} (${q(SESSION_IDS_COLUMN)})`,
      `SELECT ${q(VERDICT_COLUMN.OLD_ID)} FROM ${q(REMOVAL_CTE.VERDICTS)} WHERE ${reassigning()}`,
      `RETURNING ${q(SESSION_IDS_COLUMN)}`,
    ].join(" ")
  );
}

const reassignedFrom = `FROM ${q(REMOVAL_CTE.VERDICTS)} WHERE ${reassigning()}`;

function reassignedByTableSql(): string {
  const raw = q(referenceRawName(REMOVAL_CTE.REFS));
  return [
    `(SELECT COALESCE(json_object_agg(g."table_label", g."n"), '{}'::json) FROM (`,
    `SELECT r."table_label", sum(r."refs") AS "n" FROM ${raw} AS r`,
    `JOIN ${q(REMOVAL_CTE.VERDICTS)} AS v ON v.${q(VERDICT_COLUMN.OLD_ID)} = r."old_id" WHERE v.${reassigning()} GROUP BY r."table_label") AS g)`,
  ].join(" ");
}

/* AP-111: of the rows to move, the ones with no usable point, which go to the largest receiver. */
function withoutPointSql(): string {
  const raw = q(referenceRawName(REMOVAL_CTE.REFS));
  return [
    `(SELECT COALESCE(sum(r."no_point"), 0) FROM ${raw} AS r`,
    `JOIN ${q(REMOVAL_CTE.VERDICTS)} AS v ON v.${q(VERDICT_COLUMN.OLD_ID)} = r."old_id" WHERE v.${reassigning()})`,
  ].join(" ");
}

/** The referencing rows the real run will move, the padrones it will then delete and the rows per table. */
export function reassignCountsSql(): string[] {
  return [
    `${withoutPointSql()} AS "reassigned_without_point",`,
    `(SELECT COALESCE(sum(${q(VERDICT_COLUMN.REFS_TOTAL)}), 0) ${reassignedFrom}) AS "reassigned",`,
    `(SELECT count(*) ${reassignedFrom}) AS "subdivided_deleted",`,
    `${reassignedByTableSql()} AS "reassigned_by_table",`,
  ];
}

/** One digest entry (tag "S"): the count and an md5 of the sorted padrón ids and of their reference counts per table. */
export function reassignDigestEntrySql(): string {
  const raw = q(referenceRawName(REMOVAL_CTE.REFS));
  const idsHash = `(SELECT md5(string_agg(${q(VERDICT_COLUMN.OLD_ID)}::text, ',' ORDER BY ${q(VERDICT_COLUMN.OLD_ID)})) ${reassignedFrom})`;
  const refsHash = [
    `(SELECT md5(string_agg(r."old_id"::text || ':' || r."table_label" || ':' || r."refs"::text, ',' ORDER BY r."old_id", r."table_label"))`,
    `FROM ${raw} AS r JOIN ${q(REMOVAL_CTE.VERDICTS)} AS v ON v.${q(VERDICT_COLUMN.OLD_ID)} = r."old_id" WHERE v.${reassigning()})`,
  ].join(" ");
  return `SELECT concat_ws('|', 'S', (SELECT count(*) ${reassignedFrom}), coalesce(${idsHash}, ''), coalesce(${refsHash}, '')) AS "entry"`;
}
