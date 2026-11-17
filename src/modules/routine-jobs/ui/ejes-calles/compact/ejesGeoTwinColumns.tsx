import React from "react";
import type { EjesGeoTwinRow } from "../../../jobs/ejes-calles/types";
import { GEO_TWIN_ROLE } from "../../../jobs/ejes-calles/constants";
import type { TableColumn } from "../../shared/ReportParts";
import { textOrNoData } from "../../shared/reportFormat";
import { EjesRefCell } from "./EjesRefCell";
import { EjesRefsCell } from "./EjesRefsCell";

export const GEO_TWIN_TEXT = {
  KEPT: "Se mantiene",
  REMOVED_ON_ACCEPT: "Se quita al aceptar; si no, queda como está",
  NOT_LOADED: "No se carga",
  NOT_REMOVABLE: "No se quita",
  GROUP: (count: number) => `${count} con el mismo trazado`,
  POINTS: "Puntos de acceso",
} as const;

/** The status of a member: a keeper or the winner stays; a loser is removed only when it is in carto and accepted, else not loaded. */
const geoTwinStatusOf = (row: Pick<EjesGeoTwinRow, "role" | "inCarto">): string => {
  if (row.role !== GEO_TWIN_ROLE.LOSER) return GEO_TWIN_TEXT.KEPT;
  return row.inCarto ? GEO_TWIN_TEXT.REMOVED_ON_ACCEPT : GEO_TWIN_TEXT.NOT_LOADED;
};

/** Only a loser in carto is offered for removal; a keeper, the winner and a loser not in carto never are. */
export const isGeoTwinRemovable = (row: Pick<EjesGeoTwinRow, "role" | "inCarto">): boolean => row.role === GEO_TWIN_ROLE.LOSER && row.inCarto;

/** The columns of a geometric twin row, before the accept column. The partners are collapsed behind their count. */
export const GEO_TWIN_COLUMNS: TableColumn<EjesGeoTwinRow>[] = [
  {
    header: "Tramo",
    cell: (row) => <EjesRefCell primary={row.ref} secondary={`idcalle ${textOrNoData(row.idcalle)} · ${textOrNoData(row.localidad)}`} />,
  },
  {
    header: "Grupo",
    cell: (row) => <EjesRefsCell label={GEO_TWIN_TEXT.GROUP(row.partners.length)} refs={row.partners} />,
  },
  { header: "Qué pasa", cell: (row) => geoTwinStatusOf(row) },
  { header: GEO_TWIN_TEXT.POINTS, cell: (row) => String(row.points) },
];
