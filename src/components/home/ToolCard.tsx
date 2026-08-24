import React from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import styles from "./ToolCard.module.css";

export interface ToolCardData {
  id: string;
  title: string;
  category: string;
  badge: { label: string; type: "active" | "dev" | "planned" };
  icon: LucideIcon;
  description: string;
  tags: string[];
  actionLabel: string;
  enabled: boolean;
}

export interface ToolCardProps {
  tool: ToolCardData;
  onLaunch?: (toolId: string) => void;
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool, onLaunch }) => {
  const IconComponent = tool.icon;

  return (
    <div className={`glass-panel ${styles.card}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <IconComponent size={24} />
        </div>
        <Badge variant={tool.badge.type}>{tool.badge.label}</Badge>
      </div>

      <div>
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

      <div className={styles.cardFooter}>
        <Button
          variant="primary"
          isDisabled={!tool.enabled}
          onClick={() => tool.enabled && onLaunch && onLaunch(tool.id)}
        >
          <span>{tool.actionLabel}</span>
          {tool.enabled && <ArrowRight size={16} />}
        </Button>
      </div>
    </div>
  );
};
