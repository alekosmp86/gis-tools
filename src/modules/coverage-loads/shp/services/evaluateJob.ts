import type { DbConnection } from "../../types";
import { readStatus } from "../job/statusFile.ts";
import { JOB_STATE } from "../job/types.ts";
import type { JobStatus } from "../job/types.ts";
import type { ShpPlan } from "../types";
import { buildShpPlan } from "./shpPlan";
import type { ShpContext } from "./shpContext";
import { viewTableLock } from "./tableLock";

export type JobEvaluation =
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "NOT_READY"; readonly state: string }
  | { readonly kind: "OK"; readonly status: JobStatus; readonly plan: ShpPlan };

/** The checks shared by plan and start: the job must be READY, then the database and lock are read. */
export async function evaluateJob(context: ShpContext, connection: DbConnection, jobId: string): Promise<JobEvaluation> {
  const status = await readStatus(context.rootDir, jobId);
  if (status === null) return { kind: "NOT_FOUND" };
  if (status.state !== JOB_STATE.READY) return { kind: "NOT_READY", state: status.state };

  const [inspection, lock] = await Promise.all([
    context.repository.inspect(connection, status.target.table),
    viewTableLock(context.rootDir, status.target.table, jobId, context.now()),
  ]);
  return { kind: "OK", status, plan: buildShpPlan(status, inspection, lock) };
}
