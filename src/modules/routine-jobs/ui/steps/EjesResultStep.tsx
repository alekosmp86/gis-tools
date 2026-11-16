"use client";

import React from "react";
import { DatabaseZap } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType } from "@/ui-kit/types/ui";
import { EjesCallesReport } from "../EjesCallesReport";
import { EjesLoadResult } from "../EjesLoadResult";
import type { EjesGeometryMapBase } from "../clientTypes";
import type { EjesAcceptView } from "../ejesAccept";
import type { EjesRunSnapshot } from "../ejesCallesRunStore";
import { RunPhase } from "../jobRunStore";
import { RunProgressStatus, RunResultActions } from "./RunResultParts";
import { RunStepChecklist } from "./RunStepChecklist";
import styles from "./WizardSteps.module.css";

const ICON_SIZE = 15;
const IDLE_HINT = "Todavía no hay un análisis. Complete los pasos anteriores y pulse Analizar.";
const NO_REPORT_MESSAGE = "El análisis terminó, pero el servidor no envió el informe.";
const FAILED_FALLBACK = "El trabajo de ejes de calles terminó con un error.";
const UNKNOWN_TITLE = "No se pudo confirmar el resultado del trabajo de ejes de calles.";
const UNKNOWN_ADVICE = "Hay que verificar las tablas de ejes de calles antes de volver a cargar.";

export interface EjesResultStepProps {
  snapshot: EjesRunSnapshot;
  nowMs: number;
  /** The connection of the wizard for the map; null when the wizard holds no password. */
  mapBase: EjesGeometryMapBase | null;
  /** Same gate as the Revisar step: finished dry-run of these tables, no blockers, password typed. */
  canLoad: boolean;
  /** The accept controls of the review lists; shown only on a dry-run report, and absent means read-only. */
  accept?: EjesAcceptView;
  onLoad: () => void;
  onNewRun: () => void;
  onBackToReview: () => void;
}

const textOr = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim() !== "" ? value : fallback;

function Checklist({ snapshot }: { snapshot: EjesRunSnapshot }) {
  return (
    <RunStepChecklist
      plan={snapshot.plan}
      steps={snapshot.job?.steps}
      currentLabel={snapshot.job?.step || null}
      phase={snapshot.phase}
    />
  );
}

export const EjesResultStep: React.FC<EjesResultStepProps> = ({
  snapshot,
  nowMs,
  mapBase,
  canLoad,
  accept,
  onLoad,
  onNewRun,
  onBackToReview,
}) => {
  const actions = <RunResultActions onNewRun={onNewRun} onBackToReview={onBackToReview} />;
  switch (snapshot.phase) {
    case RunPhase.IDLE:
      return <p className={styles.hint}>{IDLE_HINT}</p>;
    case RunPhase.STARTING:
    case RunPhase.RUNNING:
      return (
        <RunProgressStatus
          phase={snapshot.phase}
          startedAt={snapshot.startedAt ?? snapshot.job?.startedAt}
          nowMs={nowMs}
          plan={snapshot.plan}
          steps={snapshot.job?.steps}
          currentLabel={snapshot.job?.step || null}
        />
      );
    case RunPhase.DONE: {
      const result = snapshot.job?.result;
      const load = result?.load;
      return (
        <div className={styles.stack}>
          {result && load && <EjesLoadResult result={result} load={load} />}
          {result ? (
            <EjesCallesReport result={result} mapBase={mapBase} accept={result.dryRun ? accept : undefined} />
          ) : (
            <AlertMessage type={AlertType.WARNING} text={NO_REPORT_MESSAGE} />
          )}
          {canLoad && (
            <div className={styles.actions}>
              <Button onClick={onLoad}>
                <DatabaseZap size={ICON_SIZE} />
                <span>Cargar ahora</span>
              </Button>
            </div>
          )}
          {actions}
        </div>
      );
    }
    case RunPhase.FAILED:
      return (
        <div className={styles.stack}>
          <AlertMessage type={AlertType.ERROR} text={textOr(snapshot.error, FAILED_FALLBACK)} />
          <Checklist snapshot={snapshot} />
          {actions}
        </div>
      );
    case RunPhase.UNKNOWN:
      return (
        <div className={styles.stack}>
          <AlertMessage type={AlertType.ERROR} text={UNKNOWN_TITLE} />
          <p className={styles.hint}>{`Identificador del trabajo: ${snapshot.jobId ?? "no disponible"}. ${UNKNOWN_ADVICE}`}</p>
          <Checklist snapshot={snapshot} />
          {actions}
        </div>
      );
  }
};
