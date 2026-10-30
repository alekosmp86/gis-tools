import { PAIR_STATUS } from "../../jobs/actualizar-padron/constants";
import type {
  ActualizarAddressMasterReport,
  ActualizarPadronResult,
  ActualizarTargetReport,
  PadronNamedKey,
  PadronPair,
  SkippedSample,
} from "../../jobs/actualizar-padron/types";
import { PADRON_SUBJECT_SPEC } from "../../jobs/shared/addressMasterLinkSpec";
import { reasonLabelOf } from "../actualizarPadronReportView";
import { textOrNoData } from "../reportFormat";
import { CHANGE_KIND, compareChangeKinds, listCsvOf, type ChangeKind, type ListCut } from "./reportCsvRows";
import type { CsvRow } from "./csvFormat";

const ID_HEADER = "Id";
const PADRON_CHANGE_HEADER: CsvRow = [
  "Tabla",
  "Cambio",
  "Tipo",
  "Provincia",
  "Localidad",
  "Padrón",
  "Distancia (m)",
  "Relación de área",
  ID_HEADER,
  "Tipo anterior",
  "Localidad anterior",
  "Padrón anterior",
];
const ID_INDEX = PADRON_CHANGE_HEADER.indexOf(ID_HEADER);
const LEADING_EMPTY_WIDTH = ID_INDEX - 2;
const TRAILING_EMPTY_WIDTH = PADRON_CHANGE_HEADER.length - ID_INDEX - 1;
const EMPTY_CELLS = (width: number): null[] => Array.from({ length: width }, () => null);

const NOT_APPLIED_REASON = "Posible par no aplicado (ambiguo)";

interface PreviousPadron {
  type: string;
  locality: string;
  number: string;
}

interface PadronChangeRecord {
  table: string;
  kind: ChangeKind;
  type: string;
  department: string;
  locality: string;
  number: string;
  distance: number | null;
  areaRatio: number | null;
  previous: PreviousPadron | null;
}

const recordOf = (
  table: string,
  kind: ChangeKind,
  key: PadronNamedKey,
  distance: number | null,
  areaRatio: number | null,
  previous: PreviousPadron | null = null
): PadronChangeRecord => ({
  table,
  kind,
  type: textOrNoData(key.typePadron),
  department: textOrNoData(key.department),
  locality: textOrNoData(key.locality),
  number: textOrNoData(key.number),
  distance,
  areaRatio,
  previous,
});

const previousOf = (key: PadronNamedKey): PreviousPadron => ({
  type: textOrNoData(key.typePadron),
  locality: textOrNoData(key.locality),
  number: textOrNoData(key.number),
});

const isApplied = (pair: PadronPair): boolean => pair.status === PAIR_STATUS.APPLIED;

const insertedRecordsOf = (target: ActualizarTargetReport): PadronChangeRecord[] =>
  target.insertedList.map((padron) => recordOf(target.table, CHANGE_KIND.INSERTED, padron, null, null));

const geometryRecordsOf = (target: ActualizarTargetReport): PadronChangeRecord[] =>
  target.geometryChanges.map((change) =>
    recordOf(
      target.table,
      target.updateApplied ? CHANGE_KIND.MODIFIED : CHANGE_KIND.DETECTED,
      change,
      change.distance,
      change.areaRatio
    )
  );

const keyUpdatedRecordsOf = (target: ActualizarTargetReport): PadronChangeRecord[] =>
  target.pairs
    .filter(isApplied)
    .map((pair) => recordOf(target.table, CHANGE_KIND.KEY_UPDATED, pair.new, pair.distance, null, previousOf(pair.old)));

const compareText = (first: string, second: string): number => first.localeCompare(second, "es", { numeric: true });

const comparePadronChanges = (first: PadronChangeRecord, second: PadronChangeRecord): number =>
  compareChangeKinds(first.kind, second.kind) ||
  compareText(first.department, second.department) ||
  compareText(first.locality, second.locality) ||
  compareText(first.number, second.number);

const changeRowOf = (record: PadronChangeRecord): CsvRow => [
  record.table,
  record.kind,
  record.type,
  record.department,
  record.locality,
  record.number,
  record.distance,
  record.areaRatio,
  null,
  record.previous?.type ?? null,
  record.previous?.locality ?? null,
  record.previous?.number ?? null,
];

const addressMasterRowOf = (table: string, kind: string, id: number): CsvRow => [
  table,
  kind,
  ...EMPTY_CELLS(LEADING_EMPTY_WIDTH),
  id,
  ...EMPTY_CELLS(TRAILING_EMPTY_WIDTH),
];

function addressMasterRowsOf(addressMaster: ActualizarAddressMasterReport, targetTable: string): CsvRow[] {
  const { texts } = PADRON_SUBJECT_SPEC;
  const created = addressMaster.linkedList.filter((padron) => padron.created);
  return [
    ...created.map((padron) => addressMasterRowOf(addressMaster.table, texts.createdChangeKind, padron.addressMasterId)),
    ...addressMaster.linkedList.map((padron) => addressMasterRowOf(targetTable, texts.linkedChangeKind, padron.id)),
  ];
}

const cutsOf = (target: ActualizarTargetReport, addressMaster: ActualizarAddressMasterReport | undefined): ListCut[] => [
  { table: target.table, shown: target.insertedList.length, total: target.inserted, noun: "padrones insertados" },
  { table: target.table, shown: target.geometryChanges.length, total: target.changed, noun: "geometrías que cambian" },
  { table: target.table, shown: target.pairs.filter(isApplied).length, total: target.pairsApplied, noun: "claves actualizadas" },
  ...(addressMaster === undefined ? [] : addressMasterCutsOf(target, addressMaster)),
];

function addressMasterCutsOf(target: ActualizarTargetReport, addressMaster: ActualizarAddressMasterReport): ListCut[] {
  const created = addressMaster.linkedList.filter((padron) => padron.created);
  return [
    {
      table: addressMaster.table,
      shown: created.length,
      total: addressMaster.counts.created,
      noun: `direcciones maestras creadas${PADRON_SUBJECT_SPEC.texts.createdScope}`,
    },
    { table: target.table, shown: addressMaster.linkedList.length, total: addressMaster.counts.linked, noun: PADRON_SUBJECT_SPEC.texts.linkedNoun },
  ];
}

export const buildActualizarPadronCsv = (result: ActualizarPadronResult): string => {
  const { target, addressMaster } = result;
  const padronRows = [
    ...insertedRecordsOf(target),
    ...geometryRecordsOf(target),
    ...keyUpdatedRecordsOf(target),
  ]
    .sort(comparePadronChanges)
    .map(changeRowOf);
  const rows = [...padronRows, ...(addressMaster === undefined ? [] : addressMasterRowsOf(addressMaster, target.table))];
  return listCsvOf(PADRON_CHANGE_HEADER, (row: CsvRow) => row, rows, cutsOf(target, addressMaster));
};

const INCONSISTENCY_HEADER: CsvRow = ["Motivo", "Departamento", "Localidad", "Padrón"];

const inconsistencyRowOf = (row: SkippedSample): CsvRow => [
  reasonLabelOf(row.reason),
  textOrNoData(row.department),
  textOrNoData(row.locality),
  textOrNoData(row.padron),
];

const notAppliedRowOf = (pair: PadronPair): CsvRow => [
  NOT_APPLIED_REASON,
  textOrNoData(pair.new.department),
  textOrNoData(pair.new.locality),
  textOrNoData(pair.new.number),
];

const newKeyOf = (pair: PadronPair): string =>
  JSON.stringify([pair.new.typePadron, pair.new.provinceId, pair.new.localityId, pair.new.number]);

/** A new row that matched several destination rows is one candidate, listed once. */
const onePerNewKey = (pairs: PadronPair[]): PadronPair[] => {
  const seenKeys = new Set<string>();
  return pairs.filter((pair) => {
    const key = newKeyOf(pair);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
};

export const buildActualizarPadronInconsistenciasCsv = (result: ActualizarPadronResult): string => {
  const { skipped, totals, target } = result;
  const notApplied = onePerNewKey(target.pairs.filter((pair) => !isApplied(pair)));
  const rows: CsvRow[] = [...skipped.skippedRows.map(inconsistencyRowOf), ...notApplied.map(notAppliedRowOf)];
  return listCsvOf(INCONSISTENCY_HEADER, (row: CsvRow) => row, rows, [
    { table: "", shown: skipped.skippedRows.length, total: totals.skipped, noun: "filas omitidas" },
    { table: "", shown: notApplied.length, total: target.pairsNotApplied, noun: "posibles pares no aplicados" },
  ]);
};
