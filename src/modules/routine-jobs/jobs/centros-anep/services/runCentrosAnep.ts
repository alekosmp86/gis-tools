import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunProgress, RunSession } from "../../cargar-padrones/types";
import { assertConfirmedOrDryRun, throwIfIssues } from "../../shared/preflightAsserts";
import { withRunSession } from "../../shared/transaction";
import { CENTROS_CONFIRM_REQUIRED_MESSAGE, CENTROS_TABLE_ROLE } from "../constants";
import { stagingBlockersOf, stagingWarningsOf } from "../domain/blockers";
import { columnInfoOf } from "../domain/columnPlan";
import { CENTROS_STEP, plannedCentrosStepLabels } from "../domain/plannedSteps";
import { assertDistinctCentrosTables, labelOfCentrosTable, labelsOfCentrosTables } from "../domain/tableRoles";
import type { CentrosParams, CentrosResolved, CentrosResult } from "../types";
import { runCentrosTransaction, type CentrosOutcome } from "./centrosSteps";
import { centrosPrivilegeIssues } from "./preflight";
import { resolveCentrosLayouts } from "./resolveLayouts";

export const COMMIT_UNKNOWN_WARNING =
  "No se pudo confirmar el COMMIT: verifique la tabla final de centros ANEP antes de reintentar.";

interface PreparedRun {
  resolved: CentrosResolved;
  privilegeInfo: string[];
}

async function prepareRun(session: RunSession, params: CentrosParams, timer: StepTimer): Promise<PreparedRun> {
  const resolved = await timer.run(CENTROS_STEP.VALIDATE, () => resolveCentrosLayouts(session, params));
  const privilegeIssues = await timer.run(CENTROS_STEP.PRIVILEGES, () => centrosPrivilegeIssues(session, resolved));
  if (!params.dryRun) throwIfIssues([...resolved.schemaBlockers, ...privilegeIssues]);
  return { resolved, privilegeInfo: params.dryRun ? privilegeIssues : [] };
}

function buildResult(
  params: CentrosParams,
  prepared: PreparedRun,
  outcome: CentrosOutcome,
  stepTimings: CentrosResult["stepTimings"]
): CentrosResult {
  const { resolved, privilegeInfo } = prepared;
  const finalLabel = labelOfCentrosTable(params.tables, CENTROS_TABLE_ROLE.FINAL);
  return {
    dryRun: params.dryRun,
    targetModified: outcome.targetModified,
    outcomeUnknown: outcome.outcomeUnknown,
    staging: outcome.staging,
    comparison: outcome.comparison,
    blockers: params.dryRun ? [...resolved.schemaBlockers, ...stagingBlockersOf(outcome.staging)] : [],
    privilegeInfo,
    columnInfo: columnInfoOf(resolved.plan, finalLabel),
    copiedColumns: resolved.plan.pairs.map((pair) => pair.target),
    finalSrid: resolved.final.srid,
    deleted: outcome.deleted,
    inserted: outcome.inserted,
    ...(outcome.backup === undefined ? {} : { backup: outcome.backup }),
    warnings: [
      ...stagingWarningsOf(outcome.staging),
      ...(outcome.commitError === undefined ? [] : [COMMIT_UNKNOWN_WARNING]),
    ],
    tables: labelsOfCentrosTables(params.tables),
    stepTimings,
  };
}

async function runOnSession(
  session: RunSession,
  params: CentrosParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<CentrosResult> {
  const timer = createStepTimer({ now: deps.now, total: plannedCentrosStepLabels(params).length, onProgress });
  const prepared = await prepareRun(session, params, timer);
  const outcome = await runCentrosTransaction(session, params, prepared.resolved, timer);
  return buildResult(params, prepared, outcome, timer.timings);
}

export async function runCentrosAnep(
  params: CentrosParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<CentrosResult> {
  assertConfirmedOrDryRun(params, CENTROS_CONFIRM_REQUIRED_MESSAGE);
  assertDistinctCentrosTables(params);
  return withRunSession(params.config, deps, (session) => runOnSession(session, params, deps, onProgress));
}
