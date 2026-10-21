import type { PgClientLike } from "../../../shared/pgClient";
import { REPORT_COLUMNS, type ReportKind } from "../../constants";
import type { ReportData, ReportRow } from "../../types";
import { mapReportRow } from "./mapRows";
import { REPORT_QUERIES } from "./reportQueries";
import { RELEASE_REPORT_SQL, ROLLBACK_TO_REPORT_SQL, SAVEPOINT_REPORT_SQL, reportTimeoutSql } from "./transactionStatements";

async function readReport(client: PgClientLike, kind: ReportKind): Promise<ReportRow[]> {
  const query = REPORT_QUERIES[kind];
  const result = await client.query(query.sql, [...query.params]);
  return result.rows.map((row) => mapReportRow(row as Record<string, unknown>, REPORT_COLUMNS[kind]));
}

/**
 * Runs each report inside its own SAVEPOINT: a failing report is rolled back to its savepoint and
 * becomes an error entry, and the remaining reports still run. `describeFailure` scrubs the message.
 */
export async function runReportsGuarded(
  client: PgClientLike,
  kinds: ReadonlyArray<ReportKind>,
  describeFailure: (error: unknown) => string,
  perReportTimeoutMs?: number
): Promise<ReportData[]> {
  const reports: ReportData[] = [];
  for (const kind of kinds) {
    await client.query(SAVEPOINT_REPORT_SQL, []);
    try {
      if (perReportTimeoutMs !== undefined) await client.query(reportTimeoutSql(perReportTimeoutMs), []);
      const rows = await readReport(client, kind);
      await client.query(RELEASE_REPORT_SQL, []);
      reports.push({ kind, rows, error: null });
    } catch (error: unknown) {
      await client.query(ROLLBACK_TO_REPORT_SQL, []);
      reports.push({ kind, rows: null, error: describeFailure(error) });
    }
  }
  return reports;
}
