import type { UnitGeometryChange, UnitResult, UnitTargetReport } from "../../jobs/unidad-territorial/types";
import { textOrNoData } from "../reportFormat";
import {
  CHANGE_KIND,
  changeCsvOf,
  orderedChangesOf,
  type ChangeRecord,
} from "./reportCsvRows";

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

export const buildUnidadTerritorialCsv = (result: UnitResult): string => changeCsvOf(targetChangesOf(result.target));
