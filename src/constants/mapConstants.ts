import { DiscrepancyType } from "@/types/comparison";
import { MapStrokePattern, type MapFeatureStyle, type TileLayerConfig } from "@/types/map";

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

export const DISCREPANCY_COLORS: Record<string, string> = {
  [DiscrepancyType.ATTRIBUTE_MISMATCH]: "#eab308",
  [DiscrepancyType.ONLY_IN_SHP]: "#9333ea",
  [DiscrepancyType.ONLY_IN_DB]: "#0284c7",
  [DiscrepancyType.DUPLICATE_SUID]: "#f97316",
  [DiscrepancyType.NULL_SUID]: "#dc2626",
  [DiscrepancyType.MATCH]: "#059669",
};

export const DEFAULT_DISCREPANCY_COLOR = "#2563eb";

export function getDiscrepancyColor(type?: string): string {
  if (!type) return DEFAULT_DISCREPANCY_COLOR;
  return DISCREPANCY_COLORS[type] || DEFAULT_DISCREPANCY_COLOR;
}

export const DISCREPANCY_LABELS: Record<string, string> = {
  [DiscrepancyType.ATTRIBUTE_MISMATCH]: "Discrepancia de Atributos",
  [DiscrepancyType.ONLY_IN_SHP]: "Solo en Archivo Fuente",
  [DiscrepancyType.ONLY_IN_DB]: "Solo en Base de Datos",
  [DiscrepancyType.DUPLICATE_SUID]: "SUID Duplicado",
  [DiscrepancyType.NULL_SUID]: "SUID Nulo / Vacío",
  [DiscrepancyType.MATCH]: "Coincidencia Exacta",
};

export const DEFAULT_DISCREPANCY_LABEL = "Entidad Espacial";

export function getDiscrepancyLabel(type?: string): string {
  if (!type) return DEFAULT_DISCREPANCY_LABEL;
  return DISCREPANCY_LABELS[type] || DEFAULT_DISCREPANCY_LABEL;
}

/** Progressive Micro-Batch Map Rendering Constants */
export const MAP_MICRO_CHUNK_SIZE = 400;
export const MAP_CHUNK_DELAY_MS = 16;
