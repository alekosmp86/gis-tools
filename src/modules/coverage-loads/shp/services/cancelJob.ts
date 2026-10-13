import { writeFile } from "node:fs/promises";
import { jobPaths } from "../job/layout.ts";
import { cancelReadyStatus } from "../job/cleanup.ts";
import { releaseTableLock } from "../job/lock.ts";
import { readStatus } from "../job/statusFile.ts";
import { JOB_STATE, LIVE_STATES } from "../job/types.ts";
import { removeJobPayload } from "./jobStore";
import type { ShpContext } from "./shpContext";

export type CancelOutcome =
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "REFUSED"; readonly state: string }
  | { readonly kind: "CANCELLED" }
  | { readonly kind: "REQUESTED" };

/**
 * READY (not started): cancelled on the spot, source removed, lock freed. RUNNING: only a
 * `cancel.request` file is written; the job sees it, stops and finalises itself.
 */
export async function cancelJob(context: ShpContext, jobId: string): Promise<CancelOutcome> {
  const status = await readStatus(context.rootDir, jobId);
  if (status === null) return { kind: "NOT_FOUND" };

  if (LIVE_STATES.includes(status.state)) {
    // "wx": a repeated Cancel must not refresh the mtime the force-kill timer is measured from.
    await writeFile(jobPaths(context.rootDir, jobId).cancel, new Date(context.now()).toISOString(), { encoding: "utf8", flag: "wx" }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      }
    );
    return { kind: "REQUESTED" };
  }
  if (status.state !== JOB_STATE.READY) return { kind: "REFUSED", state: status.state };

  await cancelReadyStatus(context.rootDir, status, context.now());
  await removeJobPayload(context.rootDir, jobId);
  await releaseTableLock(context.rootDir, status.target.table, jobId);
  return { kind: "CANCELLED" };
}
