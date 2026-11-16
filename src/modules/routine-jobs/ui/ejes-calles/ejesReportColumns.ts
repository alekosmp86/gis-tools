import type {
  EjesInvalidGeometryRow,
  EjesMergeRow,
  EjesNewStreetRow,
  EjesRemovalRow,
  EjesRenumberedRow,
  EjesRenumberSkippedRow,
  EjesSplitRow,
  EjesTwinRow,
} from "../../jobs/ejes-calles/types";
import { coverageTextOf, metersTextOf, twinDecisionTextOf, twinRowCaseTextOf, type EjesAttrRowView } from "./ejesCallesReportView";
import { NO_REFTRAMO_TEXT, RENUMBER_SKIP_TEXT } from "./ejesLoadTexts";
import type { TableColumn } from "../shared/ReportParts";
import { textOrNoData } from "../shared/reportFormat";

export const SPLIT_COLUMNS: TableColumn<EjesSplitRow>[] = [
  { header: "reftramo quitado", cell: (row) => row.oldRef },
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "reftramo nuevos", cell: (row) => row.newRefs.join(", ") },
  { header: "Puntos de acceso", cell: (row) => String(row.points) },
  { header: "Cobertura", cell: (row) => coverageTextOf(row.coverage) },
  { header: "Largo anterior (m)", cell: (row) => metersTextOf(row.oldLength) },
  { header: "Largo nuevo (m)", cell: (row) => metersTextOf(row.newLength) },
  { header: "Nuevo fuera del anterior (m)", cell: (row) => metersTextOf(row.outsideLength) },
];

export const MERGE_COLUMNS: TableColumn<EjesMergeRow>[] = [
  { header: "reftramo nuevo", cell: (row) => row.newRef },
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "reftramo quitados", cell: (row) => row.oldRefs.join(", ") },
  { header: "Puntos de acceso", cell: (row) => String(row.points) },
  { header: "Cobertura", cell: (row) => coverageTextOf(row.coverage) },
  { header: "Largo anterior (m)", cell: (row) => metersTextOf(row.oldLength) },
  { header: "Largo nuevo (m)", cell: (row) => metersTextOf(row.newLength) },
  { header: "Nuevo fuera del anterior (m)", cell: (row) => metersTextOf(row.outsideLength) },
];

export const RENUMBERED_COLUMNS: TableColumn<EjesRenumberedRow>[] = [
  { header: "reftramo anterior", cell: (row) => row.oldRef },
  { header: "reftramo nuevo", cell: (row) => row.newRef },
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "Puntos de acceso", cell: (row) => String(row.points) },
  { header: "Largo anterior (m)", cell: (row) => metersTextOf(row.oldLength) },
  { header: "Largo nuevo (m)", cell: (row) => metersTextOf(row.newLength) },
];

export const RENUMBER_HELD_COLUMNS: TableColumn<EjesRenumberSkippedRow>[] = [
  { header: "reftramo anterior", cell: (row) => row.oldRef },
  { header: "reftramo nuevo", cell: (row) => row.newRef },
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "Puntos de acceso", cell: (row) => String(row.points) },
  { header: "Motivo", cell: (row) => RENUMBER_SKIP_TEXT[row.reason] },
];

export const REMOVAL_COLUMNS: TableColumn<EjesRemovalRow>[] = [
  { header: "reftramo", cell: (row) => (row.ref === "" ? NO_REFTRAMO_TEXT : row.ref) },
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "Puntos de acceso", cell: (row) => String(row.points) },
  { header: "Qué pasa", cell: (row) => (row.points > 0 ? "No se quita: tiene puntos de acceso" : "Se quita") },
];

export const STREET_COLUMNS: TableColumn<EjesNewStreetRow>[] = [
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "Nombre", cell: (row) => textOrNoData(row.name) },
  { header: "Nombre corto", cell: (row) => textOrNoData(row.shortName) },
  { header: "Departamento", cell: (row) => textOrNoData(row.departments) },
  { header: "Localidad", cell: (row) => textOrNoData(row.localities) },
  { header: "Tipo de vía", cell: (row) => textOrNoData(row.tipos) },
  { header: "Tramos nuevos", cell: (row) => String(row.sections) },
];

export const INVALID_GEOMETRY_COLUMNS: TableColumn<EjesInvalidGeometryRow>[] = [
  { header: "reftramo", cell: (row) => row.ref },
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "Localidad", cell: (row) => textOrNoData(row.localidad) },
  { header: "Departamento", cell: (row) => textOrNoData(row.departamento) },
];

export const ATTR_COLUMNS: TableColumn<EjesAttrRowView>[] = [
  { header: "reftramo", cell: (row) => row.ref },
  { header: "Cambia", cell: (row) => row.changes },
  { header: "Nombre actual", cell: (row) => textOrNoData(row.currentName) },
  { header: "Nombre nuevo", cell: (row) => textOrNoData(row.name) },
  { header: "idcalle actual", cell: (row) => textOrNoData(row.currentIdcalle) },
  { header: "idcalle nuevo", cell: (row) => textOrNoData(row.idcalle) },
];

export const TWIN_COLUMNS: TableColumn<EjesTwinRow>[] = [
  { header: "reftramo", cell: (row) => row.ref },
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "Departamento", cell: (row) => textOrNoData(row.department) },
  { header: "Localidades", cell: (row) => row.localities.join(", ") },
  { header: "Caso", cell: twinRowCaseTextOf },
  { header: "Largo (m)", cell: (row) => metersTextOf(row.length) },
  { header: "Cerca de urbanos (m)", cell: (row) => metersTextOf(row.urbanLength) },
  { header: "Cerca de rurales (m)", cell: (row) => metersTextOf(row.ruralLength) },
  { header: "Qué pasa", cell: twinDecisionTextOf },
];
