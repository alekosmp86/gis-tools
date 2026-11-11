"use client";

import React, { useReducer, useState, useSyncExternalStore } from "react";
import type { ResolvedColumn } from "@/core/types/tableCatalog";
import type { SafeDbConfig } from "@/core/types/db";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { EJES_ROLES, type EjesTableRole } from "../jobs/ejes-calles/constants";
import { connectionFieldInvalidatesCatalog, type ConnectionField } from "./cargarPadronesWizardState";
import type { EjesStartRequest } from "./clientTypes";
import { changedConnectionFields, trimConnection } from "./connectionProfiles";
import { getEjesRunStore, type EjesRunSnapshot, type EjesRunStore } from "./ejesCallesRunStore";
import {
  blockingReason,
  canAnalyzeNow,
  canLoadNow,
  ejesWizardReducer,
  EjesStep,
  excludedEjesTablesOf,
  initialEjesWizardStateFor,
  runBlockedReason,
  toEjesStartRequest,
} from "./ejesCallesWizardState";
import { buildEjesWizardSteps, ejesStepIdOf, ejesStepOfId } from "./ejesCallesWizardSteps";
import { RunPhase } from "./jobRunStore";
import { createRoutineJobsClient } from "./routineJobsClient";
import { useCatalogLoader } from "./useCatalogLoader";
import { useConnectionProfiles } from "./useConnectionProfiles";
import { useElapsedTick } from "./useElapsedTick";
import { ConnectionStep } from "./steps/ConnectionStep";
import { EjesResultStep } from "./steps/EjesResultStep";
import { EjesReviewStep } from "./steps/EjesReviewStep";
import { EjesTablesStep } from "./steps/EjesTablesStep";

const IDLE_SNAPSHOT: EjesRunSnapshot = { phase: RunPhase.IDLE };
const FIRST_STEP_ID = ejesStepIdOf(EjesStep.CONNECTION);
const REVIEW_STEP_ID = ejesStepIdOf(EjesStep.REVIEW);
const ANALYZE = { dryRun: true };
const LOAD = { dryRun: false };
const client = createRoutineJobsClient();
const getIdleSnapshot = (): EjesRunSnapshot => IDLE_SNAPSHOT;

export const EjesCallesWizard: React.FC = () => {
  const [runStore] = useState<EjesRunStore>(getEjesRunStore);
  const [state, dispatch] = useReducer(ejesWizardReducer, runStore, (store: EjesRunStore) =>
    initialEjesWizardStateFor(store.getSnapshot())
  );
  const snapshot = useSyncExternalStore(runStore.subscribe, runStore.getSnapshot, getIdleSnapshot);
  const {
    profiles,
    activeProfileId,
    selectProfile: pickProfile,
    saveProfile: saveConnectionProfile,
    deleteProfile,
  } = useConnectionProfiles();

  const isRunActive = snapshot.phase === RunPhase.STARTING || snapshot.phase === RunPhase.RUNNING;
  const nowMs = useElapsedTick(isRunActive);
  const { connection } = state;
  const { loadTables, reset: resetCatalog, catalogErrorFor } = useCatalogLoader(client, connection);

  const checkColumns = (role: EjesTableRole, schema: string, table: string): Promise<ResolvedColumn[]> =>
    client.listColumns(trimConnection(connection), schema, table, role);

  const catalogError = catalogErrorFor(EJES_ROLES.map((role) => state.slots[role].schema));

  const changeConnectionField = (field: ConnectionField, value: string) => {
    dispatch({ type: "connectionChanged", field, value });
    if (connectionFieldInvalidatesCatalog(field)) resetCatalog();
  };

  const selectProfile = (profileId: string) => {
    const config: SafeDbConfig | null = pickProfile(profileId);
    if (config === null) return;
    for (const field of changedConnectionFields(connection, config)) changeConnectionField(field, config[field]);
  };

  const startRun = (request: EjesStartRequest) => {
    void runStore.start(request);
    dispatch({ type: "runStarted" });
  };

  const newRun = () => {
    runStore.reset();
    resetCatalog();
    dispatch({ type: "reset" });
  };

  const renderCurrentStep = (): React.ReactNode => {
    switch (state.step) {
      case EjesStep.CONNECTION:
        return (
          <ConnectionStep
            connection={state.connection}
            profiles={profiles}
            activeProfileId={activeProfileId}
            onFieldChange={changeConnectionField}
            onSelectProfile={selectProfile}
            onSaveProfile={(name) => saveConnectionProfile(name, connection)}
            onDeleteProfile={deleteProfile}
            blockingReason={blockingReason(state)}
          />
        );
      case EjesStep.TABLES:
        return (
          <EjesTablesStep
            slots={state.slots}
            excluded={excludedEjesTablesOf(state)}
            onSchemaChange={(key, schema) => dispatch({ type: "slotSchemaChanged", key, schema })}
            onTableChange={(key, table, valid) => dispatch({ type: "slotTableChosen", key, table, valid })}
            loadTables={loadTables}
            checkColumns={checkColumns}
            blockingReason={blockingReason(state)}
            catalogError={catalogError}
          />
        );
      case EjesStep.REVIEW:
        return (
          <EjesReviewStep
            request={toEjesStartRequest(state, ANALYZE)}
            canAnalyze={canAnalyzeNow(state)}
            canLoad={canLoadNow(state, snapshot)}
            busy={isRunActive}
            runBlockedReason={runBlockedReason(state)}
            onConfirmationChange={(patch) => dispatch({ type: "confirmationChanged", patch })}
            onAnalyze={() => {
              if (canAnalyzeNow(state)) startRun(toEjesStartRequest(state, ANALYZE));
            }}
            onLoad={() => {
              if (canLoadNow(state, snapshot)) startRun(toEjesStartRequest(state, LOAD));
            }}
          />
        );
      case EjesStep.RESULT:
        return (
          <EjesResultStep
            snapshot={snapshot}
            nowMs={nowMs}
            onNewRun={newRun}
            onBackToReview={() => dispatch({ type: "goTo", step: EjesStep.REVIEW })}
          />
        );
    }
  };

  const currentId = ejesStepIdOf(state.step);
  const content = renderCurrentStep();

  const steps: WizardStepDef[] = buildEjesWizardSteps(state).map((def) => ({
    ...def,
    content: def.id === currentId ? content : null,
    onNext: def.id >= FIRST_STEP_ID && def.id < REVIEW_STEP_ID ? () => dispatch({ type: "next" }) : undefined,
    onBack: def.id > FIRST_STEP_ID && def.id <= REVIEW_STEP_ID ? () => dispatch({ type: "back" }) : undefined,
  }));

  return (
    <WizardOrchestrator
      steps={steps}
      currentStep={currentId}
      onStepClick={(id) => dispatch({ type: "goTo", step: ejesStepOfId(id) })}
    />
  );
};
