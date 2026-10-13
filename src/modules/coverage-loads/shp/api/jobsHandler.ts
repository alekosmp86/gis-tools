import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { jsonResponse, toErrorResponse } from "../../shared/httpResponses";
import { listJobSummaries } from "../services/jobSummary";
import type { ShpContext } from "../services/shpContext";

const JOBS_FAILURE_MESSAGE = "No se pudo listar las cargas.";

/** The endpoint a polling chip uses: one small read per job, plus the lazy cleanup sweep. */
export function createJobsHandler(context: ShpContext): ModuleEndpointHandler {
  return async () => {
    try {
      await context.sweeper.sweep();
      return jsonResponse({ success: true, jobs: await listJobSummaries(context) });
    } catch (error: unknown) {
      return toErrorResponse(error, "", JOBS_FAILURE_MESSAGE);
    }
  };
}
