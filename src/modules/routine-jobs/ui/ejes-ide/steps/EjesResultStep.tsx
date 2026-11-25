"use client";

import React from "react";
import { DatabaseZap } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType } from "@/ui-kit/types/ui";
import { EjesIdeReport } from "../EjesIdeReport";
import { EjesLoadResult } from "../EjesLoadResult";
import type { EjesGeometryMapBase, EjesSplitPointsBase } from "../shared/ejesIdeClientTypes";
import { automaticPlainRemovalsOf, type EjesAcceptView } from "../ejesAccept";
import { autoRemovalLineOf, manualLoadLineOf } from "../ejesAcceptTexts";
import type { EjesResult } from "../../../jobs/ejes-ide/types";
import type { EjesRunSnapshot } from "../shared/ejesIdeRunStore";
import { ejesIdeChecklistStepsOf } from "../shared/ejesIdeStepChecklist";
import { RunPhase } from "../../shared/jobRunStore";
import { RunProgressStatus, RunResultActions } from "../../shared/steps/RunResultParts";
import { RunStepChecklist } from "../../shared/steps/RunStepChecklist";
import styles from "../../shared/steps/WizardSteps.module.css";

const ICON_SIZE = 15;
const IDLE_HINT = "Todavía no hay un análisis. Complete los pasos anteriores y pulse Analizar.";
const NO_REPORT_MESSAGE = "El análisis terminó, pero el servidor no envió el informe.";
const FAILED_FALLBACK = "El trabajo de ejes de calles terminó con un error.";
const UNKNOWN_TITLE = "No se pudo confirmar el resultado del trabajo de ejes de calles.";
const UNKNOWN_ADVICE = "Hay que verificar las tablas de ejes de calles antes de volver a cargar.";

export interface EjesResultStepProps {
  snapshot: EjesRunSnapshot;
  nowMs: number;
  /** The department the shown run was limited to; null for the whole country. */
  department?: string | null;
  /** The connection of the wizard for the map; null when the wizard holds no password. */
  mapBase: EjesGeometryMapBase | null;
  /** The connection and tables the review points of a split read; null when the wizard holds no password. */
  splitBase?: EjesSplitPointsBase | null;
  /** Same gate as the Revisar step: finished dry-run of these tables, no blockers, password typed. */
  canLoad: boolean;
  /** The accept controls of the review lists; shown only on a dry-run report, and absent means read-only. */
  accept?: EjesAcceptView;
  onLoad: () => void;
  onNewRun: () => void;
  onBackToReview: () => void;
}

interface DoneBodyProps {
  result: EjesResult | undefined;
  department: string | null;
  mapBase: EjesGeometryMapBase | null;
  splitBase: EjesSplitPointsBase | null;
  accept?: EjesAcceptView;
}

interface LoadHintsProps {
  result: EjesResult | undefined;
}

const textOr = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim() !== "" ? value : fallback;

const automaticRemovalsOf = (result: EjesResult | undefined): number =>
  result === undefined ? 0 : automaticPlainRemovalsOf(result.counts);

const manualDivisionsOf = (result: EjesResult | undefined): number => result?.counts.manualSplitsApplied ?? 0;

function Checklist({ snapshot }: { snapshot: EjesRunSnapshot }) {
  return (
    <RunStepChecklist
      steps={ejesIdeChecklistStepsOf(snapshot)}
      currentLabel={snapshot.job?.step || null}
      phase={snapshot.phase}
    />
  );
}

function LoadHints({ result }: LoadHintsProps) {
  const manualDivisions = manualDivisionsOf(result);
  return (
    <>
      <p className={styles.hint}>{autoRemovalLineOf(automaticRemovalsOf(result))}</p>
      {manualDivisions > 0 && <p className={styles.hint}>{manualLoadLineOf(manualDivisions)}</p>}
    </>
  );
}

function DoneBody({ result, department, mapBase, splitBase, accept }: DoneBodyProps) {
  const load = result?.load;
  return (
    <>
      {result && load && <EjesLoadResult result={result} load={load} />}
      {result ? (
        <EjesIdeReport
          result={result}
          department={department}
          mapBase={mapBase}
          splitBase={splitBase}
          accept={result.dryRun ? accept : undefined}
        />
      ) : (
        <AlertMessage type={AlertType.WARNING} text={NO_REPORT_MESSAGE} />
      )}
    </>
  );
}

export const EjesResultStep: React.FC<EjesResultStepProps> = ({
  snapshot,
  nowMs,
  department = null,
  mapBase,
  splitBase = null,
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
      return (
        <div className={styles.stack}>
          <DoneBody result={result} department={department} mapBase={mapBase} splitBase={splitBase} accept={accept} />
          {canLoad && (
            <>
              <LoadHints result={result} />
              <div className={styles.actions}>
                <Button onClick={onLoad}>
                  <DatabaseZap size={ICON_SIZE} />
                  <span>Cargar ahora</span>
                </Button>
              </div>
            </>
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
