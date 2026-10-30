import { toCsv, type CsvRow } from "./csvFormat";

const COUNT_HEADER: CsvRow = ["Cambio", "Cantidad"];
export const CHANGE_HEADER: CsvRow = ["Tabla", "Cambio", "Provincia", "Nombre", "Id", "Distancia (m)", "Relación de área"];

export const CHANGE_KIND = {
  INSERTED: "Insertada",
  MODIFIED: "Geometría modificada",
  DETECTED: "Geometría detectada (no aplicada)",
  KEY_UPDATED: "Clave actualizada",
} as const;

export type ChangeKind = (typeof CHANGE_KIND)[keyof typeof CHANGE_KIND];

interface CountRecord {
  label: string;
  value: number;
}

export interface ChangeRecord {
  table: string;
  kind: ChangeKind;
  province: string;
  name: string;
  id: number | null;
  distance: number | null;
  areaRatio: number | null;
}

export const countCsvOf = (counts: readonly CountRecord[]): string =>
  toCsv([COUNT_HEADER, ...counts.map((count): CsvRow => [count.label, count.value])]);

const kindRankOf = (kind: ChangeKind): number => (kind === CHANGE_KIND.INSERTED ? 0 : 1);

export const compareChangeKinds = (first: ChangeKind, second: ChangeKind): number => kindRankOf(first) - kindRankOf(second);

const compareProvinces = (first: string, second: string): number =>
  first.localeCompare(second, "es", { numeric: true });

const compareNames = (first: string, second: string): number => first.localeCompare(second, "es");

const compareChanges = (first: ChangeRecord, second: ChangeRecord): number =>
  compareChangeKinds(first.kind, second.kind) ||
  compareProvinces(first.province, second.province) ||
  compareNames(first.name, second.name);

export const orderedChangesOf = (records: readonly ChangeRecord[]): ChangeRecord[] => [...records].sort(compareChanges);

export const changeRowOf = (record: ChangeRecord): CsvRow => [
  record.table,
  record.kind,
  record.province,
  record.name,
  record.id,
  record.distance,
  record.areaRatio,
];

export interface ListCut {
  table: string;
  shown: number;
  total: number;
  noun: string;
}

const cutRowOf = (cut: ListCut, width: number): CsvRow => [
  cut.table,
  `Lista incompleta: se muestran las primeras ${cut.shown} de ${cut.total} ${cut.noun}`,
  ...Array.from({ length: width - 2 }, () => null),
];

/** One closing row per list the report cut, so the CSV never hides rows silently. */
export const cutRowsOf = (cuts: readonly ListCut[], width: number): CsvRow[] =>
  cuts.filter((cut) => cut.total > cut.shown).map((cut) => cutRowOf(cut, width));

/** A flat CSV of one header, one row per record, and the cut markers of the lists the report shortened. */
export const listCsvOf = <Item>(
  header: CsvRow,
  rowOf: (item: Item) => CsvRow,
  items: readonly Item[],
  cuts: readonly ListCut[]
): string => toCsv([header, ...items.map(rowOf), ...cutRowsOf(cuts, header.length)]);

export const changeCsvOf = (records: readonly ChangeRecord[], cuts: readonly ListCut[] = []): string =>
  listCsvOf(CHANGE_HEADER, changeRowOf, records, cuts);
