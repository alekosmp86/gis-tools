import React from "react";
import { Badge } from "@/components/ui/Badge";
import { DiscrepancyType, type ComparisonSourceDescriptor } from "@/types/comparison";
import { BadgeVariant } from "@/types/ui";
import styles from "./DiscrepancyTypeBadge.module.css";

export interface DiscrepancyTypeBadgeProps {
  type: DiscrepancyType;
  descriptor: ComparisonSourceDescriptor;
}

export const DiscrepancyTypeBadge: React.FC<DiscrepancyTypeBadgeProps> = ({
  type,
  descriptor,
}) => {
  switch (type) {
    case DiscrepancyType.MATCH:
      return <Badge variant={BadgeVariant.ACTIVE}>Coincidencia Exacta</Badge>;
    case DiscrepancyType.GEOMETRY_MISMATCH:
      return <span className={styles.badgeGeom}>Diferencia Geométrica</span>;
    case DiscrepancyType.ATTRIBUTE_MISMATCH:
      return <span className={styles.badgeAttr}>Diferencia de Atributos</span>;
    case DiscrepancyType.NULL_SUID:
      return <span className={styles.badgeNull}>SUID Nulo / Vacío</span>;
    case DiscrepancyType.DUPLICATE_SUID:
      return <span className={styles.badgeDuplicate}>SUID Duplicado</span>;
    case DiscrepancyType.ONLY_IN_DB:
      return (
        <span className={styles.badgeDb}>
          Solo en {descriptor.targetLabel}
        </span>
      );
    case DiscrepancyType.ONLY_IN_SHP:
      return (
        <span className={styles.badgeShp}>
          Solo en {descriptor.sourceLabel}
        </span>
      );
    default:
      return null;
  }
};
