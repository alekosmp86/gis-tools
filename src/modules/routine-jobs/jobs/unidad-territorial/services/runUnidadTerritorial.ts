import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunProgress, RunSession } from "../../cargar-padrones/types";
import { ADDRESS_MASTER_TOGGLE_MISMATCH_MESSAGE } from "../../shared/addressMasterLinkSpec";
import { assertConfirmedOrDryRun, assertSourceTablesReady } from "../../shared/preflightAsserts";
import { withRunSession } from "../../shared/transaction";
import { plannedUnitStepLabels, UNIT_STEP, type UnitPlannedStepsInput } from "../domain/plannedSteps";
import { assertDistinctUnitTables, linksAddressMasterOf } from "../domain/tableRoles";
import { buildUnitWarnings } from "../domain/warnings";
import type { UnitParams, UnitResult } from "../types";
import { assertUnitTargetsReady, CONFIRM_REQUIRED_MESSAGE, sourceTablesSpecOf } from "./preflight";
import { resolveUnitLayouts } from "./resolveLayouts";
import { runUnitWriteTransaction, type UnitWriteOutcome } from "./writeSteps";

function buildResult(params: UnitParams, outcome: UnitWriteOutcome, stepTimings: UnitResult["stepTimings"]): UnitResult {
  const { source, target, addressMaster } = outcome;
  return {
    dryRun: params.dryRun,
    targetModified: outcome.targetModified,
    outcomeUnknown: outcome.outcomeUnknown,
    totals: source.totals,
    skipped: { ...source.skippedByReason, samples: source.skippedSamples },
    target,
    ...(addressMaster === undefined ? {} : { addressMaster }),
    warnings: buildUnitWarnings({
      dryRun: params.dryRun,
      options: params.options,
      totals: source.totals,
      target,
      addressMaster,
      commitError: outcome.commitError,
    }),
    stepTimings,
  };
}

const plannedInputOf = (params: UnitParams): UnitPlannedStepsInput => ({
  dryRun: params.dryRun,
  linkAddressMaster: linksAddressMasterOf(params),
});

async function runOnSession(
  session: RunSession,
  params: UnitParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<UnitResult> {
  const timer: StepTimer = createStepTimer({
    now: deps.now,
    total: plannedUnitStepLabels(plannedInputOf(params)).length,
    onProgress,
  });
  const layouts = await timer.run(UNIT_STEP.VALIDATE, () => resolveUnitLayouts(session, params));
  await timer.run(UNIT_STEP.TARGET, () => assertUnitTargetsReady(session, layouts));
  await timer.run(UNIT_STEP.COUNT, () => assertSourceTablesReady(session, sourceTablesSpecOf(layouts)));
  const outcome = await runUnitWriteTransaction(session, params, layouts, timer);
  return buildResult(params, outcome, timer.timings);
}

function assertLinkMatchesAddressMasterTable(params: UnitParams): void {
  if (linksAddressMasterOf(params) !== (params.addressMasterTable !== undefined)) {
    throw new Error(ADDRESS_MASTER_TOGGLE_MISMATCH_MESSAGE);
  }
}

export async function runUnidadTerritorial(
  params: UnitParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<UnitResult> {
  assertLinkMatchesAddressMasterTable(params);
  assertConfirmedOrDryRun(params, CONFIRM_REQUIRED_MESSAGE);
  assertDistinctUnitTables(params);
  return withRunSession(params.config, deps, (session) => runOnSession(session, params, deps, onProgress));
}
