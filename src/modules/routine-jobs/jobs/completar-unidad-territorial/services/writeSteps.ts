import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import { runAddressMasterLinkPass, type AddressMasterPassBody } from "../../shared/addressMasterLinkPass";
import { UNIT_SUBJECT_SPEC } from "../../shared/addressMasterLinkSpec";
import { buildSequenceRepairSql, runTransaction, type TransactionMessages, type TransactionOutcome } from "../../shared/transaction";
import { COMPLETAR_STEP } from "../domain/plannedSteps";
import type { CompletarCounts, CompletarLayouts, CompletarLinkedUnit, CompletarAmbiguousUnit, CompletarParams } from "../types";

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

const UNIT_PASS_STEPS = {
  classify: COMPLETAR_STEP.CLASSIFY,
  apply: COMPLETAR_STEP.APPLY,
  verify: COMPLETAR_STEP.VERIFY,
};

async function analyzeTargets(session: RunSession, layouts: CompletarLayouts): Promise<void> {
  await session.query(buildAnalyzeStatement(layouts.unit.schema, layouts.unit.table));
  await session.query(buildAnalyzeStatement(layouts.addressMaster.schema, layouts.addressMaster.table));
}

async function runTransactionBody(
  session: RunSession,
  layouts: CompletarLayouts,
  timer: StepTimer
): Promise<CompletarTransactionBody> {
  // Ordered: the sequence is repaired before the first insert of the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  await timer.run(COMPLETAR_STEP.SEQUENCES, () => session.query(buildSequenceRepairSql(layouts.addressMaster)));
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const pass: AddressMasterPassBody = await runAddressMasterLinkPass(
    session,
    { subject: layouts.unit, addressMaster: layouts.addressMaster },
    UNIT_SUBJECT_SPEC,
    UNIT_PASS_STEPS,
    timer
  );
  await timer.run(COMPLETAR_STEP.ANALYZE, () => analyzeTargets(session, layouts));
  return timer.run(COMPLETAR_STEP.REPORT, () =>
    Promise.resolve({ counts: pass.counts, linkedList: pass.linkedList, ambiguousSamples: pass.ambiguousSamples })
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
