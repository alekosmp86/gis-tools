import type { ResolvedColumn, TableKind, TableListing } from "@/core/types/tableCatalog";

export type SelectorLoadState =
  | { phase: "idle" }
  | { phase: "loading"; schema: string }
  | { phase: "ready"; schema: string; listing?: TableListing }
  | { phase: "error"; error?: string };

export interface TableOption {
  name: string;
  label: string;
  disabled: boolean;
}

export interface ListingView {
  options: TableOption[];
  message: string | null;
}

export interface ColumnRow {
  logical: string;
  ok: boolean;
  statusLabel: string;
  detail: string;
}

const LOADING_TABLES_MESSAGE = "Cargando tablas...";
const LOAD_FAILED_MESSAGE = "No se pudieron listar las tablas.";
const VIEW_SUFFIX = " (vista)";
const DATA_TYPE_SEPARATOR = " · ";
const SUGGESTION_PREFIX = "Sugerencia: ";
const NOT_IN_TABLE_MESSAGE = "No existe en la tabla";
const AMBIGUOUS_MESSAGE = "Hay más de una columna que coincide; renómbrela o elija otra tabla.";
const RESOLVED_LABEL = "Encontrada";
const MISSING_LABEL = "Falta";
const AMBIGUOUS_LABEL = "Ambigua";

const schemaMissingMessage = (schema: string): string => `El esquema "${schema}" no existe.`;
const schemaEmptyMessage = (schema: string): string => `El esquema "${schema}" no tiene tablas.`;

const labelOf = (name: string, kind: TableKind): string => (kind === "VIEW" ? `${name}${VIEW_SUFFIX}` : name);

function optionsOf(listing: TableListing, excludedTables: readonly string[]): TableOption[] {
  const excluded = new Set(excludedTables);
  return listing.tables.map((table) => ({
    name: table.name,
    label: labelOf(table.name, table.kind),
    disabled: excluded.has(table.name),
  }));
}

function readyView(state: Extract<SelectorLoadState, { phase: "ready" }>, excludedTables: readonly string[]): ListingView {
  const { listing } = state;
  if (!listing) return { options: [], message: null };
  if (!listing.schemaExists) return { options: [], message: schemaMissingMessage(state.schema) };
  if (listing.tables.length === 0) return { options: [], message: schemaEmptyMessage(state.schema) };
  return { options: optionsOf(listing, excludedTables), message: null };
}

export function describeListing(state: SelectorLoadState, excludedTables: readonly string[]): ListingView {
  switch (state.phase) {
    case "idle":
      return { options: [], message: null };
    case "loading":
      return { options: [], message: LOADING_TABLES_MESSAGE };
    case "error":
      return { options: [], message: state.error?.trim() ? state.error : LOAD_FAILED_MESSAGE };
    case "ready":
      return readyView(state, excludedTables);
  }
}

const detailOfResolved = (column: ResolvedColumn): string => {
  const name = column.column ?? column.logical;
  return column.dataType ? `${name}${DATA_TYPE_SEPARATOR}${column.dataType}` : name;
};

const detailOfMissing = (column: ResolvedColumn): string =>
  column.suggestion ? `${SUGGESTION_PREFIX}${column.suggestion}` : NOT_IN_TABLE_MESSAGE;

function rowOf(column: ResolvedColumn): ColumnRow {
  if (column.status === "resolved") {
    return { logical: column.logical, ok: true, statusLabel: RESOLVED_LABEL, detail: detailOfResolved(column) };
  }
  if (column.status === "ambiguous") {
    return { logical: column.logical, ok: false, statusLabel: AMBIGUOUS_LABEL, detail: AMBIGUOUS_MESSAGE };
  }
  return { logical: column.logical, ok: false, statusLabel: MISSING_LABEL, detail: detailOfMissing(column) };
}

export function columnRows(columns: readonly ResolvedColumn[]): ColumnRow[] {
  return columns.map(rowOf);
}

export function isSelectionValid(columns: readonly ResolvedColumn[]): boolean {
  return columns.length > 0 && columns.every((column) => column.status === "resolved");
}

const NO_RESPONSE_STATUS = 0;
const SERVER_ERROR_STATUS = 500;

/** A request that got no answer (status 0) or a server error: the database or the server is not reachable. */
export function isConnectionFailure(status: number): boolean {
  return status === NO_RESPONSE_STATUS || status >= SERVER_ERROR_STATUS;
}

/** True when an answer for `requested` still belongs to the latest value; an empty latest value never does. */
export function isCurrentAnswer(requested: string, latest: string): boolean {
  return latest !== "" && requested === latest;
}

/** The list error box shows only for an error phase that the caller has not hidden (a catalog alert replaces it). */
export function shouldShowListError(phase: SelectorLoadState["phase"], hideListError: boolean | undefined): boolean {
  return phase === "error" && hideListError !== true;
}
