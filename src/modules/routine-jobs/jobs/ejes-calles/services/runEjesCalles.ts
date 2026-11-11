import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunProgress, RunSession } from "../../cargar-padrones/types";
import { withRunSession, runTransaction, type TransactionMessages } from "../../shared/transaction";
import { EJES_ROLES, type EjesTableRole } from "../constants";
import { buildEjesAnalysisSql } from "../domain/analysisSql";
import { ejesBlockersOf } from "../domain/blockers";
import { EJES_STEP, plannedEjesStepLabels } from "../domain/plannedSteps";
import { toEjesAnalysis, toEjesStagingReport } from "../domain/reportMapping";
import { buildStagingChecksSql } from "../domain/stagingSql";
import { assertDistinctEjesTables } from "../domain/tableRoles";
import type { EjesAnalysis, EjesParams, EjesResolvedLayouts, EjesResult, EjesStagingReport } from "../types";
import { assertEjesReadable, assertEjesStagingReady, ejesWritePrivilegeInfo } from "./preflight";
import { resolveEjesLayouts } from "./resolveLayouts";

const EJES_TRANSACTION: TransactionMessages = {
  jobLabel: "análisis de ejes de calles",
  untouched: "Ninguna tabla fue modificada.",
  unverified: "No se pudo cerrar la transacción de solo lectura: verifique la conexión.",
};

interface AnalysisBody {
  staging: EjesStagingReport;
  analysis: EjesAnalysis;
}

async function analyzeInReadOnlyTransaction(
  session: RunSession,
  params: EjesParams,
  resolved: EjesResolvedLayouts,
  timer: StepTimer
): Promise<AnalysisBody> {
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
    async () => {
      const staging = await timer.run(EJES_STEP.STAGING, async () =>
        toEjesStagingReport((await session.query(buildStagingChecksSql(resolved.layouts))).rows[0] ?? {})
      );
      const analysis = await timer.run(EJES_STEP.ANALYZE, async () =>
        toEjesAnalysis((await session.query(buildEjesAnalysisSql(resolved.layouts))).rows[0] ?? {})
      );
      return { staging, analysis };
    }
  );
  return outcome.body;
}

const tableLabelsOf = (params: EjesParams): Record<EjesTableRole, string> =>
  Object.fromEntries(
    EJES_ROLES.map((role) => [role, buildQualifiedTableLabel(params.tables[role].schema, params.tables[role].table)])
  ) as Record<EjesTableRole, string>;

async function runOnSession(
  session: RunSession,
  params: EjesParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<EjesResult> {
  const timer = createStepTimer({ now: deps.now, total: plannedEjesStepLabels().length, onProgress });
  const resolved = await timer.run(EJES_STEP.VALIDATE, async () => {
    const layouts = await resolveEjesLayouts(session, params);
    await assertEjesReadable(session, layouts.layouts);
    await assertEjesStagingReady(session, layouts.layouts);
    return layouts;
  });
  const privilegeInfo = await timer.run(EJES_STEP.PRIVILEGES, () => ejesWritePrivilegeInfo(session, resolved));
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

export async function runEjesCalles(
  params: EjesParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<EjesResult> {
  assertDistinctEjesTables(params);
  return withRunSession(params.config, deps, (session) => runOnSession(session, params, deps, onProgress));
}
