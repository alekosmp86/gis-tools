import { LOCALITY_REASON_GROUP_LIMIT } from "../../jobs/actualizar-padron/constants";
import { toCsv, type CsvRow } from "../../jobs/shared/csvFormat";
import type { LocalityRow } from "../actualizarPadronReportView";

const NOT_FOUND_HEADER: CsvRow = ["Departamento", "Localidad", "Padrones afectados", "Motivo"];
const NOT_ANYWHERE_REASON = "La localidad no existe en el departamento.";
const CUT_NOTE = `Lista incompleta: se muestran las primeras ${LOCALITY_REASON_GROUP_LIMIT} localidades no encontradas`;

const reasonOf = (row: LocalityRow): string =>
  row.otherDepartments.length === 0
    ? NOT_ANYWHERE_REASON
    : `No existe en ${row.department}; existe en ${row.otherDepartments.join(", ")}. Revise el código de departamento.`;

const rowOf = (row: LocalityRow): CsvRow => [row.department, row.locality, row.count, reasonOf(row)];

const cutRowsOf = (rows: readonly LocalityRow[]): CsvRow[] =>
  rows.length >= LOCALITY_REASON_GROUP_LIMIT ? [[CUT_NOTE, null, null, null]] : [];

/** The listed localities not found (AP-120), with the cut marker when the list reached its cap. */
export const buildLocalitiesNotFoundCsv = (rows: readonly LocalityRow[]): string =>
  toCsv([NOT_FOUND_HEADER, ...rows.map(rowOf), ...cutRowsOf(rows)]);
