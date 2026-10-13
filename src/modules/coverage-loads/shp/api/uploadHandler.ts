import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "../../shared/httpResponses";
import { receiveUpload } from "../services/receiveUpload";
import type { ShpContext } from "../services/shpContext";
import { readUploadHeaders } from "./uploadHeaders";

const UPLOAD_FAILURE_MESSAGE = "No se pudo recibir el archivo.";

/** The body is never buffered: it is handed to the disk writer as a stream. */
export function createUploadHandler(context: ShpContext): ModuleEndpointHandler {
  return async (request) => {
    try {
      await context.sweeper.once();
      const headers = readUploadHeaders(request);
      if (!headers.ok) return failure(headers.error, headers.tooLarge ? HTTP_STATUS.PAYLOAD_TOO_LARGE : HTTP_STATUS.BAD_REQUEST);

      const outcome = await receiveUpload(context, {
        body: request.body as ReadableStream<Uint8Array>,
        signal: request.signal,
        ...headers.value,
      });
      if (!outcome.ok) return failure(outcome.message, outcome.status);
      return jsonResponse({ success: true, jobId: outcome.jobId, target: outcome.target, sizeBytes: outcome.sizeBytes });
    } catch (error: unknown) {
      return toErrorResponse(error, "", UPLOAD_FAILURE_MESSAGE);
    }
  };
}
