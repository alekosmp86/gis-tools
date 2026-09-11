/**
 * 2D Bounding Box represented as [minX, minY, maxX, maxY].
 * In standard GIS geographic coordinate systems, this corresponds to [minLng, minLat, maxLng, maxLat].
 */
export type BBox = [number, number, number, number];

export interface TileLayerConfig {
  url: string;
  subdomains?: string;
  maxZoom: number;
  attribution: string;
}

export const MapStrokePattern = {
  SOLID: "solid",
  DASHED: "dashed",
  DOTTED: "dotted",
} as const;

export type MapStrokePattern = (typeof MapStrokePattern)[keyof typeof MapStrokePattern];

export interface MapFeatureStyle {
  color: string;
  fillColor: string;
  weight: number;
  opacity: number;
  fillOpacity: number;
  pointRadius: number;
  strokePattern: MapStrokePattern;
  overrideDiscrepancyColors: boolean;
}
