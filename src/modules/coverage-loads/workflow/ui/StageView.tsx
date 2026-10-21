"use client";

import React from "react";
import { RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { StageStatus, type StageOutcome } from "../../shared/domain/stageContract";
import type { ConnectionPayload } from "../../types";
import type { CoverageStage } from "./coverageStages";
import { StageStatusChip } from "./StageStatusChip";
import styles from "./StageView.module.css";

interface StageViewProps {
  stage: CoverageStage;
  status: StageStatus;
  isActive: boolean;
  canSkip: boolean;
  canUnskip: boolean;
  lockedNotice: string | null;
  connection: ConnectionPayload;
  connectionRevision: number;
  onStatusChange: (stageId: string, status: StageStatus, outcome?: StageOutcome) => void;
  onSkip: (stageId: string) => void;
  onUnskip: (stageId: string) => void;
}

const SKIPPED_NOTICE = "Este paso se omitió. Puede retomarlo cuando quiera; lo que ya hubiera avanzado se conserva.";

/**
 * One stage of the workflow. Its panel stays mounted, only hidden, so progress survives while
 * the user looks at another stage, skips this one or it is locked behind an unfinished stage.
 */
export const StageView: React.FC<StageViewProps> = ({
  stage,
  status,
  isActive,
  canSkip,
  canUnskip,
  lockedNotice,
  connection,
  connectionRevision,
  onStatusChange,
  onSkip,
  onUnskip,
}) => {
  const { Panel } = stage;
  const isSkipped = status === StageStatus.SKIPPED;
  const handleStatusChange = (nextStatus: StageStatus, outcome?: StageOutcome) =>
    onStatusChange(stage.id, nextStatus, outcome);

  return (
    <div className={styles.stage} hidden={!isActive}>
      <header className={styles.header}>
        <h2 className={styles.title}>{stage.label}</h2>
        <StageStatusChip status={status} />
        {canSkip && (
          <Button type="button" variant={ButtonVariant.SECONDARY} onClick={() => onSkip(stage.id)}>
            <SkipForward size={15} />
            Omitir
          </Button>
        )}
        {canUnskip && (
          <Button type="button" variant={ButtonVariant.SECONDARY} onClick={() => onUnskip(stage.id)}>
            <RotateCcw size={15} />
            Retomar
          </Button>
        )}
      </header>
      {isSkipped && <p className={styles.notice}>{SKIPPED_NOTICE}</p>}
      {lockedNotice !== null && <p className={styles.notice}>{lockedNotice}</p>}
      <div className={styles.panel} hidden={isSkipped || lockedNotice !== null}>
        <Panel connection={connection} connectionRevision={connectionRevision} onStatusChange={handleStatusChange} />
      </div>
    </div>
  );
};
