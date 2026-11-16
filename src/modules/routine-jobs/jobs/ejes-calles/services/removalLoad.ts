import type { RunSession } from "../../cargar-padrones/types";
import { numberOf } from "../../shared/rowMapping";
import { buildAcceptedTablesSql, buildMissingAcceptedSql } from "../domain/acceptedSql";
import { buildDeleteMastersSql, buildDeleteSectionsSql } from "../domain/loadWriteSql";
import type { EjesLoadPlan } from "../domain/loadMapping";
import {
  buildDeleteTableSql,
  buildHoldGroupCopiesSql,
  buildMergePlanSql,
  buildMoveTableSql,
  buildPlainPlanSql,
  buildSkippedTableSql,
} from "../domain/removalPlanSql";
import type { EjesAccepted, EjesLoadContext } from "../types";
import { ANALYSIS_CHANGED_MESSAGE, assertWritten, runInOrder, writtenBy } from "./writeStatements";

/** The accepted keys become temp tables; every one must name a merge or a plain removal of this transaction's analysis. */
export async function prepareAccepted(session: RunSession, accepted: EjesAccepted): Promise<void> {
  await runInOrder(session, buildAcceptedTablesSql(accepted));
  const missing = numberOf((await session.query(buildMissingAcceptedSql())).rows[0]?.missing);
  if (missing > 0) throw new Error(ANALYSIS_CHANGED_MESSAGE);
}

/** The plans count the kept copies of each new `reftramo` before the held groups' copies leave the selection. */
export async function createRemovalPlans(session: RunSession, context: EjesLoadContext): Promise<void> {
  await runInOrder(session, [
    buildMergePlanSql(),
    buildPlainPlanSql(),
    buildHoldGroupCopiesSql(),
    buildMoveTableSql(),
    buildDeleteTableSql(context.layouts),
    buildSkippedTableSql(),
  ]);
}

/** The sections of the applied merges and removals go only after their points moved; their masters go after their sections. */
export async function writeRemovals(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  if (plan.counts.deleted === 0) return;
  assertWritten("los tramos quitados", await writtenBy(session, buildDeleteSectionsSql(context)), plan.counts.deleted);
  if (plan.deletedMasters === 0) return;
  // Ordered: the masters go after the sections that held them.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  assertWritten("las direcciones maestras quitadas", await writtenBy(session, buildDeleteMastersSql(context)), plan.deletedMasters);
}
