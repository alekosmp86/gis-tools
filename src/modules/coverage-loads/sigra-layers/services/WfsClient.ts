import {
  HTTP_SERVER_ERROR_MIN_STATUS,
  WFS_MAX_RETRIES,
  WFS_REQUEST_TIMEOUT_MS,
  WFS_RETRY_BACKOFF_BASE_MS,
} from "../constants";
import type { WfsClientOptions, WfsFeature, WfsPage, WfsPageFetcher } from "../types";

export type { WfsPage } from "../types";

export class WfsRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "WfsRequestError";
    this.retryable = retryable;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePage(body: unknown): WfsPage {
  if (!isRecord(body) || !Array.isArray(body.features)) {
    throw new WfsRequestError("La respuesta del WFS no contiene una lista de features válida.", false);
  }
  const numberMatched = typeof body.numberMatched === "number" ? body.numberMatched : null;
  return { features: body.features as WfsFeature[], numberMatched };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new WfsRequestError("La respuesta del WFS no es JSON válido.", false);
  }
}

async function sendRequest(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new WfsRequestError("No se pudo conectar con el WFS de SIGRA o la solicitud excedió el tiempo límite.", true);
  }
}

async function requestOnce(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<WfsPage> {
  const response = await sendRequest(fetchImpl, url, timeoutMs);
  if (!response.ok) {
    const retryable = response.status >= HTTP_SERVER_ERROR_MIN_STATUS;
    throw new WfsRequestError(`El WFS de SIGRA respondió con el estado HTTP ${response.status}.`, retryable);
  }
  return parsePage(await readJson(response));
}

function shouldRethrow(error: unknown, attempt: number, maxRetries: number): boolean {
  return !(error instanceof WfsRequestError) || !error.retryable || attempt >= maxRetries;
}

export function createWfsPageFetcher(options: WfsClientOptions = {}): WfsPageFetcher {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? WFS_REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? WFS_MAX_RETRIES;

  async function fetchPage(url: string): Promise<WfsPage> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await requestOnce(fetchImpl, url, timeoutMs);
      } catch (error) {
        if (shouldRethrow(error, attempt, maxRetries)) throw error;
        await sleep(WFS_RETRY_BACKOFF_BASE_MS * 2 ** attempt);
      }
    }
  }

  return { fetchPage };
}
