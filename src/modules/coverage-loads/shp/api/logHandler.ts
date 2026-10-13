import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { failure, HTTP_STATUS, toErrorResponse } from "../../shared/httpResponses";
import { LOG_CONTENT_TYPE, LOG_TAIL_DEFAULT_LINES, LOG_TAIL_MAX_LINES, TAIL_FIELD } from "../constants";
import { jobPaths } from "../job/layout.ts";
import { readStatus } from "../job/statusFile.ts";
import { readLogTail } from "../services/logTail";
import type { ShpContext } from "../services/shpContext";
import { jobIdFromQuery } from "./requestJobId";

const LOG_FAILURE_MESSAGE = "No se pudo leer el registro de la carga.";
const LOG_NOT_FOUND_MESSAGE = "La carga no tiene registro todavía.";
const SHORT_ID_LENGTH = 8;

function readTail(request: Request): number {
  const raw = new URL(request.url).searchParams.get(TAIL_FIELD);
  const parsed = raw !== null && /^\d+$/.test(raw) ? Number(raw) : LOG_TAIL_DEFAULT_LINES;
  return Math.min(Math.max(parsed, 1), LOG_TAIL_MAX_LINES);
}

/** The last `tail` lines of job.log (read from its last bytes only), as a text attachment. */
export function createLogHandler(context: ShpContext): ModuleEndpointHandler {
  return async (request) => {
    const jobId = jobIdFromQuery(request);
    if (!jobId.ok) return jobId.response;
    try {
      await context.sweeper.once();
      const status = await readStatus(context.rootDir, jobId.jobId);
      const text = status === null ? null : await readLogTail(jobPaths(context.rootDir, jobId.jobId).log, readTail(request));
      if (status === null || text === null) return failure(LOG_NOT_FOUND_MESSAGE, HTTP_STATUS.NOT_FOUND);

      const fileName = `cargar_${status.target.table}_${jobId.jobId.slice(0, SHORT_ID_LENGTH)}.log`;
      return new Response(text, {
        status: HTTP_STATUS.OK,
        headers: {
          "Content-Type": LOG_CONTENT_TYPE,
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error: unknown) {
      return toErrorResponse(error, "", LOG_FAILURE_MESSAGE);
    }
  };
}
