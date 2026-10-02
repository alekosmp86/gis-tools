import {
  Decision,
  DecisionFilter,
  DecisionReason,
  DedupTab,
  ExportFormat,
  FILTER_ALL,
  Fuente,
  GroupSort,
  OTHER_FUENTE_COLUMN,
} from "../constants";
import type { FuenteColumn } from "../domain/summaryView";
import type { AnalysisTextField, SelectOption } from "../types";

export const DECISION_LABELS: Readonly<Record<Decision, string>> = {
  [Decision.KEEP]: "Conservar",
  [Decision.REMOVE]: "Eliminar",
};

export const REASON_LABELS: Readonly<Record<DecisionReason, string>> = {
  [DecisionReason.PROTECTED_SOURCE]: "Fuente protegida",
  [DecisionReason.INFRA_MATCHED]: "Vinculada a infraestructura",
  [DecisionReason.NO_DUPLICATE]: "Sin duplicado",
  [DecisionReason.LOWEST_URN_KEPT]: "Urn más bajo conservado",
  [DecisionReason.KEPT_ALONGSIDE_PROTECTED]: "Conservada junto a fuente protegida (revisar)",
  [DecisionReason.REDUNDANT_WITH_MATCHED]: "Redundante con una vinculada",
  [DecisionReason.REDUNDANT_NOT_LOWEST_URN]: "Redundante (no es el urn más bajo)",
  [DecisionReason.REDUNDANT_WITH_PROTECTED]: "Redundante con fuente protegida",
};

export const REASON_DESCRIPTIONS: Readonly<Record<DecisionReason, string>> = {
  [DecisionReason.PROTECTED_SOURCE]: "La fuente está protegida (IDE): nunca se elimina.",
  [DecisionReason.INFRA_MATCHED]:
    "Está vinculada a infraestructura (servicio/CTO TLK o dispositivo NAP): se conserva.",
  [DecisionReason.NO_DUPLICATE]: "No tiene duplicados: grupo de una sola fila.",
  [DecisionReason.LOWEST_URN_KEPT]:
    "Ningún miembro está vinculado; se conserva el urn más bajo entre ANTEL/TLK y el grupo no tiene fuente protegida.",
  [DecisionReason.KEPT_ALONGSIDE_PROTECTED]:
    "Conservada junto a una fuente protegida: es el caso a revisar visualmente.",
  [DecisionReason.REDUNDANT_WITH_MATCHED]:
    "Otro miembro ANTEL/TLK del grupo está vinculado a infraestructura.",
  [DecisionReason.REDUNDANT_NOT_LOWEST_URN]:
    "Ningún miembro está vinculado y no es el urn más bajo del grupo.",
  [DecisionReason.REDUNDANT_WITH_PROTECTED]:
    "Duplicada de una fuente protegida y sin vínculo (solo con la opción activada).",
};

export const REASONS_BY_DECISION: Readonly<Record<Decision, ReadonlyArray<DecisionReason>>> = {
  [Decision.REMOVE]: [
    DecisionReason.REDUNDANT_WITH_MATCHED,
    DecisionReason.REDUNDANT_NOT_LOWEST_URN,
    DecisionReason.REDUNDANT_WITH_PROTECTED,
  ],
  [Decision.KEEP]: [
    DecisionReason.PROTECTED_SOURCE,
    DecisionReason.INFRA_MATCHED,
    DecisionReason.NO_DUPLICATE,
    DecisionReason.LOWEST_URN_KEPT,
    DecisionReason.KEPT_ALONGSIDE_PROTECTED,
  ],
};

export const OTHER_FUENTES_LABEL = "Otras / sin fuente";

export const MATRIX_COLUMNS: ReadonlyArray<{ readonly column: FuenteColumn; readonly label: string }> = [
  { column: Fuente.ANTEL, label: "ANTEL" },
  { column: Fuente.TLK, label: "TLK" },
  { column: Fuente.IDE, label: "IDE" },
  { column: OTHER_FUENTE_COLUMN, label: OTHER_FUENTES_LABEL },
];

export const SUMMARY_DECISIONS: ReadonlyArray<Decision> = [Decision.REMOVE, Decision.KEEP];

export const TAB_LABELS: Readonly<Record<DedupTab, string>> = {
  [DedupTab.SUMMARY]: "Resumen",
  [DedupTab.GROUPS]: "Grupos",
};

export const OPTION_CHIP_LABELS = {
  PROTECTED_SIBLING: "Elimina duplicados de IDE",
  INCLUDE_GROUPS: "Incluye grupos sin eliminaciones",
} as const;

export const EXPORT_BUTTONS: ReadonlyArray<{
  readonly format: ExportFormat;
  readonly label: string;
  readonly description: string;
}> = [
  { format: ExportFormat.CSV, label: "CSV", description: "Descargar todas las filas en CSV" },
  { format: ExportFormat.GEOJSON, label: "Puntos", description: "Descargar GeoJSON de puntos (una fila por punto)" },
  { format: ExportFormat.LINKS, label: "Enlaces", description: "Descargar GeoJSON de enlaces (una línea por grupo)" },
];

export const DECISION_FILTER_OPTIONS: ReadonlyArray<SelectOption<DecisionFilter>> = [
  { value: DecisionFilter.ALL, label: "Todas" },
  { value: DecisionFilter.REMOVE, label: DECISION_LABELS[Decision.REMOVE] },
  { value: DecisionFilter.KEEP, label: DECISION_LABELS[Decision.KEEP] },
];

export type ReasonFilter = DecisionReason | typeof FILTER_ALL;

export const REASON_FILTER_OPTIONS: ReadonlyArray<SelectOption<ReasonFilter>> = [
  { value: FILTER_ALL, label: "Todos" },
  ...Object.values(DecisionReason).map((reason) => ({ value: reason, label: REASON_LABELS[reason] })),
];

export const SORT_OPTIONS: ReadonlyArray<SelectOption<GroupSort>> = [
  { value: GroupSort.GROUP_ASC, label: "Grupo ascendente" },
  { value: GroupSort.SIZE_DESC, label: "Tamaño descendente" },
  { value: GroupSort.REMOVALS_DESC, label: "Eliminaciones descendente" },
];

export const GROUP_PAGE_SIZE_OPTIONS: ReadonlyArray<number> = [10, 25, 50, 100];
export const DEFAULT_GROUP_PAGE_SIZE = 25;

export const LOADING_MESSAGE =
  "La consulta se ejecuta en PostgreSQL y puede tardar hasta 3 minutos. No cierre esta página.";

/** The fields that enter `match_key`, in key order, so a reader sees why rows were grouped. */
export const MATCH_KEY_COLUMNS: ReadonlyArray<{
  readonly field: AnalysisTextField;
  readonly label: string;
}> = [
  { field: "province", label: "Provincia" },
  { field: "province_code", label: "Cód. provincia" },
  { field: "raw_rs_censal_locality_code", label: "Cód. localidad" },
  { field: "locality", label: "Localidad" },
  { field: "postal_code", label: "Cód. postal" },
  { field: "padron_locality_or_geo", label: "Localidad padrón / geo" },
  { field: "street_name", label: "Calle" },
  { field: "street_number", label: "Número" },
  { field: "letter", label: "Letra" },
  { field: "square", label: "Manzana" },
  { field: "sandlot", label: "Solar" },
  { field: "km", label: "Km" },
  { field: "padron", label: "Padrón" },
  { field: "type_padron", label: "Tipo de padrón" },
  { field: "rs_reftramo", label: "Ref. tramo" },
];

export const GROUP_TABLE_COLUMNS: ReadonlyArray<string> = [
  "Fuente",
  "URN",
  ...MATCH_KEY_COLUMNS.map((column) => column.label),
  "Decisión",
  "Motivo",
];

export const GROUP_TABLE_COLUMN_COUNT = GROUP_TABLE_COLUMNS.length;

export const ROW_COUNT_WORDS = { singular: "fila", plural: "filas" } as const;

export const NO_COORDINATES_MESSAGES = {
  singular: "fila no tiene coordenadas y se omite en los GeoJSON.",
  plural: "filas no tienen coordenadas y se omiten en los GeoJSON.",
} as const;
