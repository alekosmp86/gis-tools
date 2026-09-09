import type { WatchedSourceConfig } from "../types/watcher";

/**
 * Preconfigured default open cartography datasets from IDEuy (catalogodatos.gub.uy).
 */
export const DEFAULT_WATCHED_SOURCES: readonly WatchedSourceConfig[] = [
  {
    id: "ide-ejes-vias-circulacion",
    title: "Ejes de vías de circulación",
    datasetSlug: "ide-ejes-vias-circulacion",
    url: "https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion",
    description: "Geometría de ejes viales departamentales, nomenclatura oficial de calles y números de puerta.",
    category: "Vialidad",
    isDefault: true,
  },
  {
    id: "ide-direcciones-geograficas-del-uruguay",
    title: "Direcciones Geográficas del Uruguay",
    datasetSlug: "ide-direcciones-geograficas-del-uruguay",
    url: "https://catalogodatos.gub.uy/dataset/ide-direcciones-geograficas-del-uruguay",
    description: "Sistema de direccionamiento único nacional y códigos postales departamentales.",
    category: "Direcciones",
    isDefault: true,
  },
];
