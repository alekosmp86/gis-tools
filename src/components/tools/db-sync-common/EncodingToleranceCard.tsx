import React from "react";
import { Languages, ShieldCheck, AlertCircle } from "lucide-react";
import { OptionToggleCard, OptionToggleNotice } from "./OptionToggleCard";

export interface EncodingToleranceCardProps {
  isEnabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
}

export const EncodingToleranceCard: React.FC<EncodingToleranceCardProps> = ({
  isEnabled,
  onToggleEnabled,
}) => {
  return (
    <OptionToggleCard
      tone="sky"
      icon={<Languages size={18} />}
      title="Tolerancia a Artefactos de Codificación (Glitches de Exportación)"
      isEnabled={isEnabled}
      isActive={isEnabled}
      activeBadge={
        <>
          <ShieldCheck size={13} />
          Tolerancia Activa
        </>
      }
      inactiveBadge={
        <>
          <AlertCircle size={13} />
          Comparación Estricta Byte a Byte
        </>
      }
      toggleLabel="Tolerar caracteres corruptos"
      onToggleEnabled={onToggleEnabled}
      description={
        <>
          Resuelve discrepancias falsas generadas por exportadores GIS que corrompen caracteres
          españoles de doble byte (por ejemplo, el carácter Hangul <code>헡</code> en lugar de{" "}
          <code>Ñ</code> o <code>ÑO</code>, o artefactos mojibake como <code>Ã‘</code>).
        </>
      }
    >
      <OptionToggleNotice>
        <ShieldCheck size={16} />
        <span>
          <strong>Sensibilidad Estricta Garantizada:</strong> La tolerancia solo repara fallas
          conocidas de codificación. Mantiene total sensibilidad a mayúsculas/minúsculas y
          signos de puntuación.
        </span>
      </OptionToggleNotice>
    </OptionToggleCard>
  );
};
