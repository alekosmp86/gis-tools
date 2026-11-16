import type { EjesResult } from "../../jobs/ejes-calles/types";

export const EJES_LIST = {
  TWINS: "twins",
  SPLITS: "splits",
  MERGES: "merges",
  RENUMBERED: "renumbered",
  RENUMBER_HELD: "renumberHeld",
  PLAIN_REMOVALS: "plainRemovals",
  INVALID_GEOMETRIES: "invalidGeometries",
  NEW_STREETS: "newStreets",
  ATTR_CHANGES: "attrChanges",
} as const;

export type EjesListKey = (typeof EJES_LIST)[keyof typeof EJES_LIST];

const EJES_LIST_ORDER: readonly EjesListKey[] = [
  EJES_LIST.SPLITS,
  EJES_LIST.MERGES,
  EJES_LIST.RENUMBERED,
  EJES_LIST.RENUMBER_HELD,
  EJES_LIST.TWINS,
  EJES_LIST.PLAIN_REMOVALS,
  EJES_LIST.INVALID_GEOMETRIES,
  EJES_LIST.NEW_STREETS,
  EJES_LIST.ATTR_CHANGES,
];

export const ejesListAnchorOf = (key: EjesListKey): string => `ejes-list-${key}`;

export const EJES_LIST_INTROS: Record<EjesListKey, string> = {
  [EJES_LIST.SPLITS]: "Un tramo actual que el archivo reemplaza por varios nuevos.",
  [EJES_LIST.MERGES]: "Varios tramos actuales que el archivo reemplaza por uno nuevo.",
  [EJES_LIST.RENUMBERED]: "Mismo trazado con otro reftramo: los puntos de acceso siguen al nuevo.",
  [EJES_LIST.RENUMBER_HELD]: "Renumeración no aplicada: ambos tramos quedan como están y sus puntos de acceso no se mueven.",
  [EJES_LIST.TWINS]: "Mismo reftramo en varias localidades: revisar en el mapa cuál copia se queda.",
  [EJES_LIST.PLAIN_REMOVALS]: "Tramos actuales sin equivalente en el archivo; con puntos de acceso no se quitan.",
  [EJES_LIST.INVALID_GEOMETRIES]: "Filas del archivo con geometría inválida o colapsada: se omiten.",
  [EJES_LIST.NEW_STREETS]: "Calles que no existen hoy y entrarían con los tramos nuevos.",
  [EJES_LIST.ATTR_CHANGES]: "Tramos con el mismo trazado pero distinto nombre, calle, tipo o fuente.",
};

const listSizeOf = (result: EjesResult): Record<EjesListKey, number> => ({
  [EJES_LIST.SPLITS]: result.splits.length,
  [EJES_LIST.MERGES]: result.merges.length,
  [EJES_LIST.RENUMBERED]: result.renumbered.length,
  [EJES_LIST.RENUMBER_HELD]: result.renumberSkipped.length,
  [EJES_LIST.TWINS]: result.twins.length,
  [EJES_LIST.PLAIN_REMOVALS]: result.plainRemovals.length,
  [EJES_LIST.INVALID_GEOMETRIES]: result.staging.invalidGeometries.length,
  [EJES_LIST.NEW_STREETS]: result.newStreets.length,
  [EJES_LIST.ATTR_CHANGES]: result.attrChanges.length,
});

export interface EjesStripItem {
  key: string;
  label: string;
  value: number;
  list: EjesListKey | null;
}

export function stripOf(result: EjesResult): EjesStripItem[] {
  const { counts, staging } = result;
  return [
    { key: "rows", label: "Filas del archivo", value: staging.rows, list: null },
    { key: EJES_LIST.NEW_STREETS, label: "Calles nuevas", value: result.newStreets.length, list: EJES_LIST.NEW_STREETS },
    { key: EJES_LIST.ATTR_CHANGES, label: "Cambios de atributos", value: counts.attr, list: EJES_LIST.ATTR_CHANGES },
    { key: EJES_LIST.RENUMBERED, label: "Renumerados", value: counts.renumbered, list: EJES_LIST.RENUMBERED },
    { key: EJES_LIST.RENUMBER_HELD, label: "Renumerados retenidos", value: counts.renumberSkipped, list: EJES_LIST.RENUMBER_HELD },
    { key: EJES_LIST.SPLITS, label: "Divididos", value: counts.splits, list: EJES_LIST.SPLITS },
    { key: EJES_LIST.MERGES, label: "Unidos", value: counts.merges, list: EJES_LIST.MERGES },
    { key: EJES_LIST.PLAIN_REMOVALS, label: "Sin reemplazo", value: counts.plainRemovals, list: EJES_LIST.PLAIN_REMOVALS },
    { key: EJES_LIST.TWINS, label: "Repetidos por localidad", value: counts.twins, list: EJES_LIST.TWINS },
    { key: EJES_LIST.INVALID_GEOMETRIES, label: "Geometría inválida o colapsada", value: staging.invalidGeometryRows, list: EJES_LIST.INVALID_GEOMETRIES },
  ];
}

export function defaultOpenListOf(result: EjesResult): EjesListKey | null {
  const sizes = listSizeOf(result);
  const preferred = sizes[EJES_LIST.TWINS] > 0 ? EJES_LIST.TWINS : EJES_LIST_ORDER.find((key) => sizes[key] > 0);
  return preferred ?? null;
}

