"use client";

import React, { useReducer, useState, useSyncExternalStore } from "react";
import type { ResolvedColumn } from "@/core/types/tableCatalog";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import type { CompletarTableRole } from "../jobs/completar-unidad-territorial/constants";
import {
  blockingReason,
  canRunNow,
  CompletarSlot,
  CompletarStep,
  completarWizardReducer,
  excludedCompletarTablesOf,
  initialCompletarWizardStateFor,
  runBlockedReason,
  toCompletarStartRequest,
  type CompletarWizardSeed,
} from "./completarUnidadTerritorialWizardState";
import {
  buildCompletarWizardSteps,
  completarStepIdOf,
  completarStepOfId,
} from "./completarUnidadTerritorialWizardSteps";
import {
  getCompletarRunStore,
  type CompletarRunSnapshot,
  type CompletarRunStore,
} from "./completarUnidadTerritorialRunStore";
import { getUnidadRunStore } from "./unidadTerritorialRunStore";
import type { ClientConnection, CompletarStartRequest } from "./clientTypes";
import { trimConnection } from "./connectionProfiles";
import { useCatalogLoader } from "./useCatalogLoader";
import { useElapsedTick } from "./useElapsedTick";
import { RunPhase } from "./jobRunStore";
import { createRoutineJobsClient } from "./routineJobsClient";
import { CompletarTablesStep } from "./steps/CompletarTablesStep";
import { CompletarReviewStep } from "./steps/CompletarReviewStep";
import { CompletarRunStep } from "./steps/CompletarRunStep";
import { CompletarReportStep } from "./steps/CompletarReportStep";

const IDLE_SNAPSHOT: CompletarRunSnapshot = { phase: RunPhase.IDLE };
const TABLES_STEP_ID = completarStepIdOf(CompletarStep.TABLES);
const REVIEW_STEP_ID = completarStepIdOf(CompletarStep.REVIEW);
const DRY_RUN = { dryRun: true };
const REAL_RUN = { dryRun: false };
const SLOT_KEYS: readonly CompletarSlot[] = [CompletarSlot.UNIT, CompletarSlot.ADDRESS_MASTER];
const client = createRoutineJobsClient();
const getIdleSnapshot = (): CompletarRunSnapshot => IDLE_SNAPSHOT;

/** The unit table prefills from the target of the last stage 3 run, when there is one. */
function seedFrom(connection: ClientConnection): CompletarWizardSeed {
  const plan = getUnidadRunStore().getSnapshot().plan;
  return {
    connection: trimConnection(connection),
    unit: plan === undefined ? undefined : { schema: plan.targetSchema, table: plan.targetTable },
  };
}

export interface CompletarUnidadTerritorialWizardProps {
  connection: ClientConnection;
}

export const CompletarUnidadTerritorialWizard: React.FC<CompletarUnidadTerritorialWizardProps> = ({
  connection: hubConnection,
}) => {
  const [runStore] = useState<CompletarRunStore>(getCompletarRunStore);
  const [seed] = useState(() => seedFrom(hubConnection));
  const [state, dispatch] = useReducer(completarWizardReducer, runStore, (store: CompletarRunStore) =>
    initialCompletarWizardStateFor(store.getSnapshot(), seed)
  );
  const snapshot = useSyncExternalStore(runStore.subscribe, runStore.getSnapshot, getIdleSnapshot);

  const isRunActive = snapshot.phase === RunPhase.STARTING || snapshot.phase === RunPhase.RUNNING;
  const nowMs = useElapsedTick(isRunActive);

  const { connection } = state;
  const { loadTables, reset: resetCatalog, catalogErrorFor } = useCatalogLoader(client, connection);

  const checkColumns = (role: CompletarTableRole, schema: string, table: string): Promise<ResolvedColumn[]> =>
    client.listColumns(trimConnection(connection), schema, table, role);

  const catalogError = catalogErrorFor(SLOT_KEYS.map((key) => state.slots[key].schema));

  const startRun = (request: CompletarStartRequest) => {
    void runStore.start(request);
    dispatch({ type: "runStarted" });
  };

  const newRun = () => {
    runStore.reset();
    resetCatalog();
    dispatch({ type: "reset", seed });
  };

  const renderCurrentStep = (): React.ReactNode => {
    switch (state.step) {
      case CompletarStep.TABLES:
        return (
          <CompletarTablesStep
            slots={state.slots}
            excluded={excludedCompletarTablesOf(state)}
            onSchemaChange={(key, schema) => dispatch({ type: "slotSchemaChanged", key, schema })}
            onTableChange={(key, table, valid) => dispatch({ type: "slotTableChosen", key, table, valid })}
            loadTables={loadTables}
            checkColumns={checkColumns}
            blockingReason={blockingReason(state)}
            catalogError={catalogError}
          />
        );
      case CompletarStep.REVIEW:
        return (
          <CompletarReviewStep
            request={toCompletarStartRequest(state, REAL_RUN)}
            confirmation={state.confirmation}
            canDryRun={canRunNow(state, DRY_RUN)}
            canRun={canRunNow(state, REAL_RUN)}
            busy={isRunActive}
            runBlockedReason={runBlockedReason(state)}
            onPasswordChange={(password) => dispatch({ type: "passwordChanged", password })}
            onTypedTableChange={(key, value) => dispatch({ type: "typedTableChanged", key, value })}
            onDryRun={() => {
              if (canRunNow(state, DRY_RUN)) startRun(toCompletarStartRequest(state, DRY_RUN));
            }}
            onRun={() => {
              if (canRunNow(state, REAL_RUN)) startRun(toCompletarStartRequest(state, REAL_RUN));
            }}
          />
        );
      case CompletarStep.RUN:
        return (
          <CompletarRunStep
            snapshot={snapshot}
            nowMs={nowMs}
            onNewRun={newRun}
            onBackToReview={() => dispatch({ type: "goTo", step: CompletarStep.REVIEW })}
            onOpenReport={() => dispatch({ type: "goTo", step: CompletarStep.REPORT })}
          />
        );
      case CompletarStep.REPORT:
        return (
          <CompletarReportStep
            snapshot={snapshot}
            onNewRun={newRun}
            onBackToReview={() => dispatch({ type: "goTo", step: CompletarStep.REVIEW })}
          />
        );
    }
  };

  const currentId = completarStepIdOf(state.step);
  const content = renderCurrentStep();
  const goNext = () => dispatch({ type: "next" });
  const goBack = () => dispatch({ type: "back" });

  const steps: WizardStepDef[] = buildCompletarWizardSteps(state).map((def) => ({
    ...def,
    content: def.id === currentId ? content : null,
    onNext: def.id === TABLES_STEP_ID ? goNext : undefined,
    onBack: def.id === REVIEW_STEP_ID ? goBack : undefined,
  }));

  return (
    <WizardOrchestrator
      steps={steps}
      currentStep={currentId}
      onStepClick={(id) => dispatch({ type: "goTo", step: completarStepOfId(id) })}
    />
  );
};
