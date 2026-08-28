import React from "react";
import { Badge } from "../ui/Badge";
import type { ToolCardProps } from "@/types/ui";
import styles from "./ToolCard.module.css";

export const ToolCard: React.FC<ToolCardProps> = ({ tool, onLaunch }) => {
  const IconComponent = tool.icon;

  const handleClick = () => {
    if (tool.enabled && onLaunch) {
      onLaunch(tool.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (tool.enabled && onLaunch && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onLaunch(tool.id);
    }
  };

  return (
    <div
      role={tool.enabled ? "button" : undefined}
      tabIndex={tool.enabled ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`glass-panel ${styles.card} ${
        tool.enabled ? styles.clickable : styles.disabled
      }`}
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <IconComponent size={24} />
        </div>
        <Badge variant={tool.badge.type}>{tool.badge.label}</Badge>
      </div>

      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>{tool.title}</h3>
        <p className={styles.cardDesc}>{tool.description}</p>

        <div className={styles.tagContainer}>
          {tool.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              #{tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
