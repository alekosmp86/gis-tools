import type { CargarLocalidadesResult, GeometryChange, TargetReport } from "../../jobs/cargar-localidades/types";
import { textOrNoData } from "../reportFormat";
import {
  CHANGE_KIND,
  changeCsvOf,
  orderedChangesOf,
  type ChangeRecord,
  type ListCut,
} from "./reportCsvRows";

const insertedChangesOf = (table: string, localities: TargetReport["insertedList"]): ChangeRecord[] =>
  localities.map((locality) => ({
    table,
    kind: CHANGE_KIND.INSERTED,
    province: textOrNoData(locality.department),
    name: textOrNoData(locality.name),
    id: locality.id,
    distance: null,
    areaRatio: null,
  }));

const geometryChangesOf = (table: string, applied: boolean, changes: GeometryChange[]): ChangeRecord[] =>
  changes.map((change) => ({
    table,
    kind: applied ? CHANGE_KIND.MODIFIED : CHANGE_KIND.DETECTED,
    province: textOrNoData(change.department),
    name: textOrNoData(change.name),
    id: null,
    distance: change.distance,
    areaRatio: change.areaRatio,
  }));

const targetChangesOf = (target: TargetReport): ChangeRecord[] =>
  orderedChangesOf([
    ...insertedChangesOf(target.table, target.insertedList),
    ...geometryChangesOf(target.table, target.updateApplied, target.geometryChanges),
  ]);

const targetCutsOf = (target: TargetReport): ListCut[] => [
  { table: target.table, shown: target.insertedList.length, total: target.inserted, noun: "localidades insertadas" },
  { table: target.table, shown: target.geometryChanges.length, total: target.changed, noun: "geometrías que cambian" },
];

export const buildCargarLocalidadesCsv = (result: CargarLocalidadesResult): string =>
  changeCsvOf(
    result.targets.flatMap((target) => targetChangesOf(target)),
    result.targets.flatMap(targetCutsOf)
  );
