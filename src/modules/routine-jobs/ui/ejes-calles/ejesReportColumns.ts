import { DISTANCE_DECIMALS } from "../../jobs/ejes-calles/constants";
import type { EjesInvalidGeometryRow, EjesNewStreetRow, EjesRemovalRow, EjesRenumberDroppedRow } from "../../jobs/ejes-calles/types";
import type { EjesAttrRowView } from "./ejesCallesReportView";
import type { EjesHeldRenumberView } from "./ejesRenumberHeldView";
import { NO_REFTRAMO_TEXT, RENUMBER_SKIP_TEXT } from "./ejesLoadTexts";
import type { TableColumn } from "../shared/ReportParts";
import { textOrNoData } from "../shared/reportFormat";

export const HELD_RENUMBER_COLUMNS: TableColumn<EjesHeldRenumberView>[] = [
  { header: "reftramo anterior", cell: (view) => view.oldRef },
  { header: "Candidatos", cell: (view) => view.newRefs.join(", ") },
  { header: "idcalle", cell: (view) => textOrNoData(view.idcalle) },
  { header: "Puntos de acceso", cell: (view) => String(view.points) },
  { header: "Motivo", cell: (view) => RENUMBER_SKIP_TEXT[view.reason] },
];

export const RENUMBER_DROPPED_COLUMNS: TableColumn<EjesRenumberDroppedRow>[] = [
  { header: "reftramo descartado", cell: (row) => row.ref },
  { header: "reftramo anterior", cell: (row) => row.oldRef },
  { header: "reftramo que se queda", cell: (row) => row.keptRef },
  { header: "Hausdorff (m)", cell: (row) => textOrNoData(row.hausdorff === null ? null : row.hausdorff.toFixed(DISTANCE_DECIMALS)) },
  { header: "Puntos de acceso", cell: (row) => String(row.points) },
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
