import type { AddressMasterLinked } from "../../jobs/shared/addressMasterLinkPass";
import type { AddressMasterReport } from "../../jobs/shared/addressMasterLinkReport";
import { UNIT_SUBJECT_SPEC } from "../../jobs/shared/addressMasterLinkSpec";
import type { UnitGeometryChange, UnitResult, UnitTargetReport } from "../../jobs/unidad-territorial/types";
import { textOrNoData } from "../reportFormat";
import type { CsvRow } from "./csvFormat";
import {
  CHANGE_HEADER,
  CHANGE_KIND,
  changeRowOf,
  listCsvOf,
  orderedChangesOf,
  type ChangeRecord,
  type ListCut,
} from "./reportCsvRows";

const ADDRESS_MASTER_ID_HEADER = "Id dirección maestra";
const HEADER: CsvRow = [...CHANGE_HEADER, ADDRESS_MASTER_ID_HEADER];

const insertedChangesOf = (target: UnitTargetReport): ChangeRecord[] =>
  target.insertedList.map((unit) => ({
    table: target.table,
    kind: CHANGE_KIND.INSERTED,
    province: textOrNoData(unit.provinceId),
    name: textOrNoData(unit.name),
    id: unit.id,
    distance: null,
    areaRatio: null,
  }));

const geometryChangesOf = (target: UnitTargetReport, changes: UnitGeometryChange[]): ChangeRecord[] =>
  changes.map((change) => ({
    table: target.table,
    kind: target.updateApplied ? CHANGE_KIND.MODIFIED : CHANGE_KIND.DETECTED,
    province: textOrNoData(change.provinceId),
    name: textOrNoData(change.name),
    id: null,
    distance: change.distance,
    areaRatio: change.areaRatio,
  }));

const targetChangesOf = (target: UnitTargetReport): ChangeRecord[] =>
  orderedChangesOf([...insertedChangesOf(target), ...geometryChangesOf(target, target.geometryChanges)]);

const targetCutsOf = (target: UnitTargetReport): ListCut[] => [
  { table: target.table, shown: target.insertedList.length, total: target.inserted, noun: "unidades insertadas" },
  { table: target.table, shown: target.geometryChanges.length, total: target.changed, noun: "geometrías que cambian" },
];

const withEmptyAddressMasterCell = (record: ChangeRecord): CsvRow => [...changeRowOf(record), null];

const addressMasterRowOf = (table: string, kind: string, unit: AddressMasterLinked): CsvRow => [
  table,
  kind,
  textOrNoData(unit.provinceId),
  textOrNoData(unit.name),
  unit.id,
  null,
  null,
  unit.addressMasterId,
];

const addressMasterRowsOf = (addressMaster: AddressMasterReport, targetTable: string): CsvRow[] => {
  const { texts } = UNIT_SUBJECT_SPEC;
  const created = addressMaster.linkedList.filter((unit) => unit.created);
  return [
    ...created.map((unit) => addressMasterRowOf(addressMaster.table, texts.createdChangeKind, unit)),
    ...addressMaster.linkedList.map((unit) => addressMasterRowOf(targetTable, texts.linkedChangeKind, unit)),
  ];
};

const addressMasterCutsOf = (targetTable: string, addressMaster: AddressMasterReport): ListCut[] => {
  const created = addressMaster.linkedList.filter((unit) => unit.created);
  return [
    {
      table: addressMaster.table,
      shown: created.length,
      total: addressMaster.counts.created,
      noun: `direcciones maestras creadas${UNIT_SUBJECT_SPEC.texts.createdScope}`,
    },
    {
      table: targetTable,
      shown: addressMaster.linkedList.length,
      total: addressMaster.counts.linked,
      noun: UNIT_SUBJECT_SPEC.texts.linkedNoun,
    },
  ];
};

export const buildUnidadTerritorialCsv = (result: UnitResult): string => {
  const { target, addressMaster } = result;
  const rows: CsvRow[] = [
    ...targetChangesOf(target).map(withEmptyAddressMasterCell),
    ...(addressMaster === undefined ? [] : addressMasterRowsOf(addressMaster, target.table)),
  ];
  const cuts = [...targetCutsOf(target), ...(addressMaster === undefined ? [] : addressMasterCutsOf(target.table, addressMaster))];
  return listCsvOf(HEADER, (row: CsvRow) => row, rows, cuts);
};
