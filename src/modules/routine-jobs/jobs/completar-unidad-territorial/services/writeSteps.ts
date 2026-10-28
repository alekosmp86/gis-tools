import { buildAnalyzeStatement, buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import {
  buildSequenceRepairSql,
  runTransaction,
  type TransactionMessages,
  type TransactionOutcome,
} from "../../shared/transaction";
import { buildCompletarApplySql, buildCompletarClassifySql, buildCompletarRemainingSql } from "../domain/completarSql";
import { COMPLETAR_STEP } from "../domain/plannedSteps";
import {
  completarCountsOf,
  toCompletarApplyOutcome,
  toCompletarClassification,
  toRemainingCount,
} from "../domain/reportMapping";
import type {
  CompletarAmbiguousUnit,
  CompletarApplyOutcome,
  CompletarClassification,
  CompletarCounts,
  CompletarLayouts,
  CompletarLinkedUnit,
  CompletarParams,
} from "../types";

export interface CompletarWriteOutcome {
  counts: CompletarCounts;
  linkedList: CompletarLinkedUnit[];
  ambiguousSamples: CompletarAmbiguousUnit[];
  targetModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
}

type CompletarTransactionBody = Pick<CompletarWriteOutcome, "counts" | "linkedList" | "ambiguousSamples">;

const COMPLETAR_TRANSACTION: TransactionMessages = {
  jobLabel: "creación y enlace de direcciones maestras",
  untouched: "Las tablas de unidades territoriales y de direcciones maestras no fueron modificadas.",
  unverified:
    "No se pudo revertir la transacción: verifique las tablas de unidades territoriales y de direcciones maestras.",
};

async function readClassification(session: RunSession, layouts: CompletarLayouts): Promise<CompletarClassification> {
  const result = await session.query(buildCompletarClassifySql(layouts));
  return toCompletarClassification(result.rows[0] ?? {});
}

async function readApply(session: RunSession, layouts: CompletarLayouts): Promise<CompletarApplyOutcome> {
  const result = await session.query(buildCompletarApplySql(layouts));
  return toCompletarApplyOutcome(result.rows[0] ?? {});
}

async function readRemaining(session: RunSession, layouts: CompletarLayouts): Promise<number> {
  const result = await session.query(buildCompletarRemainingSql(layouts));
  return toRemainingCount(result.rows[0] ?? {});
}

const unitLabelOf = (layouts: CompletarLayouts): string => buildQualifiedTableLabel(layouts.unit.schema, layouts.unit.table);

function assertApplyMatches(
  layouts: CompletarLayouts,
  classification: CompletarClassification,
  apply: CompletarApplyOutcome
): void {
  const { counts } = classification;
  if (apply.created !== counts.created) {
    const label = buildQualifiedTableLabel(layouts.addressMaster.schema, layouts.addressMaster.table);
    throw new Error(
      `Los registros de dirección maestra creados (${apply.created}) no coinciden con los esperados (${counts.created}) en ${label}.`
    );
  }
  const expectedLinked = counts.withoutAddressMaster - counts.ambiguous;
  if (apply.linked !== expectedLinked) {
    throw new Error(
      `Las unidades enlazadas (${apply.linked}) no coinciden con las esperadas (${expectedLinked}) en ${unitLabelOf(layouts)}.`
    );
  }
}

function assertRemainingMatches(layouts: CompletarLayouts, classification: CompletarClassification, remaining: number): void {
  const { ambiguous } = classification.counts;
  if (remaining !== ambiguous) {
    throw new Error(
      `Las unidades sin dirección maestra después del enlace (${remaining}) no coinciden con las ambiguas (${ambiguous}) en ${unitLabelOf(layouts)}.`
    );
  }
}

async function analyzeTargets(session: RunSession, layouts: CompletarLayouts): Promise<void> {
  await session.query(buildAnalyzeStatement(layouts.unit.schema, layouts.unit.table));
  await session.query(buildAnalyzeStatement(layouts.addressMaster.schema, layouts.addressMaster.table));
}

async function runTransactionBody(
  session: RunSession,
  layouts: CompletarLayouts,
  timer: StepTimer
): Promise<CompletarTransactionBody> {
  const classification = await timer.run(COMPLETAR_STEP.CLASSIFY, () => readClassification(session, layouts));
  // Ordered: the sequence is repaired after the analysis and before the insert of the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  await timer.run(COMPLETAR_STEP.SEQUENCES, () => session.query(buildSequenceRepairSql(layouts.addressMaster)));
  const apply = await timer.run(COMPLETAR_STEP.APPLY, () => readApply(session, layouts));
  assertApplyMatches(layouts, classification, apply);
  const remaining = await timer.run(COMPLETAR_STEP.VERIFY, () => readRemaining(session, layouts));
  assertRemainingMatches(layouts, classification, remaining);
  await timer.run(COMPLETAR_STEP.ANALYZE, () => analyzeTargets(session, layouts));
  return timer.run(COMPLETAR_STEP.REPORT, () =>
    Promise.resolve({
      counts: completarCountsOf(classification, apply),
      linkedList: apply.linkedList,
      ambiguousSamples: classification.ambiguousSamples,
    })
  );
}

export async function runCompletarWriteTransaction(
  session: RunSession,
  params: CompletarParams,
  layouts: CompletarLayouts,
  timer: StepTimer
): Promise<CompletarWriteOutcome> {
  const outcome: TransactionOutcome<CompletarTransactionBody> = await runTransaction(
    session,
    {
      dryRun: params.dryRun,
      secret: params.config.password,
      timer,
      steps: { commit: COMPLETAR_STEP.COMMIT, rollback: COMPLETAR_STEP.ROLLBACK },
      messages: COMPLETAR_TRANSACTION,
    },
    () => runTransactionBody(session, layouts, timer)
  );
  return {
    ...outcome.body,
    targetModified: outcome.targetsModified,
    outcomeUnknown: outcome.outcomeUnknown,
    commitError: outcome.commitError,
  };
}
