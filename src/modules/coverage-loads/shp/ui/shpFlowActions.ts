import type { Dispatch } from "react";
import type { ConnectionPayload } from "../../types";
import { ShpActionType, type ShpAction } from "../domain/shpFlowReducer";
import { pickResumableJob } from "../domain/shpResume";
import type { JobMode, JobStatus } from "../job/types.ts";
import { requestCancel, requestDiscard, requestJobs, requestPlan, requestStart, requestStatus, ShpRequestError } from "./shpClient";
import { ShpUploadAborted, uploadShp } from "./shpUpload";

type ShpDispatch = Dispatch<ShpAction>;

const UNKNOWN_FAILURE = "No se pudo completar la operación.";

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : UNKNOWN_FAILURE;
}

export async function runPlan(
  connection: ConnectionPayload,
  revision: number,
  jobId: string,
  dispatch: ShpDispatch
): Promise<void> {
  dispatch({ type: ShpActionType.PLAN_START });
  try {
    dispatch({ type: ShpActionType.PLAN_SUCCESS, plan: await requestPlan(connection, jobId), revision });
  } catch (failure: unknown) {
    dispatch({ type: ShpActionType.PLAN_FAILURE, message: toMessage(failure) });
  }
}

/** Uploads, then reviews the plan at once: the user has already chosen the file, so there is nothing to wait for. */
export async function runUpload(
  connection: ConnectionPayload,
  revision: number,
  file: File,
  signal: AbortSignal,
  dispatch: ShpDispatch
): Promise<void> {
  dispatch({ type: ShpActionType.UPLOAD_START });
  try {
    const job = await uploadShp(file, (percent) => dispatch({ type: ShpActionType.UPLOAD_PROGRESS, percent }), signal);
    dispatch({ type: ShpActionType.UPLOAD_SUCCESS, job });
    await runPlan(connection, revision, job.jobId, dispatch);
  } catch (failure: unknown) {
    const message = failure instanceof ShpUploadAborted ? null : toMessage(failure);
    dispatch({ type: ShpActionType.UPLOAD_FAILURE, message });
  }
}

export async function runStart(
  connection: ConnectionPayload,
  jobId: string,
  mode: JobMode,
  dispatch: ShpDispatch
): Promise<void> {
  dispatch({ type: ShpActionType.START_BEGIN });
  try {
    await requestStart(connection, jobId, mode);
    dispatch({ type: ShpActionType.START_SUCCESS });
  } catch (failure: unknown) {
    const plan = failure instanceof ShpRequestError ? failure.plan : undefined;
    dispatch({ type: ShpActionType.START_FAILURE, message: toMessage(failure), plan });
  }
}

/** A running job only gets a request to stop; the status poll shows when it actually did. */
export async function runCancel(jobId: string, dispatch: ShpDispatch): Promise<void> {
  try {
    await requestCancel(jobId);
  } catch (failure: unknown) {
    dispatch({ type: ShpActionType.ACTION_FAILED, message: toMessage(failure) });
  }
}

/** A READY job is cancelled first (only finished jobs can be discarded), then its folder is removed. */
export async function runDiscard(jobId: string, isFinished: boolean, dispatch: ShpDispatch): Promise<void> {
  try {
    if (!isFinished) await requestCancel(jobId);
    await requestDiscard(jobId);
    dispatch({ type: ShpActionType.RESTART });
  } catch (failure: unknown) {
    dispatch({ type: ShpActionType.ACTION_FAILED, message: toMessage(failure) });
  }
}

/** After a page reload: the newest job that is READY or still running, with its full status. */
async function findResumableStatus(): Promise<JobStatus | null> {
  const job = pickResumableJob(await requestJobs());
  return job === null ? null : (await requestStatus(job.jobId)).status;
}

export async function runResume(dispatch: ShpDispatch): Promise<void> {
  try {
    dispatch({ type: ShpActionType.RESUMED, status: await findResumableStatus() });
  } catch (failure: unknown) {
    dispatch({ type: ShpActionType.RESUME_FAILED, message: toMessage(failure) });
  }
}
