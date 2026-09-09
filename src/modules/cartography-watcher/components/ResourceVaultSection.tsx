import React from "react";
import { FolderDown } from "lucide-react";
import type { VaultResourceMeta } from "../types/watcher";
import { formatDate } from "../utils/watcherFormatters";
import styles from "./ResourceCard.module.css";

export interface ResourceVaultSectionProps {
  localMeta?: VaultResourceMeta | null;
}

export const ResourceVaultSection: React.FC<ResourceVaultSectionProps> = ({ localMeta }) => {
  if (!localMeta) {
    return null;
  }

  return (
    <div className={styles.vaultSection}>
      <div className={styles.vaultHeader}>
        <FolderDown size={13} />
        <span>Almacenado en Vault</span>
      </div>
      <div>Ruta: {localMeta.relativeFilePath}</div>
      <div>Descargado: {formatDate(localMeta.downloadedAt, true)}</div>
    </div>
  );
};
