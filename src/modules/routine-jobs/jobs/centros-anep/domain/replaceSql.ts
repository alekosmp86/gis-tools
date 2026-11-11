import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import { qualifiedName } from "../../actualizar-padron/domain/layouts";
import { literal, q } from "../../shared/sqlFragments";
import type { CentrosColumnPlan, CentrosFinalLayout, CentrosStagingLayout, CentrosColumnPair } from "../types";

const REVERT_CURSOR_ALIAS = "cursor";
const REVERT_LINE_ALIAS = "line";

export const REVERT_ROW_COLUMNS = { CURSOR: REVERT_CURSOR_ALIAS, LINE: REVERT_LINE_ALIAS } as const;

export const buildLockFinalSql = (final: CentrosFinalLayout): string =>
  `LOCK TABLE ${qualifiedName(final)} IN SHARE ROW EXCLUSIVE MODE`;

export const buildDeleteFinalSql = (final: CentrosFinalLayout): string =>
  `WITH "deleted" AS (DELETE FROM ${qualifiedName(final)} RETURNING 1) SELECT count(*) AS "deleted" FROM "deleted"`;

const sourceExpressionOf = (pair: CentrosColumnPair, srid: number): string =>
  pair.isGeometry ? `ST_Transform(s.${q(pair.source)}, ${srid})` : `s.${q(pair.source)}`;

export function buildInsertFromStagingSql(
  staging: CentrosStagingLayout,
  final: CentrosFinalLayout,
  plan: CentrosColumnPlan
): string {
  const targets = plan.pairs.map((pair) => q(pair.target)).join(", ");
  const sources = plan.pairs.map((pair) => sourceExpressionOf(pair, final.srid)).join(", ");
  return [
    `WITH "inserted" AS (INSERT INTO ${qualifiedName(final)} (${targets})`,
    `SELECT ${sources} FROM ${qualifiedName(staging.layout)} AS s RETURNING 1)`,
    `SELECT count(*) AS "inserted" FROM "inserted"`,
  ].join(" ");
}

export const buildAnalyzeFinalSql = (final: CentrosFinalLayout): string =>
  buildAnalyzeStatement(final.schema, final.table);

export const revertColumnsOf = (final: CentrosFinalLayout): string[] => final.catalog.map((entry) => entry.column_name);

export const buildRevertHeadSql = (final: CentrosFinalLayout): string[] => [
  "BEGIN;",
  `DELETE FROM ${qualifiedName(final)};`,
];

export const buildRevertInsertHead = (final: CentrosFinalLayout): string =>
  `INSERT INTO ${qualifiedName(final)} (${revertColumnsOf(final).map(q).join(", ")}) OVERRIDING SYSTEM VALUE VALUES`;

export const REVERT_TAIL_SQL = "COMMIT;";

/** Pages by ctid inside the locked transaction: every value is quoted by format(%L) on the server, so the file never rebuilds literals in code. */
export function buildRevertPageSql(final: CentrosFinalLayout, pageSize: number, afterCursor: boolean): string {
  const columns = revertColumnsOf(final);
  const template = `(${columns.map(() => "%L").join(", ")})`;
  const args = columns.map(q).join(", ");
  return [
    `SELECT ctid::text AS ${q(REVERT_CURSOR_ALIAS)}, format(${literal(template)}, ${args}) AS ${q(REVERT_LINE_ALIAS)}`,
    `FROM ${qualifiedName(final)}`,
    afterCursor ? "WHERE ctid > $1::tid" : "",
    `ORDER BY ctid LIMIT ${pageSize}`,
  ]
    .filter((part) => part !== "")
    .join(" ");
}
