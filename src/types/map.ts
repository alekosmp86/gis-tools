import type { FeatureCollection } from "geojson";

export interface TileLayerConfig {
  url: string;
  subdomains?: string;
  maxZoom: number;
  attribution: string;
}


export interface SpatialMapPreviewProps {
  geojson: FeatureCollection;
  title?: string;
  selectedFeatureIndex?: number | null;
  onSelectFeature?: (index: number | null) => void;
}

export interface MapHeaderBarProps {
  title: string;
  totalFeatures: number;
  renderedCount: number;
  isChunking: boolean;
  basemapKey: string;
  onSelectBasemap: (basemapKey: string) => void;
  onFitBounds: () => void;
}

export interface MapLegendProps {
  presentTypes: string[];
}

export interface MapProgressBarProps {
  progressPct: number;
}
