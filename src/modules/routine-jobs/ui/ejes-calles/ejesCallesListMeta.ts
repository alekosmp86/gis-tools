import type { EjesResult } from "../../jobs/ejes-calles/types";

export const EJES_LIST = {
  TWIN_UNDECIDED: "twinUndecided",
  SPLITS: "splits",
  MERGES: "merges",
  RENUMBER_HELD: "renumberHeld",
  RENUMBER_DROPPED: "renumberDropped",
  PLAIN_REMOVALS: "plainRemovals",
  KEPT_BY_DISCARDED: "keptByDiscarded",
  GEO_TWINS: "geoTwins",
  INVALID_GEOMETRIES: "invalidGeometries",
  NEW_STREETS: "newStreets",
  ATTR_CHANGES: "attrChanges",
} as const;

export type EjesListKey = (typeof EJES_LIST)[keyof typeof EJES_LIST];

const EJES_LIST_ORDER: readonly EjesListKey[] = [
  EJES_LIST.SPLITS,
  EJES_LIST.MERGES,
  EJES_LIST.RENUMBER_HELD,
  EJES_LIST.RENUMBER_DROPPED,
  EJES_LIST.TWIN_UNDECIDED,
  EJES_LIST.PLAIN_REMOVALS,
  EJES_LIST.GEO_TWINS,
  EJES_LIST.INVALID_GEOMETRIES,
  EJES_LIST.NEW_STREETS,
  EJES_LIST.ATTR_CHANGES,
];

export const ejesListAnchorOf = (key: EjesListKey): string => `ejes-list-${key}`;

export const EJES_LIST_INTROS: Record<EjesListKey, string> = {
  [EJES_LIST.SPLITS]: "Un tramo actual que el archivo reemplaza por varios nuevos.",
  [EJES_LIST.MERGES]: "Varios tramos actuales que el archivo reemplaza por uno nuevo.",
  [EJES_LIST.RENUMBER_HELD]: "Renumeración no aplicada: ambos tramos quedan como están y sus puntos de acceso no se mueven.",
  [EJES_LIST.RENUMBER_DROPPED]: "Reftramos nuevos de la misma calle y trazado que ya se renumeran a otro reftramo: no se cargan y no tienen puntos de acceso.",
  [EJES_LIST.TWIN_UNDECIDED]: "Ninguna regla decide cuál copia se queda: elíjala en el mapa.",
  [EJES_LIST.PLAIN_REMOVALS]: "Tramos actuales sin equivalente en el archivo; con puntos de acceso no se quitan.",
  [EJES_LIST.KEPT_BY_DISCARDED]: "Tramos actuales sin equivalente en el archivo que se conservan: el archivo trae una fila descartada con su mismo reftramo o en su mismo lugar, y ningún tramo nuevo lo reemplaza. La fila descartada no se carga.",
  [EJES_LIST.GEO_TWINS]: "Mismo idcalle y trazado con reftramo distinto: se queda el que tiene más puntos de acceso; los demás no se cargan y, al aceptarlos, sus puntos pasan al que se queda.",
  [EJES_LIST.INVALID_GEOMETRIES]: "Filas del archivo con geometría inválida o colapsada, o menor de 1 m sin puntos de acceso: se omiten.",
  [EJES_LIST.NEW_STREETS]: "Calles que no existen hoy y entrarían con los tramos nuevos.",
  [EJES_LIST.ATTR_CHANGES]: "Tramos con el mismo trazado pero distinto nombre, calle, tipo o fuente.",
};

const listSizeOf = (result: EjesResult): Record<EjesListKey, number> => ({
  [EJES_LIST.SPLITS]: result.splits.length,
  [EJES_LIST.MERGES]: result.merges.length,
  [EJES_LIST.RENUMBER_HELD]: result.renumberSkipped.length,
  [EJES_LIST.RENUMBER_DROPPED]: result.renumberDropped.length,
  [EJES_LIST.TWIN_UNDECIDED]: result.twinUndecided.length,
  [EJES_LIST.PLAIN_REMOVALS]: result.plainRemovals.length,
  [EJES_LIST.KEPT_BY_DISCARDED]: result.keptByDiscarded.length,
  [EJES_LIST.GEO_TWINS]: result.geoTwins.length,
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
    { key: "renumbered", label: "Renumerados", value: counts.renumbered, list: null },
    { key: "renumberedByGeometry", label: "de ellos, eligiendo por geometría", value: counts.renumberedByGeometry, list: null },
    { key: EJES_LIST.RENUMBER_DROPPED, label: "Candidatos descartados", value: counts.renumberDroppedCandidates, list: EJES_LIST.RENUMBER_DROPPED },
    { key: EJES_LIST.RENUMBER_HELD, label: "Renumerados retenidos", value: counts.renumberSkipped, list: EJES_LIST.RENUMBER_HELD },
    { key: EJES_LIST.SPLITS, label: "Divididos", value: counts.splits, list: EJES_LIST.SPLITS },
    { key: EJES_LIST.MERGES, label: "Unidos", value: counts.merges, list: EJES_LIST.MERGES },
    { key: EJES_LIST.PLAIN_REMOVALS, label: "Sin reemplazo", value: counts.plainRemovals, list: EJES_LIST.PLAIN_REMOVALS },
    { key: EJES_LIST.KEPT_BY_DISCARDED, label: "Se conservan por candidato descartado", value: counts.keptByDiscardedCandidate, list: EJES_LIST.KEPT_BY_DISCARDED },
    { key: "twins", label: "Repetidos por localidad", value: counts.twins, list: null },
    { key: EJES_LIST.TWIN_UNDECIDED, label: "Varias copias sin decidir", value: counts.twinsUndecided, list: EJES_LIST.TWIN_UNDECIDED },
    { key: EJES_LIST.GEO_TWINS, label: "Gemelos por geometría", value: counts.geoTwinSections, list: EJES_LIST.GEO_TWINS },
    { key: EJES_LIST.INVALID_GEOMETRIES, label: "Geometría inválida, colapsada o menor de 1 m", value: staging.invalidGeometryRows, list: EJES_LIST.INVALID_GEOMETRIES },
  ];
}

export function defaultOpenListOf(result: EjesResult): EjesListKey | null {
  const sizes = listSizeOf(result);
  const preferred = sizes[EJES_LIST.TWIN_UNDECIDED] > 0 ? EJES_LIST.TWIN_UNDECIDED : EJES_LIST_ORDER.find((key) => sizes[key] > 0);
  return preferred ?? null;
}

