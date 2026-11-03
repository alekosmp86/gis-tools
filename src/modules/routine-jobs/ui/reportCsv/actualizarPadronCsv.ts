import { GEOMETRY_STATE, PAIR_STATUS, PAIR_TIER, type GeometryState } from "../../jobs/actualizar-padron/constants";
import type {
  ActualizarAddressMasterReport,
  ActualizarPadronResult,
  ActualizarTargetReport,
  PadronGeometryChange,
  PadronLocation,
  PadronNamedKey,
  PadronPair,
  SkippedSample,
} from "../../jobs/actualizar-padron/types";
import { PADRON_SUBJECT_SPEC } from "../../jobs/shared/addressMasterLinkSpec";
import { reasonLabelOf } from "../actualizarPadronReportView";
import { textOrNoData } from "../reportFormat";
import { CHANGE_KIND, compareChangeKinds, listCsvOf, type ChangeKind, type ListCut } from "./reportCsvRows";
import type { CsvRow } from "../../jobs/shared/csvFormat";

const ID_HEADER = "Id";
const PADRON_CHANGE_HEADER: CsvRow = [
  "Tabla",
  "Cambio",
  "Tipo",
  "Provincia",
  "Localidad",
  "Padrón",
  ID_HEADER,
  "Área anterior (m²)",
  "Área nueva (m²)",
  "Cambio de área (%)",
  "Área no coincidente (%)",
  "Latitud",
  "Longitud",
  "Tipo anterior",
  "Localidad anterior",
  "Padrón anterior",
];
const ID_INDEX = PADRON_CHANGE_HEADER.indexOf(ID_HEADER);
const LEADING_EMPTY_WIDTH = ID_INDEX - 2;
const TRAILING_EMPTY_WIDTH = PADRON_CHANGE_HEADER.length - ID_INDEX - 1;
const EMPTY_CELLS = (width: number): null[] => Array.from({ length: width }, () => null);

const NOT_APPLIED_AMBIGUOUS_REASON = "Posible par no aplicado (ambiguo)";
const NOT_APPLIED_PENDING_REASON = "Posible par pendiente (coincidencia parcial)";

const NOT_APPLIED_REASON_OF: Partial<Record<PadronPair["status"], string>> = {
  [PAIR_STATUS.NOT_APPLIED_AMBIGUOUS]: NOT_APPLIED_AMBIGUOUS_REASON,
  [PAIR_STATUS.NOT_APPLIED_PENDING]: NOT_APPLIED_PENDING_REASON,
};

const GEOMETRY_KIND_OF: Record<GeometryState, ChangeKind> = {
  [GEOMETRY_STATE.APPLIED]: CHANGE_KIND.MODIFIED,
  [GEOMETRY_STATE.PENDING]: CHANGE_KIND.DETECTED,
};

interface PreviousPadron {
  type: string;
  locality: string;
  number: string;
}

interface PadronChangeRecord {
  kind: ChangeKind;
  key: PadronNamedKey;
  oldId: number | null;
  location: PadronLocation | null;
  previous: PreviousPadron | null;
  /** A geometry row carries the non-overlapping share of its area; a key update carries the signed change. */
  nonOverlap: boolean;
}

const previousOf = (key: PadronNamedKey): PreviousPadron => ({
  type: textOrNoData(key.typePadron),
  locality: textOrNoData(key.locality),
  number: textOrNoData(key.number),
});

const isApplied = (pair: PadronPair): boolean => pair.status === PAIR_STATUS.APPLIED;
const isNotApplied = (pair: PadronPair): boolean => NOT_APPLIED_REASON_OF[pair.status] !== undefined;

const insertedRecordsOf = (target: ActualizarTargetReport): PadronChangeRecord[] =>
  target.insertedList.map((padron) => ({
    kind: CHANGE_KIND.INSERTED,
    key: padron,
    oldId: null,
    location: null,
    previous: null,
    nonOverlap: false,
  }));

const removedRecordsOf = (target: ActualizarTargetReport): PadronChangeRecord[] =>
  (target.removedList ?? []).map((padron) => ({
    kind: CHANGE_KIND.REMOVED,
    key: padron,
    oldId: padron.id,
    location: null,
    previous: null,
    nonOverlap: false,
  }));

const geometryRecordOf = (change: PadronGeometryChange): PadronChangeRecord => ({
  kind: GEOMETRY_KIND_OF[change.state],
  key: change,
  oldId: change.oldId,
  location: change,
  previous: null,
  nonOverlap: true,
});

const geometryRecordsOf = (target: ActualizarTargetReport): PadronChangeRecord[] => target.geometryChanges.map(geometryRecordOf);

const keyUpdatedKindOf = (pair: PadronPair): ChangeKind =>
  pair.tier === PAIR_TIER.LOOSE ? CHANGE_KIND.KEY_UPDATED_LOOSE : CHANGE_KIND.KEY_UPDATED;

const keyUpdatedRecordsOf = (target: ActualizarTargetReport): PadronChangeRecord[] =>
  target.pairs.filter(isApplied).map((pair) => ({
    kind: keyUpdatedKindOf(pair),
    key: pair.new,
    oldId: pair.oldId,
    location: pair,
    previous: previousOf(pair.old),
    nonOverlap: false,
  }));

const compareText = (first: string, second: string): number => first.localeCompare(second, "es", { numeric: true });

const comparePadronChanges = (first: PadronChangeRecord, second: PadronChangeRecord): number =>
  compareChangeKinds(first.kind, second.kind) ||
  compareText(textOrNoData(first.key.department), textOrNoData(second.key.department)) ||
  compareText(textOrNoData(first.key.locality), textOrNoData(second.key.locality)) ||
  compareText(textOrNoData(first.key.number), textOrNoData(second.key.number));

const areaCellsOf = (record: PadronChangeRecord): [CsvRow[number], CsvRow[number]] => {
  const areaChange = record.location?.areaChangePct ?? null;
  return record.nonOverlap ? [null, areaChange] : [areaChange, null];
};

const changeRowOf = (table: string, record: PadronChangeRecord): CsvRow => [
  table,
  record.kind,
  textOrNoData(record.key.typePadron),
  textOrNoData(record.key.department),
  textOrNoData(record.key.locality),
  textOrNoData(record.key.number),
  record.oldId,
  record.location?.oldAreaM2 ?? null,
  record.location?.newAreaM2 ?? null,
  ...areaCellsOf(record),
  record.location?.centroidLat ?? null,
  record.location?.centroidLon ?? null,
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

const insertedCutOf = (target: ActualizarTargetReport): ListCut => ({
  table: target.table,
  shown: target.insertedList.length,
  total: target.inserted,
  noun: "padrones insertados",
});

const changeCutsOf = (target: ActualizarTargetReport): ListCut[] => [
  { table: target.table, shown: target.geometryChanges.length, total: target.changed, noun: "geometrías que cambian" },
  { table: target.table, shown: target.pairs.filter(isApplied).length, total: target.pairsApplied, noun: "claves actualizadas" },
  { table: target.table, shown: (target.removedList ?? []).length, total: target.removed ?? 0, noun: "padrones eliminados" },
];

/** An analysis lists no new padrones nor links (AP-88), so it has no cut for them: the note below says so instead. */
const cutsOf = ({ target, addressMaster, dryRun }: ActualizarPadronResult): ListCut[] => {
  if (dryRun) return changeCutsOf(target);
  return [
    insertedCutOf(target),
    ...changeCutsOf(target),
    ...(addressMaster === undefined ? [] : addressMasterCutsOf(target, addressMaster)),
  ];
};

const ANALYSIS_UNLISTED_NOTE = "El análisis no lista los padrones nuevos ni los enlaces de direcciones: solo los muestra la carga real.";

const analysisNoteRowsOf = (result: ActualizarPadronResult): CsvRow[] =>
  result.dryRun ? [[result.target.table, ANALYSIS_UNLISTED_NOTE, ...EMPTY_CELLS(PADRON_CHANGE_HEADER.length - 2)]] : [];

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
  const padronRows = [...insertedRecordsOf(target), ...geometryRecordsOf(target), ...keyUpdatedRecordsOf(target), ...removedRecordsOf(target)]
    .sort(comparePadronChanges)
    .map((record) => changeRowOf(target.table, record));
  const rows = [
    ...padronRows,
    ...(addressMaster === undefined ? [] : addressMasterRowsOf(addressMaster, target.table)),
    ...analysisNoteRowsOf(result),
  ];
  return listCsvOf(PADRON_CHANGE_HEADER, (row: CsvRow) => row, rows, cutsOf(result));
};

const INCONSISTENCY_HEADER: CsvRow = ["Motivo", "Departamento", "Localidad", "Padrón"];

const inconsistencyRowOf = (row: SkippedSample): CsvRow => [
  reasonLabelOf(row.reason),
  textOrNoData(row.department),
  textOrNoData(row.locality),
  textOrNoData(row.padron),
];

const notAppliedRowOf = (pair: PadronPair): CsvRow => [
  NOT_APPLIED_REASON_OF[pair.status] ?? null,
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
  const notApplied = onePerNewKey(target.pairs.filter(isNotApplied));
  const rows: CsvRow[] = [...skipped.skippedRows.map(inconsistencyRowOf), ...notApplied.map(notAppliedRowOf)];
  return listCsvOf(INCONSISTENCY_HEADER, (row: CsvRow) => row, rows, [
    { table: "", shown: skipped.skippedRows.length, total: totals.skipped, noun: "filas omitidas" },
    { table: "", shown: notApplied.length, total: target.pairsNotApplied + target.pairsPending, noun: "posibles pares no aplicados" },
  ]);
};
