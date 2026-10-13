import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "../../shared/httpResponses";
import { evaluateJob } from "../services/evaluateJob";
import type { ShpContext } from "../services/shpContext";
import { readBodyWithConnection } from "./connectionBody";
import { jobIdFromBody } from "./requestJobId";
import { JOB_NOT_FOUND_MESSAGE, JOB_NOT_READY_MESSAGE } from "./jobMessages";

const PLAN_FAILURE_MESSAGE = "No se pudo preparar el plan de carga.";

/** Read-only: it inspects the database and the lock folder and writes nothing. */
export function createPlanHandler(context: ShpContext): ModuleEndpointHandler {
  return async (request) => {
    const parsed = await readBodyWithConnection(request);
    if (!parsed.ok) return parsed.response;
    const jobId = jobIdFromBody(parsed.body);
    if (!jobId.ok) return jobId.response;

    try {
      await context.sweeper.once();
      const evaluation = await evaluateJob(context, parsed.connection, jobId.jobId);
      if (evaluation.kind === "NOT_FOUND") return failure(JOB_NOT_FOUND_MESSAGE, HTTP_STATUS.NOT_FOUND);
      if (evaluation.kind === "NOT_READY") return failure(JOB_NOT_READY_MESSAGE(evaluation.state), HTTP_STATUS.CONFLICT);
      return jsonResponse({ success: true, plan: evaluation.plan });
    } catch (error: unknown) {
      return toErrorResponse(error, parsed.connection.password, PLAN_FAILURE_MESSAGE);
    }
  };
}
