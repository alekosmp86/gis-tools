import React from "react";
import { UploadCloud } from "lucide-react";
import { DefaultFileSourceTab, type FileSourceTabExtension } from "@/types/extensions";
import styles from "./FileSourceTabs.module.css";

export interface FileSourceTabsProps {
  extensions: readonly FileSourceTabExtension[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  pcUploadLabel?: string;
}

export const FileSourceTabs: React.FC<FileSourceTabsProps> = ({
  extensions,
  activeTabId,
  onSelectTab,
  pcUploadLabel = "Subir desde PC",
}) => {
  if (extensions.length === 0) {
    return null;
  }

  return (
    <div className={styles.sourceTabs}>
      {extensions.map((extension) => {
        const ExtensionIcon = extension.icon;
        const isActive = activeTabId === extension.id;

        return (
          <button
            key={extension.id}
            type="button"
            className={`${styles.sourceTab} ${isActive ? styles.sourceTabActive : ""}`}
            onClick={() => onSelectTab(extension.id)}
            aria-label={`Cargar archivo desde ${extension.label}`}
          >
            {ExtensionIcon && <ExtensionIcon size={16} />}
            <span>{extension.label}</span>
          </button>
        );
      })}

      <button
        type="button"
        className={`${styles.sourceTab} ${
          activeTabId === DefaultFileSourceTab.PC ? styles.sourceTabActive : ""
        }`}
        onClick={() => onSelectTab(DefaultFileSourceTab.PC)}
        aria-label={pcUploadLabel}
      >
        <UploadCloud size={16} />
        <span>{pcUploadLabel}</span>
      </button>
    </div>
  );
};
