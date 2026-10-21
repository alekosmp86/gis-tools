import type { ReportColumnDefinition } from "../../constants";
import type { ReportRow, StatusCount } from "../../types";

type DatabaseRow = Record<string, unknown>;

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function asNullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function mapStatusCount(row: DatabaseRow): StatusCount {
  return { status: asText(row.status), count: Number(row.total) };
}

/** Values are already text where it matters (dates are formatted in SQL); numbers become their decimal text. */
export function mapReportRow(row: DatabaseRow, columns: ReadonlyArray<ReportColumnDefinition>): ReportRow {
  return columns.map((column) => asText(row[column.name]));
}
