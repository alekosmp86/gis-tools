import type { ShpPlan } from "../types";

/**
 * Browser-side plumbing for the SHP endpoints. Credentials travel in JSON request bodies only and
 * are never logged. Each call checks `response.ok` first: an error page is HTML, and parsing it
 * as JSON would hide the real failure. Server messages are Spanish and are shown as they come.
 */

export const API_BASE = "/api/m/coverage-loads/shp";

const JSON_CONTENT_TYPE = "application/json";
const NETWORK_FAILURE_PREFIX = "No se pudo contactar con el servidor";

interface ErrorPayload {
  readonly error?: string;
  readonly plan?: ShpPlan;
}

/** A failed request. `plan` is present when the server refused a start (409) and sends the plan it computed. */
export class ShpRequestError extends Error {
  readonly plan?: ShpPlan;
  readonly httpStatus?: number;

  constructor(message: string, plan?: ShpPlan, httpStatus?: number) {
    super(message);
    this.name = "ShpRequestError";
    this.plan = plan;
    this.httpStatus = httpStatus;
  }
}

export function toNetworkError(failure: unknown): ShpRequestError {
  const detail = failure instanceof Error ? `: ${failure.message}` : ".";
  return new ShpRequestError(`${NETWORK_FAILURE_PREFIX}${detail}`);
}

async function readFailure(response: Response, context: string): Promise<ShpRequestError> {
  const fallback = `${context} (HTTP ${response.status}).`;
  try {
    const payload = (await response.json()) as ErrorPayload;
    return new ShpRequestError(payload.error ?? fallback, payload.plan, response.status);
  } catch {
    return new ShpRequestError(fallback, undefined, response.status);
  }
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}/${path}`, init);
  } catch (failure: unknown) {
    throw toNetworkError(failure);
  }
}

export async function postJson<T>(path: string, body: unknown, context: string): Promise<T> {
  const response = await send(path, {
    method: "POST",
    headers: { "Content-Type": JSON_CONTENT_TYPE },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readFailure(response, context);
  return (await response.json()) as T;
}

export async function getResponse(path: string, context: string): Promise<Response> {
  const response = await send(path, { method: "GET", cache: "no-store" });
  if (!response.ok) throw await readFailure(response, context);
  return response;
}
