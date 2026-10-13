import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "../../shared/httpResponses";
import { JOB_MODE } from "../job/types.ts";
import type { JobMode } from "../job/types.ts";
import { evaluateJob } from "../services/evaluateJob";
import type { ShpContext } from "../services/shpContext";
import { startJob } from "../services/startJob";
import { readBodyWithConnection } from "./connectionBody";
import { JOB_ALREADY_STARTED_MESSAGE, JOB_NOT_FOUND_MESSAGE, JOB_NOT_READY_MESSAGE } from "./jobMessages";
import { jobIdFromBody } from "./requestJobId";

const CONFIRMATION_REQUIRED_MESSAGE = "Hay que confirmar la carga para escribir en la base de datos.";
const INVALID_MODE_MESSAGE = "El modo de carga no es válido.";
const REFUSED_MESSAGE = "La carga no puede iniciarse: revise los bloqueos y privilegios del plan.";
const START_FAILURE_MESSAGE = "No se pudo iniciar la carga.";

function readMode(value: unknown): JobMode | null {
  return value === JOB_MODE.LOAD || value === JOB_MODE.TEST ? value : null;
}

/** Re-runs the plan checks, takes the table lock, then spawns the detached job and returns at once. */
export function createStartHandler(context: ShpContext): ModuleEndpointHandler {
  return async (request) => {
    const parsed = await readBodyWithConnection(request);
    if (!parsed.ok) return parsed.response;
    const jobId = jobIdFromBody(parsed.body);
    if (!jobId.ok) return jobId.response;
    const mode = readMode(parsed.body.mode);
    if (mode === null) return failure(INVALID_MODE_MESSAGE, HTTP_STATUS.BAD_REQUEST);
    if (parsed.body.confirm !== true) return failure(CONFIRMATION_REQUIRED_MESSAGE, HTTP_STATUS.BAD_REQUEST);

    try {
      await context.sweeper.once();
      const evaluation = await evaluateJob(context, parsed.connection, jobId.jobId);
      if (evaluation.kind === "NOT_FOUND") return failure(JOB_NOT_FOUND_MESSAGE, HTTP_STATUS.NOT_FOUND);
      if (evaluation.kind === "NOT_READY") return failure(JOB_NOT_READY_MESSAGE(evaluation.state), HTTP_STATUS.CONFLICT);
      if (!evaluation.plan.canStart) return failure(REFUSED_MESSAGE, HTTP_STATUS.CONFLICT, { plan: evaluation.plan });

      const started = await startJob(context, evaluation.status, mode, parsed.connection);
      if (started.kind === "ALREADY_STARTED") return failure(JOB_ALREADY_STARTED_MESSAGE, HTTP_STATUS.CONFLICT);
      if (started.kind === "NOT_READY") return failure(JOB_NOT_READY_MESSAGE(started.state), HTTP_STATUS.CONFLICT);
      if (started.kind === "LOCK_HELD") return failure(started.message, HTTP_STATUS.CONFLICT, { plan: evaluation.plan });
      return jsonResponse({ success: true, jobId: jobId.jobId });
    } catch (error: unknown) {
      return toErrorResponse(error, parsed.connection.password, START_FAILURE_MESSAGE);
    }
  };
}
