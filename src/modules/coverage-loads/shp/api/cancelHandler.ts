import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "../../shared/httpResponses";
import { cancelJob } from "../services/cancelJob";
import type { ShpContext } from "../services/shpContext";
import { readBody } from "./connectionBody";
import { JOB_NOT_FOUND_MESSAGE } from "./jobMessages";
import { jobIdFromBody } from "./requestJobId";

const CANCEL_FAILURE_MESSAGE = "No se pudo cancelar la carga.";
const CANNOT_CANCEL_MESSAGE = (state: string) => `La carga no se puede cancelar en estado ${state}.`;

/** No credentials: a running job is asked to stop through a file; a not-started one is cancelled here. */
export function createCancelHandler(context: ShpContext): ModuleEndpointHandler {
  return async (request) => {
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const jobId = jobIdFromBody(parsed.body);
    if (!jobId.ok) return jobId.response;

    try {
      await context.sweeper.once();
      const outcome = await cancelJob(context, jobId.jobId);
      if (outcome.kind === "NOT_FOUND") return failure(JOB_NOT_FOUND_MESSAGE, HTTP_STATUS.NOT_FOUND);
      if (outcome.kind === "REFUSED") return failure(CANNOT_CANCEL_MESSAGE(outcome.state), HTTP_STATUS.CONFLICT);
      return jsonResponse({ success: true, jobId: jobId.jobId, outcome: outcome.kind });
    } catch (error: unknown) {
      return toErrorResponse(error, "", CANCEL_FAILURE_MESSAGE);
    }
  };
}
