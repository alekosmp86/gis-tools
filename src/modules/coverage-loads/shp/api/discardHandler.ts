import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "../../shared/httpResponses";
import { discardJob } from "../job/cleanup.ts";
import type { ShpContext } from "../services/shpContext";
import { readBody } from "./connectionBody";
import { JOB_NOT_FOUND_MESSAGE } from "./jobMessages";
import { jobIdFromBody } from "./requestJobId";

const DISCARD_FAILURE_MESSAGE = "No se pudo descartar la carga.";
const NOT_TERMINAL_MESSAGE = "Solo se pueden descartar cargas terminadas; cancele la carga primero.";

export function createDiscardHandler(context: ShpContext): ModuleEndpointHandler {
  return async (request) => {
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const jobId = jobIdFromBody(parsed.body);
    if (!jobId.ok) return jobId.response;

    try {
      await context.sweeper.once();
      const result = await discardJob(context.rootDir, jobId.jobId);
      if (result.ok) return jsonResponse({ success: true, jobId: jobId.jobId });
      if (result.reason === "NOT_FOUND") return failure(JOB_NOT_FOUND_MESSAGE, HTTP_STATUS.NOT_FOUND);
      return failure(NOT_TERMINAL_MESSAGE, HTTP_STATUS.CONFLICT);
    } catch (error: unknown) {
      return toErrorResponse(error, "", DISCARD_FAILURE_MESSAGE);
    }
  };
}
