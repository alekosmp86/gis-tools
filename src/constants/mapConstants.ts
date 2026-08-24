import { DiscrepancyType } from "@/types/comparison";

export interface TileLayerConfig {
  url: string;
  subdomains?: string;
  maxZoom: number;
  attribution: string;
}

export const BASEMAP_TILES: Record<string, TileLayerConfig> = {
  voyager: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 19,
    attribution: "CartoDB Voyager",
  },
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
  [DiscrepancyType.ATTRIBUTE_MISMATCH]: "#d97706",
  [DiscrepancyType.ONLY_IN_SHP]: "#9333ea",
  [DiscrepancyType.ONLY_IN_DB]: "#0284c7",
  [DiscrepancyType.DUPLICATE_SUID]: "#ea580c",
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
