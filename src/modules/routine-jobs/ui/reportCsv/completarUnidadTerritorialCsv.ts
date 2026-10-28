import type { CompletarLinkedUnit, CompletarResult } from "../../jobs/completar-unidad-territorial/types";
import { textOrNoData } from "../reportFormat";
import { toCsv, type CsvRow } from "./csvFormat";
import { cutRowsOf } from "./reportCsvRows";

const HEADER: CsvRow = ["Tabla", "Cambio", "Provincia", "Nombre", "Id", "Id dirección maestra"];

const CHANGE_KIND = {
  CREATED: "Dirección maestra creada",
  LINKED: "Unidad enlazada",
} as const;

const rowOf = (table: string, kind: string, unit: CompletarLinkedUnit): CsvRow => [
  table,
  kind,
  textOrNoData(unit.provinceId),
  textOrNoData(unit.name),
  unit.id,
  unit.addressMasterId,
];

export function buildCompletarUnidadTerritorialCsv(result: CompletarResult): string {
  const created = result.linkedList.filter((unit) => unit.created);
  return toCsv([
    HEADER,
    ...created.map((unit) => rowOf(result.addressMasterTable, CHANGE_KIND.CREATED, unit)),
    ...result.linkedList.map((unit) => rowOf(result.unitTable, CHANGE_KIND.LINKED, unit)),
    ...cutRowsOf(
      [
        { table: result.addressMasterTable, shown: created.length, total: result.counts.created, noun: "direcciones maestras creadas" },
        { table: result.unitTable, shown: result.linkedList.length, total: result.counts.linked, noun: "unidades enlazadas" },
      ],
      HEADER.length
    ),
  ]);
}
