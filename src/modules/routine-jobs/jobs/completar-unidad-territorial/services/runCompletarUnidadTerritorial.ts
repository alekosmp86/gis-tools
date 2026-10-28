import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunProgress, RunSession } from "../../cargar-padrones/types";
import { assertConfirmedOrDryRun } from "../../shared/preflightAsserts";
import { withRunSession } from "../../shared/transaction";
import { COMPLETAR_STEP, plannedCompletarStepLabels } from "../domain/plannedSteps";
import { assertDistinctCompletarTables } from "../domain/tableRoles";
import { buildCompletarWarnings } from "../domain/warnings";
import type { CompletarParams, CompletarResult } from "../types";
import { assertTargetsReady, CONFIRM_REQUIRED_MESSAGE } from "./preflight";
import { resolveCompletarLayouts } from "./resolveLayouts";
import { runCompletarWriteTransaction, type CompletarWriteOutcome } from "./writeSteps";

function buildResult(
  params: CompletarParams,
  outcome: CompletarWriteOutcome,
  stepTimings: CompletarResult["stepTimings"]
): CompletarResult {
  const unitTable = buildQualifiedTableLabel(params.unitSchema, params.unitTable);
  return {
    dryRun: params.dryRun,
    targetModified: outcome.targetModified,
    outcomeUnknown: outcome.outcomeUnknown,
    unitSchema: params.unitSchema,
    unitTable,
    addressMasterTable: buildQualifiedTableLabel(params.addressMasterSchema, params.addressMasterTable),
    counts: outcome.counts,
    linkedList: outcome.linkedList,
    ambiguousSamples: outcome.ambiguousSamples,
    warnings: buildCompletarWarnings({
      dryRun: params.dryRun,
      unitTable,
      counts: outcome.counts,
      commitError: outcome.commitError,
    }),
    stepTimings,
  };
}

async function runOnSession(
  session: RunSession,
  params: CompletarParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<CompletarResult> {
  const timer: StepTimer = createStepTimer({
    now: deps.now,
    total: plannedCompletarStepLabels({ dryRun: params.dryRun }).length,
    onProgress,
  });
  const layouts = await timer.run(COMPLETAR_STEP.VALIDATE, () => resolveCompletarLayouts(session, params));
  await timer.run(COMPLETAR_STEP.TARGETS, () => assertTargetsReady(session, layouts));
  const outcome = await runCompletarWriteTransaction(session, params, layouts, timer);
  return buildResult(params, outcome, timer.timings);
}

export async function runCompletarUnidadTerritorial(
  params: CompletarParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<CompletarResult> {
  assertConfirmedOrDryRun(params, CONFIRM_REQUIRED_MESSAGE);
  assertDistinctCompletarTables(params);
  return withRunSession(params.config, deps, (session) => runOnSession(session, params, deps, onProgress));
}
