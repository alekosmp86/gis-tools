import type { AmbiguousLocalityCode, CargarPadronesResult } from "../../jobs/cargar-padrones/types";
import { textOrNoData } from "../reportFormat";
import type { CsvRow } from "./csvFormat";
import { countCsvOf, listCsvOf } from "./reportCsvRows";

const INCONSISTENCY_HEADER: CsvRow = ["Departamento", "Código de localidad", "Nombres"];
const NAME_SEPARATOR = " / ";

export const buildCargarPadronesCsv = (result: CargarPadronesResult): string =>
  countCsvOf([
    { label: "Padrones rurales insertados", value: result.report.rural.inserted },
    { label: "Padrones urbanos insertados", value: result.report.urbano.inserted },
    { label: "Total insertados", value: result.totals.inserted },
  ]);

const codeTextOf = (code: string | number | null): string | null => (code === null ? null : String(code));

const ambiguousCodeRowOf = (code: AmbiguousLocalityCode): CsvRow => [
  textOrNoData(code.nomdepto ?? codeTextOf(code.coddepto)),
  textOrNoData(codeTextOf(code.codloccat)),
  code.nomloccat.join(NAME_SEPARATOR),
];

export const buildCargarPadronesInconsistenciasCsv = (result: CargarPadronesResult): string =>
  listCsvOf(INCONSISTENCY_HEADER, ambiguousCodeRowOf, result.ambiguousLocalityCodes, [
    {
      table: "",
      shown: result.ambiguousLocalityCodes.length,
      total: result.ambiguousLocalityTotal,
      noun: "códigos de localidad ambiguos",
    },
  ]);
