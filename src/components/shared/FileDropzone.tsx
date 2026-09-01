import React from "react";
import { UploadCloud } from "lucide-react";
import styles from "./FileDropzone.module.css";

export interface FileDropzoneProps {
  isDragOver: boolean;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onClick: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  title?: string;
  subtitle?: string;
  formatBadges?: string[];
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  onKeyDown,
  title = "Arrastre y suelte su archivo aquí",
  subtitle = "o haga clic para seleccionar un archivo desde su equipo",
  formatBadges = [],
}) => {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (onKeyDown) {
      onKeyDown(event);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`${styles.dropzone} ${isDragOver ? styles.dragOver : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.dropIcon}>
        <UploadCloud size={36} />
      </div>
      <div className={styles.dropText}>
        <span className={styles.dropTitle}>{title}</span>
        <span className={styles.dropSub}>{subtitle}</span>
      </div>
      {formatBadges.length > 0 && (
        <div className={styles.formatBadges}>
          {formatBadges.map((badge) => (
            <span key={badge} className={styles.formatBadge}>
              {badge}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
