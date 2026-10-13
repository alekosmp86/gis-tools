import { ReportColumn } from "../../constants";
import type { ReportRow } from "../../types";

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function mapExistingRow(row: Record<string, unknown>): { fechaact: string; total: number } {
  return { fechaact: asText(row.fechaact), total: Number(row.total) };
}

export function mapReportRow(row: Record<string, unknown>): ReportRow {
  return {
    [ReportColumn.DEPARTAMENTO]: asText(row[ReportColumn.DEPARTAMENTO]),
    [ReportColumn.LOCALIDAD]: asText(row[ReportColumn.LOCALIDAD]),
    [ReportColumn.PORCENTAJE]: asText(row[ReportColumn.PORCENTAJE]),
    [ReportColumn.FECHA_NOVEDAD]: asText(row[ReportColumn.FECHA_NOVEDAD]),
  };
}
