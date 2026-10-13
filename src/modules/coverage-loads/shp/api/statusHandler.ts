import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "../../shared/httpResponses";
import { readStatus } from "../job/statusFile.ts";
import { isStale } from "../services/jobSummary";
import type { ShpContext } from "../services/shpContext";
import { JOB_NOT_FOUND_MESSAGE } from "./jobMessages";
import { jobIdFromQuery } from "./requestJobId";

const STATUS_FAILURE_MESSAGE = "No se pudo leer el estado de la carga.";

/** `stale` is true when the job looks dead (no pid, old heartbeat) but the sweep has not closed it yet. */
export function createStatusHandler(context: ShpContext): ModuleEndpointHandler {
  return async (request) => {
    const jobId = jobIdFromQuery(request);
    if (!jobId.ok) return jobId.response;
    try {
      await context.sweeper.once();
      const status = await readStatus(context.rootDir, jobId.jobId);
      if (status === null) return failure(JOB_NOT_FOUND_MESSAGE, HTTP_STATUS.NOT_FOUND);
      return jsonResponse({ success: true, status, stale: isStale(context, status) });
    } catch (error: unknown) {
      return toErrorResponse(error, "", STATUS_FAILURE_MESSAGE);
    }
  };
}
