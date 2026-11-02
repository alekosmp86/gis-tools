import { NO_DATA_TEXT } from "../../shared/text";
import { toCsv, type CsvRow } from "../../shared/csvFormat";
import type { PadronGeometryChange } from "../types";

const PENDING_GEOMETRY_HEADER: CsvRow = [
  "Tipo",
  "Provincia",
  "Departamento",
  "Localidad",
  "Padrón",
  "Id actual",
  "Área anterior (m²)",
  "Área nueva (m²)",
  "Área no coincidente (%)",
  "Latitud",
  "Longitud",
];

const textOrNoData = (value: string | null): string => value ?? NO_DATA_TEXT;

/** Largest area change first; a change with no usable area goes last. */
const compareAreaChangeDesc = (first: number | null, second: number | null): number => {
  if (first === second) return 0;
  if (first === null) return 1;
  if (second === null) return -1;
  return second - first;
};

const pendingRowOf = (change: PadronGeometryChange): CsvRow => [
  textOrNoData(change.typePadron),
  change.provinceId,
  textOrNoData(change.department),
  textOrNoData(change.locality),
  textOrNoData(change.number),
  change.oldId,
  change.oldAreaM2,
  change.newAreaM2,
  change.areaChangePct,
  change.centroidLat,
  change.centroidLon,
];

/** Every pending geometry change of an analysis, uncapped, with a UTF-8 BOM like the other report CSVs. */
export const buildPendingGeometryCsv = (changes: readonly PadronGeometryChange[]): string => {
  const ordered = [...changes].sort((first, second) => compareAreaChangeDesc(first.areaChangePct, second.areaChangePct));
  return toCsv([PENDING_GEOMETRY_HEADER, ...ordered.map(pendingRowOf)]);
};
