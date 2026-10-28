"use client";

import React, { useMemo, useReducer, useState, useSyncExternalStore } from "react";
import type { SafeDbConfig } from "@/core/types/db";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import { isConnectionFailure } from "@/ui-kit/components/tableSelectorLogic";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import type { ResolvedColumn } from "@/core/types/tableCatalog";
import type { TableRole } from "../jobs/cargar-padrones/constants";
import {
  blockingReason,
  canRunNow,
  connectionFieldInvalidatesCatalog,
  initialWizardStateFor,
  isRealRunConfirmed,
  runBlockedReason,
  toStartRequest,
  WizardStep,
  wizardReducer,
  type ConnectionField,
  stagingSelectionOf,
  type WizardAction,
  type WizardSeed,
  type WizardState,
} from "./cargarPadronesWizardState";
import { useElapsedTick } from "./useElapsedTick";
import { createRoutineJobsClient, RoutineJobsApiError } from "./routineJobsClient";
import {
  getCargarPadronesRunStore,
  type CargarPadronesRunSnapshot,
  type CargarPadronesRunStore,
} from "./cargarPadronesRunStore";
import type { ClientConnection, StagingSelection, StartRequest } from "./clientTypes";
import { changedConnectionFields, trimConnection } from "./connectionProfiles";
import { useConnectionProfiles } from "./useConnectionProfiles";
import { buildWizardSteps, excludedFor, stepIdOf, stepOfId } from "./wizardSteps";
import { catalogKey } from "./schemaDraft";
import { buildSharedLoadTables } from "./sharedCatalog";
import {
  clearCatalogFailure,
  currentCatalogError,
  emptyCatalogFailures,
  recordCatalogFailure,
  type CatalogFailures,
} from "./catalogErrors";
import { ConnectionStep } from "./steps/ConnectionStep";
import { TablesStep } from "./steps/TablesStep";
import { OptionsStep } from "./steps/OptionsStep";
import { ReviewStep } from "./steps/ReviewStep";
import { ResultStep } from "./steps/ResultStep";

const IDLE_SNAPSHOT: CargarPadronesRunSnapshot = { phase: "idle" };
const FIRST_STEP_ID = stepIdOf(WizardStep.CONNECTION);
const TABLES_STEP_ID = stepIdOf(WizardStep.TABLES);
const REVIEW_STEP_ID = stepIdOf(WizardStep.REVIEW);
const RESULT_STEP_ID = stepIdOf(WizardStep.RESULT);
const DRY_RUN = { dryRun: true };
const REAL_RUN = { dryRun: false };
const client = createRoutineJobsClient();
const getIdleSnapshot = (): CargarPadronesRunSnapshot => IDLE_SNAPSHOT;
const seedFromStore = (store: CargarPadronesRunStore, seed: WizardSeed): WizardState =>
  initialWizardStateFor(store.getSnapshot(), seed);

export interface CargarPadronesWizardProps {
  connection?: ClientConnection;
  onStagingChosen?: (staging: StagingSelection | null) => void;
}

export const CargarPadronesWizard: React.FC<CargarPadronesWizardProps> = ({
  connection: lockedConnection,
  onStagingChosen,
}) => {
  const seed: WizardSeed = { connection: lockedConnection };
  const connectionLocked = lockedConnection !== undefined;
  const [runStore] = useState(getCargarPadronesRunStore);
  const [state, dispatch] = useReducer(wizardReducer, runStore, (store) => seedFromStore(store, seed));
  const snapshot = useSyncExternalStore(runStore.subscribe, runStore.getSnapshot, getIdleSnapshot);
  const {
    profiles,
    activeProfileId,
    selectProfile: pickProfile,
    saveProfile: saveConnectionProfile,
    deleteProfile,
  } = useConnectionProfiles();
  const [catalogFailures, setCatalogFailures] = useState<CatalogFailures>(emptyCatalogFailures);

  const isRunActive = snapshot.phase === "starting" || snapshot.phase === "running";
  const nowMs = useElapsedTick(isRunActive);

  const { connection } = state;
  const requestConnection = trimConnection(connection);
  const schema = state.schema.trim();
  const loadTables = useMemo(() => {
    const shared = buildSharedLoadTables(client, trimConnection(connection));
    return (listedSchema: string) =>
      shared(listedSchema).then((listing) => {
        setCatalogFailures((previous) =>
          clearCatalogFailure(previous, catalogKey(trimConnection(connection), listedSchema.trim())),
        );
        return listing;
      });
  }, [connection]);
  const checkColumns = (role: TableRole, table: string): Promise<ResolvedColumn[]> =>
    client.listColumns(requestConnection, schema, table, role);

  const currentCatalogKey = catalogKey(requestConnection, schema);
  const catalogError = currentCatalogError(catalogFailures, currentCatalogKey);

  const recordCatalogError = (error: unknown) => {
    if (!(error instanceof RoutineJobsApiError) || !isConnectionFailure(error.status)) return;
    const message = error.message;
    setCatalogFailures(recordCatalogFailure(catalogFailures, currentCatalogKey, message));
  };

  const changeConnectionField = (field: ConnectionField, value: string) => {
    dispatch({ type: "connectionChanged", field, value });
    if (connectionFieldInvalidatesCatalog(field)) setCatalogFailures(emptyCatalogFailures());
  };

  const dispatchWizard = (action: WizardAction) => {
    dispatch(action);
    if (action.type === "schemaChanged" || action.type === "tableChosen") {
      onStagingChosen?.(stagingSelectionOf(wizardReducer(state, action)));
    }
  };

  const commitSchema = (next: string) => dispatchWizard({ type: "schemaChanged", schema: next });

  const selectProfile = (profileId: string) => {
    const config: SafeDbConfig | null = pickProfile(profileId);
    if (config === null) return;
    for (const field of changedConnectionFields(connection, config)) changeConnectionField(field, config[field]);
  };

  const saveProfile = (name: string) => saveConnectionProfile(name, connection);

  const startRun = (request: StartRequest) => {
    void runStore.start(request);
    dispatch({ type: "runStarted" });
  };

  const newRun = () => {
    runStore.reset();
    setCatalogFailures(emptyCatalogFailures());
    dispatch({ type: "reset", seed });
  };

  const renderCurrentStep = (): React.ReactNode => {
    switch (state.step) {
      case WizardStep.CONNECTION:
        return (
          <ConnectionStep
            connection={state.connection}
            profiles={profiles}
            activeProfileId={activeProfileId}
            onFieldChange={changeConnectionField}
            onSelectProfile={selectProfile}
            onSaveProfile={saveProfile}
            onDeleteProfile={deleteProfile}
            blockingReason={blockingReason(state)}
          />
        );
      case WizardStep.TABLES:
        return (
          <TablesStep
            schema={state.schema}
            committedSchema={state.schema}
            tables={state.tables}
            excluded={excludedFor(state)}
            onSchemaCommit={commitSchema}
            onTableChange={(role, table, valid) => dispatchWizard({ type: "tableChosen", role, table, valid })}
            loadTables={loadTables}
            checkColumns={checkColumns}
            blockingReason={blockingReason(state)}
            catalogError={catalogError}
            onLoadError={recordCatalogError}
          />
        );
      case WizardStep.OPTIONS:
        return (
          <OptionsStep options={state.options} onChange={(patch) => dispatch({ type: "optionsChanged", patch })} />
        );
      case WizardStep.REVIEW:
        return (
          <ReviewStep
            request={toStartRequest(state, REAL_RUN)}
            confirmation={state.confirmation}
            confirmed={isRealRunConfirmed(state)}
            busy={isRunActive}
            runBlockedReason={runBlockedReason(state)}
            onConfirmationChange={(patch) => dispatch({ type: "confirmationChanged", patch })}
            onDryRun={() => {
              if (canRunNow(state)) startRun(toStartRequest(state, DRY_RUN));
            }}
            onRun={() => {
              if (canRunNow(state) && isRealRunConfirmed(state)) startRun(toStartRequest(state, REAL_RUN));
            }}
          />
        );
      case WizardStep.RESULT:
        return (
          <ResultStep
            snapshot={snapshot}
            nowMs={nowMs}
            onNewRun={newRun}
            onBackToReview={() => dispatch({ type: "goTo", step: WizardStep.REVIEW })}
          />
        );
    }
  };

  const currentId = stepIdOf(state.step);
  const content = renderCurrentStep();
  const goNext = () => dispatch({ type: "next" });
  const goBack = () => dispatch({ type: "back" });

  const steps: WizardStepDef[] = buildWizardSteps(state).map((def) => ({
    ...def,
    content: def.id === currentId ? content : null,
    onNext: def.id >= FIRST_STEP_ID && def.id < REVIEW_STEP_ID ? goNext : undefined,
    onBack: def.id > FIRST_STEP_ID && def.id < RESULT_STEP_ID && !(connectionLocked && def.id === TABLES_STEP_ID) ? goBack : undefined,
  }));

  return (
    <WizardOrchestrator
      steps={steps}
      currentStep={currentId}
      onStepClick={(id) => {
        if (!(connectionLocked && id === FIRST_STEP_ID)) dispatch({ type: "goTo", step: stepOfId(id) });
      }}
    />
  );
};
