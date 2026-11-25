import React from "react";
import type { EjesGeoTwinRow } from "../../../jobs/ejes-ide/types";
import { GEO_TWIN_ROLE } from "../../../jobs/ejes-ide/constants";
import type { TableColumn } from "../../shared/ReportParts";
import { textOrNoData } from "../../shared/reportFormat";
import { metersTextOf } from "../ejesIdeReportView";
import { EjesRefCell } from "./EjesRefCell";

export const GEO_TWIN_TEXT = {
  KEPT: "Se mantiene",
  REMOVED_ON_ACCEPT: "Se quita al aceptar; si no, queda como está",
  NOT_LOADED: "No se carga",
  NOT_REMOVABLE: "No se quita",
  LINKED_BY_ID: "No se puede quitar: sus puntos están enlazados por id",
  SEVERAL_SECTIONS: "No se puede quitar: hay varios tramos con ese reftramo en carto",
  KEPT_HEADER: "Se queda",
  REMOVED_HEADER: "Se quita",
  KEPT_PREFIX: "Se queda:",
  REMOVED_PREFIX: "Se quita:",
  IN_CARTO: (inCarto: boolean) => `en carto: ${inCarto ? "sí" : "no"}`,
} as const;

/** The status of a member: the winner stays; a loser is removed when accepted and removable, else it is not loaded (or it stays in carto). */
const geoTwinStatusOf = (row: Pick<EjesGeoTwinRow, "role" | "inCarto" | "removable">): string => {
  if (row.role !== GEO_TWIN_ROLE.LOSER) return GEO_TWIN_TEXT.KEPT;
  if (row.removable) return GEO_TWIN_TEXT.REMOVED_ON_ACCEPT;
  return row.inCarto ? GEO_TWIN_TEXT.NOT_REMOVABLE : GEO_TWIN_TEXT.NOT_LOADED;
};

/** Only a loser in carto with one section and no point by id is offered for removal (the load applies the same rule). */
export const isGeoTwinRemovable = (row: Pick<EjesGeoTwinRow, "removable">): boolean => row.removable;

/** The winner of the group, with its points, length, fuente and whether it is in carto. */
export const geoTwinKeptTextOf = (row: EjesGeoTwinRow): string =>
  `${GEO_TWIN_TEXT.KEPT_PREFIX} ${row.winnerRef} (${row.winnerPoints} puntos de acceso, ${metersTextOf(row.winnerLength)} m, fuente ${textOrNoData(row.winnerFuente)}, ${GEO_TWIN_TEXT.IN_CARTO(row.winnerInCarto)})`;

/** The row's own copy when it is removable, with the points that move to the winner; else the text that says why it is not. */
export const geoTwinRemovedTextOf = (row: EjesGeoTwinRow): string => {
  if (row.removable) return `${GEO_TWIN_TEXT.REMOVED_PREFIX} ${row.ref} (${row.points} puntos de acceso pasan al ${row.winnerRef})`;
  if (row.role !== GEO_TWIN_ROLE.LOSER || !row.inCarto) return GEO_TWIN_TEXT.NOT_REMOVABLE;
  return row.pointsById > 0 ? GEO_TWIN_TEXT.LINKED_BY_ID : GEO_TWIN_TEXT.SEVERAL_SECTIONS;
};

/** The columns of a geometric twin row, before the accept column: the winner against the copy this row would remove. */
export const GEO_TWIN_COLUMNS: TableColumn<EjesGeoTwinRow>[] = [
  {
    header: "Tramo",
    cell: (row) => <EjesRefCell primary={row.ref} secondary={`idcalle ${textOrNoData(row.idcalle)} · ${textOrNoData(row.localidad)}`} />,
  },
  { header: GEO_TWIN_TEXT.KEPT_HEADER, cell: geoTwinKeptTextOf },
  { header: GEO_TWIN_TEXT.REMOVED_HEADER, cell: geoTwinRemovedTextOf },
  { header: "Qué pasa", cell: (row) => geoTwinStatusOf(row) },
];
