import React from "react";
import { Package } from "lucide-react";
import { ColumnsList } from "@/ui-kit/components/ColumnsList";
import { formatFileSize, formatNumber } from "@/core/common/ValueFormatter";
import { LoadedFileHeader } from "@/components/tools/db-sync-common/LoadedFileHeader";
import { parseSourceSrid } from "@/components/tools/db-shapefile-sync/useShpReplaceWorkflow";
import type { GpkgLayerInfo } from "@/core/types/gpkgReplace";
import styles from "./GpkgLoadedInfo.module.css";

const LAYER_SELECT_LABEL = "Capa de entidades a cargar";
const NO_SRID_SUFFIX = " (sin SRID declarado)";

const describeLayerSrid = (srid: number | null): string => {
  if (srid === null) return `Desconocido${NO_SRID_SUFFIX}`;
  return parseSourceSrid(String(srid)) === null ? `${srid}${NO_SRID_SUFFIX}` : String(srid);
};

const MetaItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className={styles.metaItem}>
    <span className={styles.metaLabel}>{label}</span>
    <span className={styles.metaValue}>{value}</span>
  </div>
);

interface GpkgLayerSelectProps {
  layers: GpkgLayerInfo[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}

const GpkgLayerSelect: React.FC<GpkgLayerSelectProps> = ({ layers, selectedName, onSelect }) => (
  <div className={styles.layerRow}>
    <label htmlFor="gpkgLayerSelect" className={styles.metaLabel}>
      {LAYER_SELECT_LABEL} ({formatNumber(layers.length)} capas)
    </label>
    <select
      id="gpkgLayerSelect"
      className={styles.select}
      value={selectedName ?? ""}
      onChange={(event) => onSelect(event.target.value)}
    >
      {layers.map((layer) => (
        <option key={layer.name} value={layer.name}>
          {layer.name}
        </option>
      ))}
    </select>
  </div>
);

export interface GpkgLoadedInfoProps {
  file: File;
  layers: GpkgLayerInfo[];
  selectedLayer: GpkgLayerInfo | null;
  onSelectLayer: (name: string) => void;
  onDiscard: () => void;
}

export const GpkgLoadedInfo: React.FC<GpkgLoadedInfoProps> = ({
  file,
  layers,
  selectedLayer,
  onSelectLayer,
  onDiscard,
}) => (
  <div className={styles.loadedCard}>
    <LoadedFileHeader variant="geopackage" icon={Package} fileName={file.name} onDiscard={onDiscard}>
      Tamaño: {formatFileSize(file.size)}
    </LoadedFileHeader>

    <div className={styles.metaRow}>
      <MetaItem label="Registros de la capa" value={formatNumber(selectedLayer?.rowCount ?? 0)} />
      <MetaItem label="SRID de la capa" value={describeLayerSrid(selectedLayer?.srid ?? null)} />
      <MetaItem label="Capas de entidades" value={formatNumber(layers.length)} />
    </div>

    {layers.length > 1 && (
      <GpkgLayerSelect layers={layers} selectedName={selectedLayer?.name ?? null} onSelect={onSelectLayer} />
    )}

    {selectedLayer && <ColumnsList columns={selectedLayer.fieldNames} title="Campos de la capa" />}
  </div>
);
