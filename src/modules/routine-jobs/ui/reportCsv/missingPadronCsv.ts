import type { ActualizarTargetReport, MissingPadron } from "../../jobs/actualizar-padron/types";
import { listCsvOf } from "./reportCsvRows";
import type { CsvRow } from "../../jobs/shared/csvFormat";
import { NO_DATA_TEXT } from "../../jobs/shared/text";
import { REPLACEMENT_CLASS_LABEL, refsTextOf, replacedByTextOf } from "../missingPadronView";

const MISSING_HEADER: CsvRow = [
  "Clase",
  "Tipo",
  "Departamento",
  "Localidad",
  "Padrón",
  "Id actual",
  "Área (m²)",
  "Cubierto (%)",
  "Reemplazado por",
  "Referencias",
  "Latitud",
  "Longitud",
];

const missingRowOf = (padron: MissingPadron): CsvRow => [
  REPLACEMENT_CLASS_LABEL[padron.class],
  padron.typePadron ?? NO_DATA_TEXT,
  padron.department ?? NO_DATA_TEXT,
  padron.locality ?? NO_DATA_TEXT,
  padron.number ?? NO_DATA_TEXT,
  padron.oldId,
  padron.oldAreaM2,
  padron.coveredPct,
  replacedByTextOf(padron.parts),
  refsTextOf(padron.refs),
  padron.centroidLat,
  padron.centroidLon,
];

/** The listed missing padrones of the report, with the cut marker when the list is shorter than the count. */
export const buildMissingPadronCsv = (target: ActualizarTargetReport): string =>
  listCsvOf(MISSING_HEADER, missingRowOf, target.missingReview, [
    { table: target.table, shown: target.missingReview.length, total: target.missing, noun: "padrones faltantes" },
  ]);
