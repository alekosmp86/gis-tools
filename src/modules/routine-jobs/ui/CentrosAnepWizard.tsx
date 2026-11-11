"use client";

import React, { useReducer, useState, useSyncExternalStore } from "react";
import type { ResolvedColumn } from "@/core/types/tableCatalog";
import type { SafeDbConfig } from "@/core/types/db";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import { CENTROS_ROLES, type CentrosTableRole } from "../jobs/centros-anep/constants";
import { connectionFieldInvalidatesCatalog, type ConnectionField } from "./cargarPadronesWizardState";
import { getCentrosAnepRunStore, type CentrosAnepRunSnapshot, type CentrosAnepRunStore } from "./centrosAnepRunStore";
import {
  blockingReason,
  canAnalyzeNow,
  canLoadNow,
  centrosAnepWizardReducer,
  CentrosAnepStep,
  excludedCentrosAnepTablesOf,
  initialCentrosAnepWizardStateFor,
  runBlockedReason,
  toCentrosAnepStartRequest,
} from "./centrosAnepWizardState";
import { buildCentrosAnepWizardSteps, centrosAnepStepIdOf, centrosAnepStepOfId } from "./centrosAnepWizardSteps";
import type { CentrosAnepStartRequest } from "./clientTypes";
import { changedConnectionFields, trimConnection } from "./connectionProfiles";
import { RunPhase } from "./jobRunStore";
import { createRoutineJobsClient } from "./routineJobsClient";
import { useCatalogLoader } from "./useCatalogLoader";
import { useConnectionProfiles } from "./useConnectionProfiles";
import { useElapsedTick } from "./useElapsedTick";
import { CentrosAnepResultStep } from "./steps/CentrosAnepResultStep";
import { CentrosAnepReviewStep } from "./steps/CentrosAnepReviewStep";
import { CentrosAnepStagingNote } from "./steps/CentrosAnepStagingNote";
import { CentrosAnepTablesStep } from "./steps/CentrosAnepTablesStep";
import { ConnectionStep } from "./steps/ConnectionStep";

const IDLE_SNAPSHOT: CentrosAnepRunSnapshot = { phase: RunPhase.IDLE };
const FIRST_STEP_ID = centrosAnepStepIdOf(CentrosAnepStep.CONNECTION);
const REVIEW_STEP_ID = centrosAnepStepIdOf(CentrosAnepStep.REVIEW);
const ANALYZE = { dryRun: true };
const LOAD = { dryRun: false };
const client = createRoutineJobsClient();
const getIdleSnapshot = (): CentrosAnepRunSnapshot => IDLE_SNAPSHOT;

export const CentrosAnepWizard: React.FC = () => {
  const [runStore] = useState<CentrosAnepRunStore>(getCentrosAnepRunStore);
  const [state, dispatch] = useReducer(centrosAnepWizardReducer, runStore, (store: CentrosAnepRunStore) =>
    initialCentrosAnepWizardStateFor(store.getSnapshot())
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

  const checkColumns = (role: CentrosTableRole, schema: string, table: string): Promise<ResolvedColumn[]> =>
    client.listColumns(trimConnection(connection), schema, table, role);

  const catalogError = catalogErrorFor(CENTROS_ROLES.map((role) => state.slots[role].schema));

  const changeConnectionField = (field: ConnectionField, value: string) => {
    dispatch({ type: "connectionChanged", field, value });
    if (connectionFieldInvalidatesCatalog(field)) resetCatalog();
  };

  const selectProfile = (profileId: string) => {
    const config: SafeDbConfig | null = pickProfile(profileId);
    if (config === null) return;
    for (const field of changedConnectionFields(connection, config)) changeConnectionField(field, config[field]);
  };

  const startRun = (request: CentrosAnepStartRequest) => {
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
      case CentrosAnepStep.CONNECTION:
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
            note={<CentrosAnepStagingNote />}
          />
        );
      case CentrosAnepStep.TABLES:
        return (
          <CentrosAnepTablesStep
            slots={state.slots}
            excluded={excludedCentrosAnepTablesOf(state)}
            onSchemaChange={(key, schema) => dispatch({ type: "slotSchemaChanged", key, schema })}
            onTableChange={(key, table, valid) => dispatch({ type: "slotTableChosen", key, table, valid })}
            loadTables={loadTables}
            checkColumns={checkColumns}
            blockingReason={blockingReason(state)}
            catalogError={catalogError}
          />
        );
      case CentrosAnepStep.REVIEW:
        return (
          <CentrosAnepReviewStep
            request={toCentrosAnepStartRequest(state, ANALYZE)}
            acknowledged={state.confirmation.acknowledged}
            canAnalyze={canAnalyzeNow(state)}
            canLoad={canLoadNow(state)}
            busy={isRunActive}
            runBlockedReason={runBlockedReason(state)}
            onConfirmationChange={(patch) => dispatch({ type: "confirmationChanged", patch })}
            onAnalyze={() => {
              if (canAnalyzeNow(state)) startRun(toCentrosAnepStartRequest(state, ANALYZE));
            }}
            onLoad={() => {
              if (canLoadNow(state)) startRun(toCentrosAnepStartRequest(state, LOAD));
            }}
          />
        );
      case CentrosAnepStep.RESULT:
        return (
          <CentrosAnepResultStep
            snapshot={snapshot}
            nowMs={nowMs}
            onNewRun={newRun}
            onBackToReview={() => dispatch({ type: "goTo", step: CentrosAnepStep.REVIEW })}
          />
        );
    }
  };

  const currentId = centrosAnepStepIdOf(state.step);
  const content = renderCurrentStep();

  const steps: WizardStepDef[] = buildCentrosAnepWizardSteps(state).map((def) => ({
    ...def,
    content: def.id === currentId ? content : null,
    onNext: def.id >= FIRST_STEP_ID && def.id < REVIEW_STEP_ID ? () => dispatch({ type: "next" }) : undefined,
    onBack: def.id > FIRST_STEP_ID && def.id <= REVIEW_STEP_ID ? () => dispatch({ type: "back" }) : undefined,
  }));

  return (
    <WizardOrchestrator
      steps={steps}
      currentStep={currentId}
      onStepClick={(id) => dispatch({ type: "goTo", step: centrosAnepStepOfId(id) })}
    />
  );
};
