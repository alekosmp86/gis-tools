import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunProgress, RunSession } from "../../cargar-padrones/types";
import { withRunSession, runTransaction, type TransactionMessages } from "../../shared/transaction";
import { EJES_ROLES, EJES_TABLE_ROLE, type EjesTableRole } from "../constants";
import { ejesBlockersOf } from "../domain/blockers";
import { ejesLoadContextOf } from "../domain/loadContext";
import { buildEjesNextStep } from "../domain/nextStep";
import { EJES_STEP, plannedEjesStepLabels } from "../domain/plannedSteps";
import { assertEjesRealRunEnabled } from "../domain/realRunSwitch";
import { assertDistinctEjesTables } from "../domain/tableRoles";
import type { EjesParams, EjesResolvedLayouts, EjesResult } from "../types";
import {
  assertEjesLoadReady,
  assertEjesReadable,
  assertEjesStagingReady,
  ejesAnalyzeWarnings,
  ejesWritePrivilegeInfo,
} from "./preflight";
import { readStagingAndAnalysis, type EjesAnalysisBody } from "./readEjesAnalysis";
import { resolveEjesLayouts } from "./resolveLayouts";
import { runEjesPersistTransaction } from "./writeEjesSteps";

const EJES_TRANSACTION: TransactionMessages = {
  jobLabel: "análisis de ejes de calles",
  untouched: "Ninguna tabla fue modificada.",
  unverified: "No se pudo cerrar la transacción de solo lectura: verifique la conexión.",
};

async function analyzeInReadOnlyTransaction(
  session: RunSession,
  params: EjesParams,
  resolved: EjesResolvedLayouts,
  timer: StepTimer
): Promise<EjesAnalysisBody> {
  const outcome = await runTransaction(
    session,
    {
      dryRun: true,
      readOnly: true,
      secret: params.config.password,
      timer,
      steps: { commit: EJES_STEP.ANALYZE, rollback: EJES_STEP.ANALYZE },
      messages: EJES_TRANSACTION,
    },
    () => readStagingAndAnalysis(session, resolved.layouts, timer)
  );
  return outcome.body;
}

const tableLabelsOf = (params: EjesParams): Record<EjesTableRole, string> =>
  Object.fromEntries(
    EJES_ROLES.map((role) => [role, buildQualifiedTableLabel(params.tables[role].schema, params.tables[role].table)])
  ) as Record<EjesTableRole, string>;

async function resolveAndValidate(session: RunSession, params: EjesParams, timer: StepTimer): Promise<EjesResolvedLayouts> {
  return timer.run(EJES_STEP.VALIDATE, async () => {
    const layouts = await resolveEjesLayouts(session, params);
    await assertEjesReadable(session, layouts.layouts);
    await assertEjesStagingReady(session, layouts.layouts);
    return layouts;
  });
}

async function dryRunPrivilegeInfo(session: RunSession, params: EjesParams, resolved: EjesResolvedLayouts): Promise<string[]> {
  const context = ejesLoadContextOf(resolved.layouts, params.tables, resolved.writeTargets);
  const privileges = await ejesWritePrivilegeInfo(session, resolved);
  return [...privileges, ...(await ejesAnalyzeWarnings(session, context))];
}

async function runAnalysisOnSession(session: RunSession, params: EjesParams, timer: StepTimer): Promise<EjesResult> {
  const resolved = await resolveAndValidate(session, params, timer);
  const privilegeInfo = await timer.run(EJES_STEP.PRIVILEGES, () => dryRunPrivilegeInfo(session, params, resolved));
  // One pg client: the analysis transaction starts after the privilege reads.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const { staging, analysis } = await analyzeInReadOnlyTransaction(session, params, resolved, timer);
  return {
    dryRun: true,
    targetModified: false,
    outcomeUnknown: false,
    staging,
    ...analysis,
    blockers: ejesBlockersOf(staging),
    privilegeInfo,
    tables: tableLabelsOf(params),
    stepTimings: timer.timings,
  };
}

async function runPersistOnSession(session: RunSession, params: EjesParams, timer: StepTimer): Promise<EjesResult> {
  const resolved = await resolveAndValidate(session, params, timer);
  const context = ejesLoadContextOf(resolved.layouts, params.tables, resolved.writeTargets);
  // Ordered: the privileges are checked before the transaction takes the lock.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const privilegeInfo = await timer.run(EJES_STEP.PRIVILEGES, () => assertEjesLoadReady(session, context));
  // Ordered: the write transaction runs after the privilege checks, on the same pg client.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const outcome = await runEjesPersistTransaction(session, params, context, timer);
  const { staging, analysis, load, targetModified, outcomeUnknown, commitError } = outcome;
  return {
    dryRun: false,
    targetModified,
    outcomeUnknown,
    ...(commitError === undefined ? {} : { commitError }),
    staging,
    ...analysis,
    blockers: [],
    privilegeInfo,
    tables: tableLabelsOf(params),
    stepTimings: timer.timings,
    load,
    ...(targetModified || outcomeUnknown
      ? { nextStep: buildEjesNextStep(params.tables[EJES_TABLE_ROLE.ROAD_SECTION], params.tables[EJES_TABLE_ROLE.STAGING]) }
      : {}),
  };
}

export async function runEjesCalles(
  params: EjesParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<EjesResult> {
  assertDistinctEjesTables(params);
  if (!params.dryRun) assertEjesRealRunEnabled();
  const timer = createStepTimer({ now: deps.now, total: plannedEjesStepLabels(params.dryRun).length, onProgress });
  return withRunSession(params.config, deps, (session) =>
    params.dryRun ? runAnalysisOnSession(session, params, timer) : runPersistOnSession(session, params, timer)
  );
}
