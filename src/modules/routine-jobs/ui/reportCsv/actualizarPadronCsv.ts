import type {
  ActualizarAddressMasterReport,
  ActualizarPadronResult,
  ActualizarTargetReport,
  PadronNamedKey,
  SkippedSample,
} from "../../jobs/actualizar-padron/types";
import { PADRON_SUBJECT_SPEC } from "../../jobs/shared/addressMasterLinkSpec";
import { reasonLabelOf } from "../actualizarPadronReportView";
import { textOrNoData } from "../reportFormat";
import { CHANGE_KIND, compareChangeKinds, listCsvOf, type ChangeKind, type ListCut } from "./reportCsvRows";
import type { CsvRow } from "./csvFormat";

const PADRON_CHANGE_HEADER: CsvRow = [
  "Tabla",
  "Cambio",
  "Tipo",
  "Provincia",
  "Localidad",
  "Padrón",
  "Distancia (m)",
  "Relación de área",
  "Id",
];
const EMPTY_TAIL_WIDTH = PADRON_CHANGE_HEADER.length - 3;

interface PadronChangeRecord {
  table: string;
  kind: ChangeKind;
  type: string;
  department: string;
  locality: string;
  number: string;
  distance: number | null;
  areaRatio: number | null;
}

const recordOf = (
  table: string,
  kind: ChangeKind,
  key: PadronNamedKey,
  distance: number | null,
  areaRatio: number | null
): PadronChangeRecord => ({
  table,
  kind,
  type: textOrNoData(key.typePadron),
  department: textOrNoData(key.department),
  locality: textOrNoData(key.locality),
  number: textOrNoData(key.number),
  distance,
  areaRatio,
});

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
];

const addressMasterRowOf = (table: string, kind: string, id: number): CsvRow => [
  table,
  kind,
  ...Array.from({ length: EMPTY_TAIL_WIDTH }, () => null),
  id,
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
  const padronRows = [...insertedRecordsOf(target), ...geometryRecordsOf(target)].sort(comparePadronChanges).map(changeRowOf);
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

export const buildActualizarPadronInconsistenciasCsv = (result: ActualizarPadronResult): string => {
  const { skipped, totals } = result;
  return listCsvOf(INCONSISTENCY_HEADER, inconsistencyRowOf, skipped.skippedRows, [
    { table: "", shown: skipped.skippedRows.length, total: totals.skipped, noun: "filas omitidas" },
  ]);
};
