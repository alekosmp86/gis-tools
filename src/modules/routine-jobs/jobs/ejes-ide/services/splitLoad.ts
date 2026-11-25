import type { RunSession } from "../../cargar-padrones/types";
import { buildMoveSplitPointsSql } from "../domain/splitPlanSql";
import type { EjesLoadContext } from "../types";
import type { EjesLoadPlan } from "../domain/loadMapping";
import { assertWritten, writtenBy } from "./writeStatements";

/** The points of the applied splits move to their pieces, after the pieces are inserted and before the old sections are deleted. */
export async function writeSplitPoints(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  if (plan.splitPoints === 0) return;
  assertWritten("los puntos de acceso de las divisiones y reemplazos", await writtenBy(session, buildMoveSplitPointsSql(context)), plan.splitPoints);
}
