import { DiscrepancyType } from "@/core/types/comparison";
import { MapStrokePattern, type MapFeatureStyle, type TileLayerConfig } from "@/core/types/map";

export const DEFAULT_MAP_FEATURE_STYLE: MapFeatureStyle = {
  color: "#06b6d4",
  fillColor: "#06b6d4",
  weight: 3.5,
  opacity: 0.9,
  fillOpacity: 0.35,
  pointRadius: 7,
  strokePattern: MapStrokePattern.SOLID,
  overrideDiscrepancyColors: false,
};

export const MAP_STYLE_PRESET_COLORS = [
  { label: "Cian Eléctrico", hex: "#06b6d4" },
  { label: "Azul Océano", hex: "#3b82f6" },
  { label: "Esmeralda", hex: "#10b981" },
  { label: "Ámbar", hex: "#f59e0b" },
  { label: "Coral / Rosa", hex: "#f43f5e" },
  { label: "Violeta", hex: "#8b5cf6" },
  { label: "Blanco Brillante", hex: "#f8fafc" },
] as const;

export function getDashArrayFromPattern(pattern: MapStrokePattern): string | undefined {
  switch (pattern) {
    case MapStrokePattern.DASHED:
      return "6, 6";
    case MapStrokePattern.DOTTED:
      return "2, 5";
    case MapStrokePattern.SOLID:
    default:
      return undefined;
  }
}


export const BASEMAP_TILES: Record<string, TileLayerConfig> = {
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: "OpenStreetMap",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 18,
    attribution: "Esri Satellite",
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 19,
    attribution: "CartoDB Dark",
  },
};

/** Feature roles of a two-layer comparison (old and new outline of one padrón): the `_discrepancyType` values that colour them. */
export const MAP_ROLE_TYPE = {
  OLD: "PADRON_ANTERIOR",
  NEW: "PADRON_NUEVO",
} as const;

export const MAP_SECTION_TYPE = {
  OLD: "TRAMO_ANTERIOR",
  NEW: "TRAMO_NUEVO",
  URBAN_ZONE: "PADRON_ZONA_URBANA",
  RURAL_ZONE: "PADRON_ZONA_RURAL",
} as const;

/** Outline types drawn as the underlay of a comparison: thicker, so the outline over them stays visible. */
export const MAP_UNDERLAY_TYPES: readonly string[] = [MAP_ROLE_TYPE.OLD, MAP_SECTION_TYPE.OLD];

export const MAP_UNDERLAY_EXTRA_WEIGHT = 5;

/** Candidate outlines of one comparison (several old outlines competing for one new one), each in its own colour, in candidate order. */
export const MAP_CANDIDATE_TYPES = [
  "PADRON_CANDIDATO_1",
  "PADRON_CANDIDATO_2",
  "PADRON_CANDIDATO_3",
  "PADRON_CANDIDATO_4",
  "PADRON_CANDIDATO_5",
] as const;

const CANDIDATE_COLORS = ["#f59e0b", "#a855f7", "#facc15", "#f97316", "#e879f9"] as const;

const candidateRecordOf = (valueOf: (index: number) => string): Record<string, string> =>
  Object.fromEntries(MAP_CANDIDATE_TYPES.map((type, index) => [type, valueOf(index)]));

const DISCREPANCY_COLORS: Record<string, string> = {
  DB_FEATURE: "#00e5ff",
  FILE_FEATURE: "#ff0055",
  [MAP_ROLE_TYPE.OLD]: "#fb7185",
  [MAP_ROLE_TYPE.NEW]: "#34d399",
  [MAP_SECTION_TYPE.OLD]: "#1d4ed8",
  [MAP_SECTION_TYPE.NEW]: "#f97316",
  [MAP_SECTION_TYPE.URBAN_ZONE]: "#c026d3",
  [MAP_SECTION_TYPE.RURAL_ZONE]: "#92400e",
  ...candidateRecordOf((index) => CANDIDATE_COLORS[index]),
  [DiscrepancyType.GEOMETRY_MISMATCH]: "#ff0055",
  [DiscrepancyType.ATTRIBUTE_MISMATCH]: "#f59e0b",
  [DiscrepancyType.ONLY_IN_SHP]: "#a855f7",
  [DiscrepancyType.ONLY_IN_DB]: "#00e5ff",
  [DiscrepancyType.DUPLICATE_SUID]: "#f97316",
  [DiscrepancyType.NULL_SUID]: "#ef4444",
  [DiscrepancyType.MATCH]: "#10b981",
};

const DEFAULT_DISCREPANCY_COLOR = "#2563eb";

export function getDiscrepancyColor(type?: string): string {
  if (!type) return DEFAULT_DISCREPANCY_COLOR;
  return DISCREPANCY_COLORS[type] || DEFAULT_DISCREPANCY_COLOR;
}

const DISCREPANCY_LABELS: Record<string, string> = {
  DB_FEATURE: "Geometría Base de Datos (PostgreSQL)",
  FILE_FEATURE: "Geometría Archivo (Shapefile / CSV)",
  [MAP_ROLE_TYPE.OLD]: "Padrón anterior",
  [MAP_ROLE_TYPE.NEW]: "Padrón nuevo",
  [MAP_SECTION_TYPE.OLD]: "Tramo anterior",
  [MAP_SECTION_TYPE.NEW]: "Tramo nuevo",
  [MAP_SECTION_TYPE.URBAN_ZONE]: "Padrones urbanos cercanos",
  [MAP_SECTION_TYPE.RURAL_ZONE]: "Padrones rurales cercanos",
  ...candidateRecordOf((index) => `Candidato ${index + 1}`),
  [DiscrepancyType.GEOMETRY_MISMATCH]: "Discrepancia Geométrica",
  [DiscrepancyType.ATTRIBUTE_MISMATCH]: "Discrepancia de Atributos",
  [DiscrepancyType.ONLY_IN_SHP]: "Solo en Archivo Fuente",
  [DiscrepancyType.ONLY_IN_DB]: "Solo en Base de Datos",
  [DiscrepancyType.DUPLICATE_SUID]: "SUID Duplicado",
  [DiscrepancyType.NULL_SUID]: "SUID Nulo / Vacío",
  [DiscrepancyType.MATCH]: "Coincidencia Exacta",
};

const DEFAULT_DISCREPANCY_LABEL = "Entidad Espacial";

export function getDiscrepancyLabel(type?: string): string {
  if (!type) return DEFAULT_DISCREPANCY_LABEL;
  return DISCREPANCY_LABELS[type] || DEFAULT_DISCREPANCY_LABEL;
}

export const MAP_MICRO_CHUNK_SIZE = 400;
export const MAP_FRAME_BUDGET_MS = 8;
export const MAX_MAP_PREVIEW_FEATURES = 150_000;
export const MAX_VIEWPORT_RENDER_FEATURES = 50_000;
export const VIEWPORT_INDEX_PADDING_RATIO = 1.0;
export const SPATIAL_INDEX_TARGET_FEATURES_PER_CELL = 32;
