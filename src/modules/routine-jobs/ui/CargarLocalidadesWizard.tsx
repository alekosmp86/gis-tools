"use client";

import React, { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import type { ResolvedColumn } from "@/core/types/tableCatalog";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import { isConnectionFailure } from "@/ui-kit/components/tableSelectorLogic";
import type { WizardStepDef } from "@/ui-kit/types/ui";
import type { LocalidadesTableRole } from "../jobs/cargar-localidades/constants";
import {
  blockingReason,
  canRunNow,
  excludedTablesOf,
  initialWizardStateFor,
  LocalidadesStep,
  localidadesWizardReducer,
  runBlockedReason,
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
} from "./cargarLocalidadesRunStore";
import type { ClientConnection, LocalidadesStartRequest, StagingSelection } from "./clientTypes";
import { trimConnection } from "./connectionProfiles";
import { RunPhase } from "./jobRunStore";
import { createRoutineJobsClient, RoutineJobsApiError } from "./routineJobsClient";
import { catalogKey } from "./schemaDraft";
import { buildSharedLoadTables, firstCatalogError } from "./sharedCatalog";
import {
  clearCatalogFailure,
  currentCatalogError,
  emptyCatalogFailures,
  recordCatalogFailure,
  type CatalogFailures,
} from "./catalogErrors";
import { LocalidadesTablesStep } from "./steps/LocalidadesTablesStep";
import { LocalidadesOptionsStep } from "./steps/LocalidadesOptionsStep";
import { LocalidadesReviewStep } from "./steps/LocalidadesReviewStep";
import { LocalidadesRunStep } from "./steps/LocalidadesRunStep";
import { LocalidadesReportStep } from "./steps/LocalidadesReportStep";

const IDLE_SNAPSHOT: CargarLocalidadesRunSnapshot = { phase: RunPhase.IDLE };
const ELAPSED_TICK_MS = 1000;
const TABLES_STEP_ID = localidadesStepIdOf(LocalidadesStep.TABLES);
const OPTIONS_STEP_ID = localidadesStepIdOf(LocalidadesStep.OPTIONS);
const REVIEW_STEP_ID = localidadesStepIdOf(LocalidadesStep.REVIEW);
const DRY_RUN = { dryRun: true };
const REAL_RUN = { dryRun: false };
const client = createRoutineJobsClient();
const getIdleSnapshot = (): CargarLocalidadesRunSnapshot => IDLE_SNAPSHOT;

const catalogKeyOf = (connection: ClientConnection, schema: string): string =>
  catalogKey(trimConnection(connection), schema.trim());

const connectionFailureOf = (error: unknown): string | null =>
  error instanceof RoutineJobsApiError && isConnectionFailure(error.status) ? error.message : null;

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
  const loadTables = useMemo(() => {
    const shared = buildSharedLoadTables(client, trimConnection(connection));
    return (schema: string) => {
      const key = catalogKeyOf(connection, schema);
      return shared(schema.trim()).then(
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

  const checkColumns = (role: LocalidadesTableRole, schema: string, table: string): Promise<ResolvedColumn[]> =>
    client.listColumns(trimConnection(connection), schema, table, role);

  const catalogError = firstCatalogError([
    currentCatalogError(catalogFailures, catalogKeyOf(connection, state.stagingSchema)),
    currentCatalogError(catalogFailures, catalogKeyOf(connection, state.provinceSchema)),
    ...state.targets.map((target) => currentCatalogError(catalogFailures, catalogKeyOf(connection, target.schema))),
  ]);

  const startRun = (request: LocalidadesStartRequest) => {
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
            onTargetSchemaChange={(index, schema) => dispatch({ type: "targetSchemaChanged", index, schema })}
            onTargetTableChange={(index, table, valid) => dispatch({ type: "targetChosen", index, table, valid })}
            onTargetAdd={() => dispatch({ type: "targetAdded" })}
            onTargetRemove={(index) => dispatch({ type: "targetRemoved", index })}
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
