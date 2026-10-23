import React from "react";
import { Wrench } from "lucide-react";
import { OptionToggleCard } from "@/components/tools/db-sync-common/OptionToggleCard";
import styles from "./GeometryCards.module.css";

export interface GeometryRepairCardProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const GeometryRepairCard: React.FC<GeometryRepairCardProps> = ({ enabled, onToggle }) => (
  <OptionToggleCard
    tone="sky"
    icon={<Wrench size={18} />}
    title="Reparar geometrías"
    isEnabled={enabled}
    isActive={enabled}
    activeBadge="Activa"
    inactiveBadge="Inactiva"
    toggleLabel="Reparar geometrías inválidas"
    onToggleEnabled={onToggle}
    description={
      <>
        Aplica <code>ST_MakeValid</code> a las geometrías inválidas y conserva solo sus partes poligonales. Si la unificación
        está activa, se repite sobre el resultado unificado. Las que queden vacías se insertan como NULL. Si está
        desactivada, las geometrías inválidas se insertan tal cual y se le avisará.
      </>
    }
  >
    <span className={styles.note}>Ninguna geometría se repara sin que usted lo solicite.</span>
  </OptionToggleCard>
);
