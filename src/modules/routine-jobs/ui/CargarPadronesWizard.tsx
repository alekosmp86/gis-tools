"use client";

import React, { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
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
  type WizardState,
} from "./cargarPadronesWizardState";
import { createRoutineJobsClient, RoutineJobsApiError } from "./routineJobsClient";
import {
  getCargarPadronesRunStore,
  type CargarPadronesRunSnapshot,
  type CargarPadronesRunStore,
} from "./cargarPadronesRunStore";
import { browserJobProfileStorage, createJobProfileStorage, type JobProfile, type JobSetup } from "./jobProfileStorage";
import type { ClientConnection, StartRequest } from "./clientTypes";
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
const ELAPSED_TICK_MS = 1000;
const FIRST_STEP_ID = stepIdOf(WizardStep.CONNECTION);
const REVIEW_STEP_ID = stepIdOf(WizardStep.REVIEW);
const RESULT_STEP_ID = stepIdOf(WizardStep.RESULT);
const DRY_RUN = { dryRun: true };
const REAL_RUN = { dryRun: false };
const NO_PROFILES: JobProfile[] = [];

const client = createRoutineJobsClient();
const getIdleSnapshot = (): CargarPadronesRunSnapshot => IDLE_SNAPSHOT;
const subscribeNever = () => () => undefined;
const clientSnapshot = (): boolean => true;
const serverSnapshot = (): boolean => false;
const seedFromStore = (store: CargarPadronesRunStore): WizardState => initialWizardStateFor(store.getSnapshot());

const trimmedConnection = (connection: ClientConnection): ClientConnection => ({
  host: connection.host.trim(),
  port: connection.port.trim(),
  db_name: connection.db_name.trim(),
  user: connection.user.trim(),
  password: connection.password,
});

const setupOf = (state: WizardState): JobSetup => ({
  host: state.connection.host,
  port: state.connection.port,
  db_name: state.connection.db_name,
  user: state.connection.user,
  schema: state.schema,
  ruralTable: state.tables.rural,
  urbanoTable: state.tables.urbano,
  targetTable: state.tables.target,
  options: { ...state.options },
});

export const CargarPadronesWizard: React.FC = () => {
  const [runStore] = useState(getCargarPadronesRunStore);
  const [state, dispatch] = useReducer(wizardReducer, runStore, seedFromStore);
  const snapshot = useSyncExternalStore(runStore.subscribe, runStore.getSnapshot, getIdleSnapshot);
  const [profileStorage] = useState(() => createJobProfileStorage(browserJobProfileStorage()));
  const [storedProfiles, setStoredProfiles] = useState<JobProfile[]>(() => profileStorage.list());
  const isBrowserReady = useSyncExternalStore(subscribeNever, clientSnapshot, serverSnapshot);
  const profiles = isBrowserReady ? storedProfiles : NO_PROFILES;
  const [activeProfile, setActiveProfile] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [catalogFailures, setCatalogFailures] = useState<CatalogFailures>(emptyCatalogFailures);

  const isRunActive = snapshot.phase === "starting" || snapshot.phase === "running";

  useEffect(() => {
    if (!isRunActive) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const handle = setInterval(tick, ELAPSED_TICK_MS);
    return () => clearInterval(handle);
  }, [isRunActive]);

  const { connection } = state;
  const requestConnection = trimmedConnection(connection);
  const schema = state.schema.trim();
  const loadTables = useMemo(() => {
    const shared = buildSharedLoadTables(client, trimmedConnection(connection));
    return (listedSchema: string) =>
      shared(listedSchema).then((listing) => {
        setCatalogFailures((previous) =>
          clearCatalogFailure(previous, catalogKey(trimmedConnection(connection), listedSchema.trim())),
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

  const commitSchema = (next: string) => dispatch({ type: "schemaChanged", schema: next });

  const selectProfile = (name: string) => {
    setActiveProfile(name);
    const profile = profiles.find((candidate) => candidate.name === name);
    if (profile) {
      setCatalogFailures(emptyCatalogFailures());
      dispatch({ type: "loadSetup", setup: profile.setup });
    }
  };

  const saveProfile = (name: string) => {
    if (name.trim() === "") return;
    setStoredProfiles(profileStorage.save(name, setupOf(state)));
    setActiveProfile(name.trim());
  };

  const deleteProfile = (name: string) => {
    setStoredProfiles(profileStorage.remove(name));
    if (activeProfile === name) setActiveProfile("");
  };

  const startRun = (request: StartRequest) => {
    void runStore.start(request);
    dispatch({ type: "runStarted" });
  };

  const newRun = () => {
    runStore.reset();
    setCatalogFailures(emptyCatalogFailures());
    dispatch({ type: "reset" });
  };

  const renderCurrentStep = (): React.ReactNode => {
    switch (state.step) {
      case WizardStep.CONNECTION:
        return (
          <ConnectionStep
            connection={state.connection}
            profiles={profiles}
            activeProfile={activeProfile}
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
            onTableChange={(role, table, valid) => dispatch({ type: "tableChosen", role, table, valid })}
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
    onBack: def.id > FIRST_STEP_ID && def.id < RESULT_STEP_ID ? goBack : undefined,
  }));

  return (
    <WizardOrchestrator
      steps={steps}
      currentStep={currentId}
      onStepClick={(id) => dispatch({ type: "goTo", step: stepOfId(id) })}
    />
  );
};
