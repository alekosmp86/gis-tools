import React from "react";
import type { EjesGeoTwinRow } from "../../../jobs/ejes-calles/types";
import { GEO_TWIN_ROLE } from "../../../jobs/ejes-calles/constants";
import type { TableColumn } from "../../shared/ReportParts";
import { textOrNoData } from "../../shared/reportFormat";
import { metersTextOf } from "../ejesCallesReportView";
import { EjesRefCell } from "./EjesRefCell";

export const GEO_TWIN_TEXT = {
  KEPT: "Se mantiene",
  REMOVED_ON_ACCEPT: "Se quita al aceptar; si no, queda como está",
  NOT_LOADED: "No se carga",
  NOT_REMOVABLE: "No se quita",
  KEPT_HEADER: "Se queda",
  REMOVED_HEADER: "Se quita",
  IN_CARTO: (inCarto: boolean) => `en carto: ${inCarto ? "sí" : "no"}`,
} as const;

/** The status of a member: a keeper or the winner stays; a loser is removed only when it is in carto and accepted, else not loaded. */
const geoTwinStatusOf = (row: Pick<EjesGeoTwinRow, "role" | "inCarto">): string => {
  if (row.role !== GEO_TWIN_ROLE.LOSER) return GEO_TWIN_TEXT.KEPT;
  return row.inCarto ? GEO_TWIN_TEXT.REMOVED_ON_ACCEPT : GEO_TWIN_TEXT.NOT_LOADED;
};

/** Only a loser in carto is offered for removal; a keeper, the winner and a loser not in carto never are. */
export const isGeoTwinRemovable = (row: Pick<EjesGeoTwinRow, "role" | "inCarto">): boolean => row.role === GEO_TWIN_ROLE.LOSER && row.inCarto;

/** The group member kept: its reftramo, points, length, fuente and whether it is in carto. */
export const geoTwinKeptTextOf = (row: EjesGeoTwinRow): string =>
  `${row.keeperRef} (${row.keeperPoints} puntos de acceso, ${metersTextOf(row.keeperLength)} m, fuente ${textOrNoData(row.keeperFuente)}, ${GEO_TWIN_TEXT.IN_CARTO(row.keeperInCarto)})`;

/** The row's own copy when it is removable, else the text that says it is not. */
export const geoTwinRemovedTextOf = (row: EjesGeoTwinRow): string =>
  isGeoTwinRemovable(row) ? `${row.ref} (${row.points} puntos de acceso)` : GEO_TWIN_TEXT.NOT_REMOVABLE;

/** The columns of a geometric twin row, before the accept column: the kept member against the copy this row would remove. */
export const GEO_TWIN_COLUMNS: TableColumn<EjesGeoTwinRow>[] = [
  {
    header: "Tramo",
    cell: (row) => <EjesRefCell primary={row.ref} secondary={`idcalle ${textOrNoData(row.idcalle)} · ${textOrNoData(row.localidad)}`} />,
  },
  { header: GEO_TWIN_TEXT.KEPT_HEADER, cell: geoTwinKeptTextOf },
  { header: GEO_TWIN_TEXT.REMOVED_HEADER, cell: geoTwinRemovedTextOf },
  { header: "Qué pasa", cell: (row) => geoTwinStatusOf(row) },
];
