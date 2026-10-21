import type { ConnectionPayload } from "../../types";
import type { SigraLayerId } from "../constants";
import type {
  LoadLayerOptions,
  SigraErrorResponse,
  SigraLoadAnswer,
  SigraLoadResponse,
  SigraPlan,
  SigraPlanResponse,
} from "../types";

/**
 * Browser-side access to the SIGRA layers endpoints. Credentials travel in the request body only
 * and never reach a message. Each call checks `response.ok` first: an error page is HTML, and
 * parsing it as JSON hides the real failure.
 */

const API_BASE = "/api/m/coverage-loads/sigra-layers";
const CONTENT_TYPE_HEADER = "Content-Type";
const JSON_CONTENT_TYPE = "application/json";

const NETWORK_FAILURE_PREFIX = "No se pudo contactar con el servidor";
const PLAN_FAILURE = "No se pudo consultar el estado de las capas";
const LOAD_FAILURE = "No se pudo completar la carga de capas";

/** A failed request. `plan` is present when the server refused a load (409) and sends the plan it computed. */
export class SigraRequestError extends Error {
  readonly plan?: SigraPlan;

  constructor(message: string, plan?: SigraPlan) {
    super(message);
    this.name = "SigraRequestError";
    this.plan = plan;
  }
}

async function post(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers: { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE },
      body: JSON.stringify(body),
    });
  } catch (failure: unknown) {
    const detail = failure instanceof Error ? `: ${failure.message}` : ".";
    throw new SigraRequestError(`${NETWORK_FAILURE_PREFIX}${detail}`);
  }
}

async function readFailure(response: Response, context: string): Promise<SigraRequestError> {
  const fallback = `${context} (HTTP ${response.status}).`;
  try {
    const payload = (await response.json()) as Partial<SigraErrorResponse>;
    return new SigraRequestError(payload.error ?? fallback, payload.plan);
  } catch {
    return new SigraRequestError(fallback);
  }
}

export async function fetchSigraPlan(
  connection: ConnectionPayload,
  layerIds?: ReadonlyArray<SigraLayerId>
): Promise<SigraPlan> {
  const response = await post("plan", layerIds === undefined ? { connection } : { connection, layerIds });
  if (!response.ok) throw await readFailure(response, PLAN_FAILURE);
  return ((await response.json()) as SigraPlanResponse).plan;
}

/** A real load is confirmed explicitly; a dry run is not, because it saves nothing. */
export async function runSigraLoad(
  connection: ConnectionPayload,
  layerIds: ReadonlyArray<SigraLayerId>,
  { dryRun }: LoadLayerOptions
): Promise<SigraLoadAnswer> {
  const response = await post("load", { connection, layerIds, dryRun, confirm: !dryRun });
  if (!response.ok) throw await readFailure(response, LOAD_FAILURE);
  const payload = (await response.json()) as SigraLoadResponse;
  return { results: payload.results, dryRun: payload.dryRun };
}
