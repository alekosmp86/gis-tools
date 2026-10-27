import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import {
  buildSequenceRepairSql,
  runTransaction,
  type TransactionMessages,
  type TransactionOutcome,
} from "../../shared/transaction";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { UNIT_STEP } from "../domain/plannedSteps";
import { buildUnitTargetReport, toUnitApplyOutcome, toUnitClassification, toUnitSourceReport } from "../domain/reportMapping";
import { buildUnitSourceReportSql } from "../domain/sourceSql";
import { buildUnitApplySql, buildUnitClassifySql } from "../domain/targetSql";
import type { UnitApplyOutcome, UnitClassification, UnitLayouts, UnitOptions, UnitParams, UnitSourceReport, UnitTargetReport } from "../types";

export interface UnitWriteOutcome {
  source: UnitSourceReport;
  target: UnitTargetReport;
  targetModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
}

interface UnitTransactionBody {
  source: UnitSourceReport;
  target: UnitTargetReport;
}

const UNIT_TRANSACTION: TransactionMessages = {
  jobLabel: "actualización de unidades territoriales",
  untouched: "La tabla de unidades territoriales no fue modificada.",
  unverified: "No se pudo revertir la transacción: verifique la tabla de unidades territoriales.",
};

async function readSourceReport(session: RunSession, layouts: UnitLayouts): Promise<UnitSourceReport> {
  const result = await session.query(buildUnitSourceReportSql({ locality: layouts.locality }));
  return toUnitSourceReport(result.rows[0] ?? {});
}

async function readClassification(session: RunSession, layouts: UnitLayouts, options: UnitOptions): Promise<UnitClassification> {
  const result = await session.query(buildUnitClassifySql(layouts, options));
  return toUnitClassification(result.rows[0] ?? {});
}

async function readApply(session: RunSession, layouts: UnitLayouts, options: UnitOptions): Promise<UnitApplyOutcome> {
  const result = await session.query(buildUnitApplySql(layouts, options));
  return toUnitApplyOutcome(result.rows[0] ?? {});
}

function assertCountsMatch(target: WritableTargetLayout, classification: UnitClassification, apply: UnitApplyOutcome): void {
  const label = `${target.schema}.${target.table}`;
  if (apply.inserted !== classification.counts.inserted) {
    throw new Error(
      `Las unidades insertadas (${apply.inserted}) no coinciden con las nuevas del análisis (${classification.counts.inserted}) en ${label}.`
    );
  }
  if (apply.updated !== classification.counts.updates) {
    throw new Error(
      `Las unidades actualizadas (${apply.updated}) no coinciden con las esperadas (${classification.counts.updates}) en ${label}.`
    );
  }
}

async function runTransactionBody(
  session: RunSession,
  params: UnitParams,
  layouts: UnitLayouts,
  timer: StepTimer
): Promise<UnitTransactionBody> {
  const source = await timer.run(UNIT_STEP.RESOLVE, () => readSourceReport(session, layouts));
  // Ordered reads on the transaction's snapshot: the analysis follows the source report step.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const classification = await timer.run(UNIT_STEP.CLASSIFY, () => readClassification(session, layouts, params.options));
  // Ordered: the sequence is repaired after the analysis and before the insert of the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  await timer.run(UNIT_STEP.SEQUENCES, () => session.query(buildSequenceRepairSql(layouts.target)));
  const apply = await timer.run(UNIT_STEP.APPLY, () => readApply(session, layouts, params.options));
  assertCountsMatch(layouts.target, classification, apply);
  await timer.run(UNIT_STEP.ANALYZE, () => session.query(buildAnalyzeStatement(layouts.target.schema, layouts.target.table)));
  const target = await timer.run(UNIT_STEP.REPORT, () =>
    Promise.resolve(
      buildUnitTargetReport({
        target: layouts.target,
        classification,
        apply,
        updateGeometries: params.options.updateGeometries,
      })
    )
  );
  return { source, target };
}

export async function runUnitWriteTransaction(
  session: RunSession,
  params: UnitParams,
  layouts: UnitLayouts,
  timer: StepTimer
): Promise<UnitWriteOutcome> {
  const outcome: TransactionOutcome<UnitTransactionBody> = await runTransaction(
    session,
    {
      dryRun: params.dryRun,
      secret: params.config.password,
      timer,
      steps: { commit: UNIT_STEP.COMMIT, rollback: UNIT_STEP.ROLLBACK },
      messages: UNIT_TRANSACTION,
    },
    () => runTransactionBody(session, params, layouts, timer)
  );
  return {
    ...outcome.body,
    targetModified: outcome.targetsModified,
    outcomeUnknown: outcome.outcomeUnknown,
    commitError: outcome.commitError,
  };
}
