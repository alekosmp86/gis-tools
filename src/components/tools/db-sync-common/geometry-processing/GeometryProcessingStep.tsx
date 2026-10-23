import React from "react";
import { Info } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { KeyOrigin } from "@/core/services/geometryKeySuggestion";
import type { GeometryProcessingOptions } from "@/core/types/geometryProcessing";
import { GeometryRepairCard } from "./GeometryRepairCard";
import { GeometryUnifyCard } from "./GeometryUnifyCard";
import { GeometryOverlapCard } from "./GeometryOverlapCard";
import styles from "./GeometryProcessingStep.module.css";

export interface GeometryProcessingStepProps {
  dbfFields: readonly string[];
  options: GeometryProcessingOptions;
  suggestionOrigin: KeyOrigin;
  onChange: (next: GeometryProcessingOptions) => void;
  disabled?: boolean;
  onSkip?: () => void;
}

export const GeometryProcessingStep: React.FC<GeometryProcessingStepProps> = ({
  dbfFields,
  options,
  suggestionOrigin,
  onChange,
  disabled = false,
  onSkip,
}) => (
  <fieldset disabled={disabled} className={styles.container}>
    <div className={styles.note}>
      <Info size={16} className={styles.noteIcon} />
      <span className={styles.noteText}>
        Los tres procesos son opcionales e independientes. Con todos desactivados, los registros se cargan tal como están.
      </span>
      {onSkip && (
        <Button type="button" variant={ButtonVariant.SECONDARY} onClick={onSkip}>
          Omitir este paso
        </Button>
      )}
    </div>

    <GeometryRepairCard
      enabled={options.repair.enabled}
      onToggle={(enabled) => onChange({ ...options, repair: { enabled } })}
    />

    <GeometryUnifyCard
      enabled={options.unify.enabled}
      keyFields={options.unify.keyFields}
      dbfFields={dbfFields}
      suggestionOrigin={suggestionOrigin}
      onToggle={(enabled) => onChange({ ...options, unify: { ...options.unify, enabled } })}
      onKeyFieldsChange={(keyFields) => onChange({ ...options, unify: { ...options.unify, keyFields } })}
    />

    <GeometryOverlapCard
      enabled={options.overlaps.enabled}
      policy={options.overlaps.policy}
      minAreaM2={options.overlaps.minAreaM2}
      onToggle={(enabled) => onChange({ ...options, overlaps: { ...options.overlaps, enabled } })}
      onPolicyChange={(policy) => onChange({ ...options, overlaps: { ...options.overlaps, policy } })}
      onMinAreaChange={(minAreaM2) => onChange({ ...options, overlaps: { ...options.overlaps, minAreaM2 } })}
    />
  </fieldset>
);
