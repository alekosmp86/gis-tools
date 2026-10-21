import { SigraLayerId } from "../constants";

export const LayerGroupId = {
  AVANCE: "AVANCE",
  AREAS: "AREAS",
  CENTRALES_LIMITES: "CENTRALES_LIMITES",
  CAJAS: "CAJAS",
  RED: "RED",
} as const;

export type LayerGroupId = (typeof LayerGroupId)[keyof typeof LayerGroupId];

export interface LayerGroup {
  readonly id: LayerGroupId;
  readonly label: string;
  readonly layerIds: ReadonlyArray<SigraLayerId>;
}

/** How the layer table is organised for the operator; every registry layer belongs to exactly one group. */
export const LAYER_GROUPS: ReadonlyArray<LayerGroup> = [
  {
    id: LayerGroupId.AVANCE,
    label: "Necesarias para Avance FTTH",
    layerIds: [SigraLayerId.ZONAS_FTTH, SigraLayerId.LIMITE_CENTRAL_FTTH],
  },
  {
    id: LayerGroupId.AREAS,
    label: "Áreas",
    layerIds: [
      SigraLayerId.AREA_CD_SR,
      SigraLayerId.AREA_CABLE_COBRE,
      SigraLayerId.AREA_CABLE_FTTH,
      SigraLayerId.AREA_CAJITAS_COBRE,
      SigraLayerId.AREA_TFO,
    ],
  },
  {
    id: LayerGroupId.CENTRALES_LIMITES,
    label: "Centrales y límites",
    layerIds: [
      SigraLayerId.LIMITE_CENTRAL_COBRE,
      SigraLayerId.LIMITE_ECONOMICO_COBRE,
      SigraLayerId.LIMITE_MIXTO_COBRE,
      SigraLayerId.CENTRALES_COBRE,
      SigraLayerId.CENTRALES_FTTH,
    ],
  },
  {
    id: LayerGroupId.CAJAS,
    label: "Cajas y divisores",
    layerIds: [SigraLayerId.CAJA_DISTRIBUCION, SigraLayerId.CAJITAS_COBRE, SigraLayerId.TFO_DIVISORES],
  },
  {
    id: LayerGroupId.RED,
    label: "Red y seguridad",
    layerIds: [SigraLayerId.CAMARAS, SigraLayerId.POSTES, SigraLayerId.ZONAS_INSEGURIDAD],
  },
];
