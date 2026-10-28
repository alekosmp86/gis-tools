import { toCsv, type CsvRow } from "./csvFormat";

const COUNT_HEADER: CsvRow = ["Cambio", "Cantidad"];
const CHANGE_HEADER: CsvRow = ["Tabla", "Cambio", "Provincia", "Nombre", "Id", "Distancia (m)", "Relación de área"];

export const CHANGE_KIND = {
  INSERTED: "Insertada",
  MODIFIED: "Geometría modificada",
  DETECTED: "Geometría detectada (no aplicada)",
} as const;

type ChangeKind = (typeof CHANGE_KIND)[keyof typeof CHANGE_KIND];

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

const compareProvinces = (first: string, second: string): number =>
  first.localeCompare(second, "es", { numeric: true });

const compareNames = (first: string, second: string): number => first.localeCompare(second, "es");

const compareChanges = (first: ChangeRecord, second: ChangeRecord): number =>
  kindRankOf(first.kind) - kindRankOf(second.kind) ||
  compareProvinces(first.province, second.province) ||
  compareNames(first.name, second.name);

export const orderedChangesOf = (records: readonly ChangeRecord[]): ChangeRecord[] => [...records].sort(compareChanges);

const changeRowOf = (record: ChangeRecord): CsvRow => [
  record.table,
  record.kind,
  record.province,
  record.name,
  record.id,
  record.distance,
  record.areaRatio,
];

export const changeCsvOf = (records: readonly ChangeRecord[]): string =>
  toCsv([CHANGE_HEADER, ...records.map(changeRowOf)]);
