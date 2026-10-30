"use client";

import React, { useReducer, useState, useSyncExternalStore } from "react";
import type { ResolvedColumn } from "@/core/types/tableCatalog";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import {
  activeSlotsOf,
  blockingReason,
  canRunNow,
  excludedUnitTablesOf,
  initialUnidadWizardStateFor,
  runBlockedReason,
  toUnidadStartRequest,
  UnidadStep,
  unidadWizardReducer,
  type UnidadWizardSeed,
} from "./unidadTerritorialWizardState";
import {
  buildUnidadWizardSteps,
  unidadStepIdOf,
  unidadStepOfId,
} from "./unidadTerritorialWizardSteps";
import { getUnidadRunStore, type UnidadRunSnapshot, type UnidadRunStore } from "./unidadTerritorialRunStore";
import { getCargarLocalidadesRunStore } from "./cargarLocalidadesRunStore";
import { LocalidadesDestination } from "./localidadesDestination";
import type { ClientConnection, UnidadStartRequest } from "./clientTypes";
import { trimConnection } from "./connectionProfiles";
import { useCatalogLoader } from "./useCatalogLoader";
import { useElapsedTick } from "./useElapsedTick";
import { RunPhase } from "./jobRunStore";
import { createRoutineJobsClient } from "./routineJobsClient";
import { UnidadTablesStep, type UnitColumnRole } from "./steps/UnidadTablesStep";
import { UnidadOptionsStep } from "./steps/UnidadOptionsStep";
import { UnidadReviewStep } from "./steps/UnidadReviewStep";
import { UnidadRunStep } from "./steps/UnidadRunStep";
import { UnidadReportStep } from "./steps/UnidadReportStep";

const IDLE_SNAPSHOT: UnidadRunSnapshot = { phase: RunPhase.IDLE };
const TABLES_STEP_ID = unidadStepIdOf(UnidadStep.TABLES);
const OPTIONS_STEP_ID = unidadStepIdOf(UnidadStep.OPTIONS);
const REVIEW_STEP_ID = unidadStepIdOf(UnidadStep.REVIEW);
const DRY_RUN = { dryRun: true };
const REAL_RUN = { dryRun: false };
const client = createRoutineJobsClient();
const getIdleSnapshot = (): UnidadRunSnapshot => IDLE_SNAPSHOT;

/** The locality table prefills from the CARTO target of the last stage 2 run, else its first target, when there is one. */
function seedFrom(connection: ClientConnection): UnidadWizardSeed {
  const targets = getCargarLocalidadesRunStore().getSnapshot().plan?.targets;
  const locality = targets?.find((target) => target.destination === LocalidadesDestination.CARTO) ?? targets?.[0];
  return {
    connection: trimConnection(connection),
    locality: locality === undefined ? undefined : { schema: locality.schema, table: locality.table },
  };
}

export interface UnidadTerritorialWizardProps {
  connection: ClientConnection;
}

export const UnidadTerritorialWizard: React.FC<UnidadTerritorialWizardProps> = ({ connection: hubConnection }) => {
  const [runStore] = useState<UnidadRunStore>(getUnidadRunStore);
  const [seed] = useState(() => seedFrom(hubConnection));
  const [state, dispatch] = useReducer(unidadWizardReducer, runStore, (store: UnidadRunStore) =>
    initialUnidadWizardStateFor(store.getSnapshot(), seed)
  );
  const snapshot = useSyncExternalStore(runStore.subscribe, runStore.getSnapshot, getIdleSnapshot);

  const isRunActive = snapshot.phase === RunPhase.STARTING || snapshot.phase === RunPhase.RUNNING;
  const nowMs = useElapsedTick(isRunActive);

  const { connection } = state;
  const { loadTables, reset: resetCatalog, catalogErrorFor } = useCatalogLoader(client, connection);

  const checkColumns = (role: UnitColumnRole, schema: string, table: string): Promise<ResolvedColumn[]> =>
    client.listColumns(trimConnection(connection), schema, table, role);

  const catalogError = catalogErrorFor(activeSlotsOf(state).map((key) => state.slots[key].schema));

  const startRun = (request: UnidadStartRequest) => {
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
      case UnidadStep.TABLES:
        return (
          <UnidadTablesStep
            slots={state.slots}
            excluded={excludedUnitTablesOf(state)}
            linkAddressMaster={state.options.linkAddressMaster}
            onLinkAddressMasterChange={(linkAddressMaster) => dispatch({ type: "optionsChanged", patch: { linkAddressMaster } })}
            onSchemaChange={(key, schema) => dispatch({ type: "slotSchemaChanged", key, schema })}
            onTableChange={(key, table, valid) => dispatch({ type: "slotTableChosen", key, table, valid })}
            loadTables={loadTables}
            checkColumns={checkColumns}
            blockingReason={blockingReason(state)}
            catalogError={catalogError}
          />
        );
      case UnidadStep.OPTIONS:
        return (
          <UnidadOptionsStep
            options={state.options}
            onChange={(patch) => dispatch({ type: "optionsChanged", patch })}
            blockingReason={blockingReason(state)}
          />
        );
      case UnidadStep.REVIEW:
        return (
          <UnidadReviewStep
            request={toUnidadStartRequest(state, REAL_RUN)}
            confirmation={state.confirmation}
            canDryRun={canRunNow(state, DRY_RUN)}
            canRun={canRunNow(state, REAL_RUN)}
            busy={isRunActive}
            runBlockedReason={runBlockedReason(state)}
            onConfirmationChange={(patch) => dispatch({ type: "confirmationChanged", patch })}
            onDryRun={() => {
              if (canRunNow(state, DRY_RUN)) startRun(toUnidadStartRequest(state, DRY_RUN));
            }}
            onRun={() => {
              if (canRunNow(state, REAL_RUN)) startRun(toUnidadStartRequest(state, REAL_RUN));
            }}
          />
        );
      case UnidadStep.RUN:
        return (
          <UnidadRunStep
            snapshot={snapshot}
            nowMs={nowMs}
            onNewRun={newRun}
            onBackToReview={() => dispatch({ type: "goTo", step: UnidadStep.REVIEW })}
            onOpenReport={() => dispatch({ type: "goTo", step: UnidadStep.REPORT })}
          />
        );
      case UnidadStep.REPORT:
        return (
          <UnidadReportStep
            snapshot={snapshot}
            onNewRun={newRun}
            onBackToReview={() => dispatch({ type: "goTo", step: UnidadStep.REVIEW })}
          />
        );
    }
  };

  const currentId = unidadStepIdOf(state.step);
  const content = renderCurrentStep();
  const goNext = () => dispatch({ type: "next" });
  const goBack = () => dispatch({ type: "back" });

  const steps: WizardStepDef[] = buildUnidadWizardSteps(state).map((def) => ({
    ...def,
    content: def.id === currentId ? content : null,
    onNext: def.id === TABLES_STEP_ID || def.id === OPTIONS_STEP_ID ? goNext : undefined,
    onBack: def.id === OPTIONS_STEP_ID || def.id === REVIEW_STEP_ID ? goBack : undefined,
  }));

  return (
    <WizardOrchestrator
      steps={steps}
      currentStep={currentId}
      onStepClick={(id) => dispatch({ type: "goTo", step: unidadStepOfId(id) })}
    />
  );
};
