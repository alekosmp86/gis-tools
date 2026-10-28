"use client";

import React, { useReducer, useState, useSyncExternalStore } from "react";
import type { ResolvedColumn } from "@/core/types/tableCatalog";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import type { LocalidadesTableRole } from "../jobs/cargar-localidades/constants";
import {
  blockingReason,
  canRunNow,
  excludedTablesOf,
  includedTargetsOf,
  initialWizardStateFor,
  LocalidadesStep,
  localidadesWizardReducer,
  runBlockedReason,
  toRunRequest,
  toStartRequest,
  type LocalidadesWizardSeed,
} from "./cargarLocalidadesWizardState";
import {
  buildLocalidadesWizardSteps,
  localidadesStepIdOf,
  localidadesStepOfId,
} from "./cargarLocalidadesWizardSteps";
import {
  getCargarLocalidadesRunStore,
  type CargarLocalidadesRunSnapshot,
  type CargarLocalidadesRunStore,
  type LocalidadesRunRequest,
} from "./cargarLocalidadesRunStore";
import type { ClientConnection, StagingSelection } from "./clientTypes";
import { trimConnection } from "./connectionProfiles";
import { useCatalogLoader } from "./useCatalogLoader";
import { useElapsedTick } from "./useElapsedTick";
import { RunPhase } from "./jobRunStore";
import { createRoutineJobsClient } from "./routineJobsClient";
import { LocalidadesTablesStep } from "./steps/LocalidadesTablesStep";
import { LocalidadesOptionsStep } from "./steps/LocalidadesOptionsStep";
import { LocalidadesReviewStep } from "./steps/LocalidadesReviewStep";
import { LocalidadesRunStep } from "./steps/LocalidadesRunStep";
import { LocalidadesReportStep } from "./steps/LocalidadesReportStep";

const IDLE_SNAPSHOT: CargarLocalidadesRunSnapshot = { phase: RunPhase.IDLE };
const TABLES_STEP_ID = localidadesStepIdOf(LocalidadesStep.TABLES);
const OPTIONS_STEP_ID = localidadesStepIdOf(LocalidadesStep.OPTIONS);
const REVIEW_STEP_ID = localidadesStepIdOf(LocalidadesStep.REVIEW);
const DRY_RUN = { dryRun: true };
const REAL_RUN = { dryRun: false };
const client = createRoutineJobsClient();
const getIdleSnapshot = (): CargarLocalidadesRunSnapshot => IDLE_SNAPSHOT;

export interface CargarLocalidadesWizardProps {
  connection: ClientConnection;
  initialStaging?: StagingSelection;
}

export const CargarLocalidadesWizard: React.FC<CargarLocalidadesWizardProps> = ({ connection: hubConnection, initialStaging }) => {
  const seed: LocalidadesWizardSeed = { connection: trimConnection(hubConnection), staging: initialStaging };
  const [runStore] = useState(getCargarLocalidadesRunStore);
  const [state, dispatch] = useReducer(localidadesWizardReducer, runStore, (store: CargarLocalidadesRunStore) =>
    initialWizardStateFor(store.getSnapshot(), seed),
  );
  const snapshot = useSyncExternalStore(runStore.subscribe, runStore.getSnapshot, getIdleSnapshot);

  const isRunActive = snapshot.phase === RunPhase.STARTING || snapshot.phase === RunPhase.RUNNING;
  const nowMs = useElapsedTick(isRunActive);

  const { connection } = state;
  const { loadTables, reset: resetCatalog, catalogErrorFor } = useCatalogLoader(client, connection);

  const checkColumns = (role: LocalidadesTableRole, schema: string, table: string): Promise<ResolvedColumn[]> =>
    client.listColumns(trimConnection(connection), schema, table, role);

  const catalogError = catalogErrorFor([
    state.stagingSchema,
    state.provinceSchema,
    ...includedTargetsOf(state).map((target) => target.schema),
  ]);

  const startRun = (run: LocalidadesRunRequest) => {
    void runStore.start(run);
    dispatch({ type: "runStarted" });
  };

  const newRun = () => {
    runStore.reset();
    resetCatalog();
    dispatch({ type: "reset", seed });
  };

  const renderCurrentStep = (): React.ReactNode => {
    switch (state.step) {
      case LocalidadesStep.TABLES:
        return (
          <LocalidadesTablesStep
            stagingSchema={state.stagingSchema}
            provinceSchema={state.provinceSchema}
            tables={state.tables}
            excluded={excludedTablesOf(state)}
            targets={state.targets}
            onStagingSchemaChange={(schema) => dispatch({ type: "stagingSchemaChanged", schema })}
            onProvinceSchemaChange={(schema) => dispatch({ type: "provinceSchemaChanged", schema })}
            onTableChange={(key, table, valid) => dispatch({ type: "tableChosen", key, table, valid })}
            onTargetSchemaChange={(destination, schema) => dispatch({ type: "targetSchemaChanged", destination, schema })}
            onTargetTableChange={(destination, table, valid) => dispatch({ type: "targetChosen", destination, table, valid })}
            onTargetIncludedChange={(destination, included) => dispatch({ type: "targetIncludedChanged", destination, included })}
            loadTables={loadTables}
            checkColumns={checkColumns}
            blockingReason={blockingReason(state)}
            catalogError={catalogError}
          />
        );
      case LocalidadesStep.OPTIONS:
        return (
          <LocalidadesOptionsStep
            options={state.options}
            onChange={(patch) => dispatch({ type: "optionsChanged", patch })}
            blockingReason={blockingReason(state)}
          />
        );
      case LocalidadesStep.REVIEW:
        return (
          <LocalidadesReviewStep
            request={toStartRequest(state, REAL_RUN)}
            targets={includedTargetsOf(state)}
            confirmation={state.confirmation}
            canDryRun={canRunNow(state, DRY_RUN)}
            canRun={canRunNow(state, REAL_RUN)}
            busy={isRunActive}
            runBlockedReason={runBlockedReason(state)}
            onConfirmationChange={(patch) => dispatch({ type: "confirmationChanged", patch })}
            onDryRun={() => {
              if (canRunNow(state, DRY_RUN)) startRun(toRunRequest(state, DRY_RUN));
            }}
            onRun={() => {
              if (canRunNow(state, REAL_RUN)) startRun(toRunRequest(state, REAL_RUN));
            }}
          />
        );
      case LocalidadesStep.RUN:
        return (
          <LocalidadesRunStep
            snapshot={snapshot}
            nowMs={nowMs}
            onNewRun={newRun}
            onBackToReview={() => dispatch({ type: "goTo", step: LocalidadesStep.REVIEW })}
            onOpenReport={() => dispatch({ type: "goTo", step: LocalidadesStep.REPORT })}
          />
        );
      case LocalidadesStep.REPORT:
        return (
          <LocalidadesReportStep
            snapshot={snapshot}
            onNewRun={newRun}
            onBackToReview={() => dispatch({ type: "goTo", step: LocalidadesStep.REVIEW })}
          />
        );
    }
  };

  const currentId = localidadesStepIdOf(state.step);
  const content = renderCurrentStep();
  const goNext = () => dispatch({ type: "next" });
  const goBack = () => dispatch({ type: "back" });

  const steps: WizardStepDef[] = buildLocalidadesWizardSteps(state).map((def) => ({
    ...def,
    content: def.id === currentId ? content : null,
    onNext: def.id === TABLES_STEP_ID || def.id === OPTIONS_STEP_ID ? goNext : undefined,
    onBack: def.id === OPTIONS_STEP_ID || def.id === REVIEW_STEP_ID ? goBack : undefined,
  }));

  return (
    <WizardOrchestrator
      steps={steps}
      currentStep={currentId}
      onStepClick={(id) => dispatch({ type: "goTo", step: localidadesStepOfId(id) })}
    />
  );
};
