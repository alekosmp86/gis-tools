import { HTTP_STATUS, failure } from "../../shared/httpResponses";
import type { ParsedBody } from "../../shared/requestReaders";
import { JOB_ID_FIELD } from "../constants";
import { isValidJobId } from "../job/layout.ts";

const INVALID_JOB_ID_MESSAGE = "Identificador de carga inválido.";

export type JobIdResult = { readonly ok: true; readonly jobId: string } | { readonly ok: false; readonly response: Response };

function checked(value: unknown): JobIdResult {
  return isValidJobId(value)
    ? { ok: true, jobId: value }
    : { ok: false, response: failure(INVALID_JOB_ID_MESSAGE, HTTP_STATUS.BAD_REQUEST) };
}

export function jobIdFromQuery(request: Request): JobIdResult {
  return checked(new URL(request.url).searchParams.get(JOB_ID_FIELD));
}

export function jobIdFromBody(body: ParsedBody): JobIdResult {
  return checked(body[JOB_ID_FIELD]);
}
