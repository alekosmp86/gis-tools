"use client";

import React, { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import type { ResolvedColumn } from "@/core/types/tableCatalog";
import type { SafeDbConfig } from "@/core/types/db";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import { isConnectionFailure } from "@/ui-kit/components/tableSelectorLogic";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import type { ActualizarTableKey } from "./actualizarPadronTables";
import {
  actualizarExcludedFor,
  blockingReason,
  canRunNow,
  initialWizardStateFor,
  isTypeTableChosen,
  roleOfTableKey,
  runBlockedReason,
  schemaFieldOf,
  toStartRequest,
  WizardStep,
  wizardReducer,
  type ActualizarWizardSeed,
  type ActualizarWizardState,
} from "./actualizarPadronWizardState";
import { connectionFieldInvalidatesCatalog, type ConnectionField } from "./cargarPadronesWizardState";
import {
  getActualizarPadronRunStore,
  type ActualizarPadronRunSnapshot,
  type ActualizarPadronRunStore,
} from "./actualizarPadronRunStore";
import { RunPhase } from "./jobRunStore";
import { createRoutineJobsClient, RoutineJobsApiError } from "./routineJobsClient";
import type { ActualizarStartRequest, ClientConnection, StagingSelection } from "./clientTypes";
import { changedConnectionFields, trimConnection } from "./connectionProfiles";
import { useConnectionProfiles } from "./useConnectionProfiles";
import { actualizarStepIdOf, actualizarStepOfId, buildActualizarWizardSteps } from "./actualizarWizardSteps";
import { catalogKey } from "./schemaDraft";
import { buildSharedLoadTables, firstCatalogError } from "./sharedCatalog";
import {
  clearCatalogFailure,
  currentCatalogError,
  emptyCatalogFailures,
  recordCatalogFailure,
  type CatalogFailures,
} from "./catalogErrors";
import { ConnectionStep } from "./steps/ConnectionStep";
import { ActualizarTablesStep } from "./steps/ActualizarTablesStep";
import { ActualizarOptionsStep } from "./steps/ActualizarOptionsStep";
import { ActualizarReviewStep } from "./steps/ActualizarReviewStep";
import { ActualizarResultStep } from "./steps/ActualizarResultStep";

const IDLE_SNAPSHOT: ActualizarPadronRunSnapshot = { phase: RunPhase.IDLE };
const ELAPSED_TICK_MS = 1000;
const FIRST_STEP_ID = actualizarStepIdOf(WizardStep.CONNECTION);
const TABLES_STEP_ID = actualizarStepIdOf(WizardStep.TABLES);
const REVIEW_STEP_ID = actualizarStepIdOf(WizardStep.REVIEW);
const RESULT_STEP_ID = actualizarStepIdOf(WizardStep.RESULT);
const DRY_RUN = { dryRun: true };
const REAL_RUN = { dryRun: false };
const client = createRoutineJobsClient();
const getIdleSnapshot = (): ActualizarPadronRunSnapshot => IDLE_SNAPSHOT;
const seedFromStore = (store: ActualizarPadronRunStore, seed: ActualizarWizardSeed): ActualizarWizardState =>
  initialWizardStateFor(store.getSnapshot(), seed);

const catalogKeyOf = (connection: ClientConnection, schema: string): string =>
  catalogKey(trimConnection(connection), schema.trim());

const connectionFailureOf = (error: unknown): string | null =>
  error instanceof RoutineJobsApiError && isConnectionFailure(error.status) ? error.message : null;

export interface ActualizarPadronWizardProps {
  connection?: ClientConnection;
  initialStaging?: StagingSelection;
}

export default function ActualizarPadronWizard({
  connection: lockedConnection,
  initialStaging,
}: ActualizarPadronWizardProps): React.ReactElement {
  const seed: ActualizarWizardSeed = { connection: lockedConnection, staging: initialStaging };
  const connectionLocked = lockedConnection !== undefined;
  const [runStore] = useState(getActualizarPadronRunStore);
  const [state, dispatch] = useReducer(wizardReducer, runStore, (store) => seedFromStore(store, seed));
  const snapshot = useSyncExternalStore(runStore.subscribe, runStore.getSnapshot, getIdleSnapshot);
  const {
    profiles,
    activeProfileId,
    selectProfile: pickProfile,
    saveProfile: saveConnectionProfile,
    deleteProfile,
  } = useConnectionProfiles();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [catalogFailures, setCatalogFailures] = useState<CatalogFailures>(emptyCatalogFailures);

  const isRunActive = snapshot.phase === RunPhase.STARTING || snapshot.phase === RunPhase.RUNNING;

  useEffect(() => {
    if (!isRunActive) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const handle = setInterval(tick, ELAPSED_TICK_MS);
    return () => clearInterval(handle);
  }, [isRunActive]);

  const { connection } = state;
  const requestConnection = trimConnection(connection);
  const loadTables = useMemo(() => {
    const shared = buildSharedLoadTables(client, trimConnection(connection));
    return (schema: string) => {
      const key = catalogKeyOf(connection, schema);
      return shared(schema).then(
        (listing) => {
          setCatalogFailures(clearCatalogFailure(catalogFailures, key));
          return listing;
        },
        (error: unknown) => {
          const message = connectionFailureOf(error);
          if (message !== null) setCatalogFailures(recordCatalogFailure(catalogFailures, key, message));
          throw error;
        },
      );
    };
  }, [connection, catalogFailures]);

  const checkColumns = (key: ActualizarTableKey, table: string): Promise<ResolvedColumn[]> =>
    client.listColumns(
      requestConnection,
      state[schemaFieldOf(key)].trim(),
      table,
      roleOfTableKey(key, { withType: isTypeTableChosen(state) }),
    );

  const catalogError = firstCatalogError([
    currentCatalogError(catalogFailures, catalogKeyOf(connection, state.stagingSchema)),
    currentCatalogError(catalogFailures, catalogKeyOf(connection, state.workSchema)),
    currentCatalogError(catalogFailures, catalogKeyOf(connection, state.cartoSchema)),
  ]);

  const changeConnectionField = (field: ConnectionField, value: string) => {
    dispatch({ type: "connectionChanged", field, value });
    if (connectionFieldInvalidatesCatalog(field)) setCatalogFailures(emptyCatalogFailures());
  };

  const selectProfile = (profileId: string) => {
    const config: SafeDbConfig | null = pickProfile(profileId);
    if (config === null) return;
    for (const field of changedConnectionFields(connection, config)) changeConnectionField(field, config[field]);
  };

  const saveProfile = (name: string) => saveConnectionProfile(name, connection);

  const startRun = (request: ActualizarStartRequest) => {
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
          <ActualizarTablesStep
            stagingSchema={state.stagingSchema}
            workSchema={state.workSchema}
            cartoSchema={state.cartoSchema}
            tables={state.tables}
            excluded={actualizarExcludedFor(state)}
            onSchemaChange={(field, value) => dispatch({ type: "schemaChanged", field, value })}
            onTableChange={(key, table, valid) => dispatch({ type: "tableChosen", key, table, valid })}
            loadTables={loadTables}
            checkColumns={checkColumns}
            blockingReason={blockingReason(state)}
            catalogError={catalogError}
          />
        );
      case WizardStep.OPTIONS:
        return (
          <ActualizarOptionsStep
            options={state.options}
            typeTableChosen={isTypeTableChosen(state)}
            onChange={(patch) => dispatch({ type: "optionsChanged", patch })}
            blockingReason={blockingReason(state)}
          />
        );
      case WizardStep.REVIEW:
        return (
          <ActualizarReviewStep
            request={toStartRequest(state, REAL_RUN)}
            confirmation={state.confirmation}
            canDryRun={canRunNow(state, DRY_RUN)}
            canRun={canRunNow(state, REAL_RUN)}
            busy={isRunActive}
            runBlockedReason={runBlockedReason(state)}
            onConfirmationChange={(patch) => dispatch({ type: "confirmationChanged", patch })}
            onDryRun={() => {
              if (canRunNow(state, DRY_RUN)) startRun(toStartRequest(state, DRY_RUN));
            }}
            onRun={() => {
              if (canRunNow(state, REAL_RUN)) startRun(toStartRequest(state, REAL_RUN));
            }}
          />
        );
      case WizardStep.RESULT:
        return (
          <ActualizarResultStep
            snapshot={snapshot}
            nowMs={nowMs}
            onNewRun={newRun}
            onBackToReview={() => dispatch({ type: "goTo", step: WizardStep.REVIEW })}
          />
        );
    }
  };

  const currentId = actualizarStepIdOf(state.step);
  const content = renderCurrentStep();
  const goNext = () => dispatch({ type: "next" });
  const goBack = () => dispatch({ type: "back" });

  const steps: WizardStepDef[] = buildActualizarWizardSteps(state).map((def) => ({
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
        if (!(connectionLocked && id === FIRST_STEP_ID)) dispatch({ type: "goTo", step: actualizarStepOfId(id) });
      }}
    />
  );
}
