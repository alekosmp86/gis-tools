import type { ExportFormat } from "../constants";
import { buildExportFilename } from "../domain/export";
import type {
  RemovalExecutionRequestPayload,
  RemovalResult,
  RemovalSimulationPayload,
  RemovalSimulationRequestPayload,
} from "../removalTypes";
import type {
  AnalyzeResponsePayload,
  ConnectionPayload,
  DedupRequestPayload,
  ProvincesRequestPayload,
  ProvincesResponsePayload,
} from "../types";
import { downloadBlob } from "./downloadBlob";

/**
 * Browser-side access to the module's endpoints. Credentials travel in the POST body only.
 * Each call checks `response.ok` first: an error page is HTML, and parsing it as JSON hides the
 * real failure.
 */

const API_BASE = "/api/m/address-dedup";

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readFailure(response: Response, context: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    return new Error(payload.error ?? `${context} (HTTP ${response.status}).`);
  } catch {
    return new Error(`${context} (HTTP ${response.status}).`);
  }
}

export async function fetchProvinces(connection: ConnectionPayload): Promise<ProvincesResponsePayload> {
  const response = await postJson("provinces", { connection } satisfies ProvincesRequestPayload);

  if (!response.ok) {
    throw await readFailure(response, "No se pudieron cargar los departamentos");
  }

  return (await response.json()) as ProvincesResponsePayload;
}

export async function analyzeDuplicates(
  payload: DedupRequestPayload
): Promise<AnalyzeResponsePayload> {
  const response = await postJson("analyze", payload);

  if (!response.ok) {
    throw await readFailure(response, "No se pudo analizar los duplicados");
  }

  return (await response.json()) as AnalyzeResponsePayload;
}

export async function downloadExport(
  payload: DedupRequestPayload,
  format: ExportFormat
): Promise<void> {
  const response = await postJson("export", { ...payload, format });

  if (!response.ok) {
    throw await readFailure(response, "No se pudo generar la exportación");
  }

  downloadBlob(await response.blob(), buildExportFilename(payload.provinceId, format));
}

export async function simulateRemoval(
  payload: RemovalSimulationRequestPayload
): Promise<RemovalSimulationPayload> {
  const response = await postJson("removal/simulate", payload);

  if (!response.ok) {
    throw await readFailure(response, "No se pudo simular la baja");
  }

  return (await response.json()) as RemovalSimulationPayload;
}

export async function executeRemoval(payload: RemovalExecutionRequestPayload): Promise<RemovalResult> {
  const response = await postJson("removal/execute", payload);

  if (!response.ok) {
    throw await readFailure(response, "No se pudo ejecutar la baja");
  }

  return (await response.json()) as RemovalResult;
}
