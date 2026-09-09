import { DEFAULT_PORTAL_HOST } from "../domain/sourceNaming";
import type { WatchedSource } from "../types";

/**
 * Sources the module ships with: the national spatial data infrastructure datasets this tool was
 * built to track. They cannot be removed, only added to.
 */
export const DEFAULT_WATCHED_SOURCES: ReadonlyArray<WatchedSource> = [
  {
    id: "ide-ejes-vias-circulacion",
    title: "Ejes de vías de circulación",
    datasetSlug: "ide-ejes-vias-circulacion",
    portalHost: DEFAULT_PORTAL_HOST,
    description:
      "Geometría de ejes viales departamentales, nomenclatura oficial de calles y números de puerta.",
    isDefault: true,
  },
  {
    id: "ide-direcciones-geograficas-del-uruguay",
    title: "Direcciones Geográficas del Uruguay",
    datasetSlug: "ide-direcciones-geograficas-del-uruguay",
    portalHost: DEFAULT_PORTAL_HOST,
    description: "Sistema de direccionamiento único nacional y códigos postales departamentales.",
    isDefault: true,
  },
];
