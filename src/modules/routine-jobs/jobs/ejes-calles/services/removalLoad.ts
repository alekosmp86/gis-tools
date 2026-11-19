import type { RunSession } from "../../cargar-padrones/types";
import { numberOf } from "../../shared/rowMapping";
import { buildAcceptedTablesSql, buildInvalidChoiceRefsSql, buildInvalidTwinPickRefsSql, buildMissingAcceptedSql } from "../domain/acceptedSql";
import { buildDeleteMastersSql, buildDeleteSectionsSql } from "../domain/loadWriteSql";
import type { EjesLoadPlan } from "../domain/loadMapping";
import {
  buildDeleteTableSql,
  buildHoldGroupCopiesSql,
  buildMergePlanSql,
  buildMissingMoveTargetsSql,
  buildMoveTableSql,
  buildPlainPlanSql,
  buildSkippedTableSql,
} from "../domain/removalPlanSql";
import { buildSplitFinalSql, buildSplitPlanSql } from "../domain/splitPlanSql";
import type { EjesAccepted, EjesLayouts, EjesLoadContext } from "../types";
import {
  ANALYSIS_CHANGED_MESSAGE,
  assertWritten,
  choiceNotApplicableOf,
  moveTargetMissingOf,
  runInOrder,
  twinPickNotApplicableOf,
  writtenBy,
} from "./writeStatements";

/** The accepted keys and choices become temp tables; every key must name a split, merge or plain removal of this transaction's analysis. */
export async function prepareAccepted(session: RunSession, accepted: EjesAccepted): Promise<void> {
  await runInOrder(session, buildAcceptedTablesSql(accepted));
  const missing = numberOf((await session.query(buildMissingAcceptedSql())).rows[0]?.missing);
  if (missing > 0) throw new Error(ANALYSIS_CHANGED_MESSAGE);
}

/** Fail closed (ET-28): a pick that names no copy of the staging aborts the load before any write. Runs after `prepareAccepted`. */
export async function assertTwinPicksExist(session: RunSession, layouts: EjesLayouts): Promise<void> {
  const invalidRefs = (await session.query(buildInvalidTwinPickRefsSql(layouts))).rows.map((row) => String(row.ref));
  if (invalidRefs.length > 0) throw new Error(twinPickNotApplicableOf(invalidRefs));
}

/**
 * The plans count the kept copies of each new `reftramo` before the held groups' copies leave the selection. The merge and split plans
 * come before the plain plan, which reads them (a twin winner held as a piece or a merge `reftramo`), then the split points, the holds,
 * the delete list and the skipped list, which read them. The choices are checked against the split plan (a choice for an automatic
 * point or for a held split aborts the load), before any write.
 */
export async function createRemovalPlans(session: RunSession, context: EjesLoadContext): Promise<void> {
  await runInOrder(session, [buildMergePlanSql(), buildSplitPlanSql(), buildPlainPlanSql()]);
  const invalidRefs = (await session.query(buildInvalidChoiceRefsSql())).rows.map((row) => String(row.old_ref));
  if (invalidRefs.length > 0) throw new Error(choiceNotApplicableOf(invalidRefs));
  await runInOrder(session, [
    buildSplitFinalSql(context),
    buildHoldGroupCopiesSql(),
    buildMoveTableSql(),
    buildDeleteTableSql(context.layouts),
    buildSkippedTableSql(),
  ]);
}

/** Fail closed: a point move whose target `reftramo` no copy and no section holds would orphan the points. Runs after `createRemovalPlans`, before any write or backup. */
export async function assertMoveTargetsExist(session: RunSession, layouts: EjesLayouts): Promise<void> {
  const missing = (await session.query(buildMissingMoveTargetsSql(layouts))).rows.map(
    (row) => `${String(row.new_ref)} (de ${String(row.old_ref)})`
  );
  if (missing.length > 0) throw new Error(moveTargetMissingOf(missing));
}

/** The sections of the applied merges, splits and removals go only after their points moved; their masters go after their sections. */
export async function writeRemovals(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  if (plan.counts.deleted === 0) return;
  assertWritten("los tramos quitados", await writtenBy(session, buildDeleteSectionsSql(context)), plan.counts.deleted);
  if (plan.deletedMasters === 0) return;
  // Ordered: the masters go after the sections that held them.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  assertWritten("las direcciones maestras quitadas", await writtenBy(session, buildDeleteMastersSql(context)), plan.deletedMasters);
}
