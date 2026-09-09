import type {
  CatalogFormatFilter,
  CatalogSourceGroup,
  SourceSummary,
  WatchedSource,
} from "../types";

/**
 * Browser-side access to the module's own endpoints.
 *
 * Every path is derived from one base, so the client cannot drift away from the routes the
 * generator emits. Each call checks `response.ok` before parsing: an error page is HTML, and
 * parsing it as JSON produces an unreadable failure instead of the real one.
 */

const API_BASE = "/api/m/cartography-watcher";

async function readJson<TPayload>(response: Response, context: string): Promise<TPayload> {
  if (!response.ok) {
    throw new Error(`${context} (HTTP ${response.status}).`);
  }

  const payload = (await response.json()) as TPayload & { success?: boolean; error?: string };

  if (payload.success === false) {
    throw new Error(payload.error ?? context);
  }

  return payload;
}

export async function fetchSources(): Promise<ReadonlyArray<WatchedSource>> {
  const response = await fetch(`${API_BASE}/sources`);
  const payload = await readJson<{ sources: WatchedSource[] }>(
    response,
    "No se pudieron leer las fuentes vigiladas"
  );
  return payload.sources;
}

export async function addSource(url: string): Promise<ReadonlyArray<WatchedSource>> {
  const response = await fetch(`${API_BASE}/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const payload = await readJson<{ sources: WatchedSource[] }>(
    response,
    "No se pudo agregar la fuente"
  );
  return payload.sources;
}

export async function removeSource(sourceId: string): Promise<ReadonlyArray<WatchedSource>> {
  const response = await fetch(`${API_BASE}/sources/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId }),
  });
  const payload = await readJson<{ sources: WatchedSource[] }>(
    response,
    "No se pudo eliminar la fuente"
  );
  return payload.sources;
}

export async function fetchSummaries(): Promise<ReadonlyArray<SourceSummary>> {
  const response = await fetch(`${API_BASE}/summaries`);
  const payload = await readJson<{ summaries: SourceSummary[] }>(
    response,
    "No se pudo consultar el estado de las fuentes"
  );
  return payload.summaries;
}

export async function fetchCatalog(
  formatFilter: CatalogFormatFilter
): Promise<ReadonlyArray<CatalogSourceGroup>> {
  const response = await fetch(`${API_BASE}/catalog?format=${encodeURIComponent(formatFilter)}`);
  const payload = await readJson<{ groups: CatalogSourceGroup[] }>(
    response,
    "No se pudo construir el catálogo"
  );
  return payload.groups;
}

/**
 * Fetches a catalogue file and wraps it as a `File`, so a sync tool receives exactly what the
 * local dropzone would have handed it.
 */
export async function fetchCatalogFile(
  datasetSlug: string,
  resourceId: string,
  fallbackName: string
): Promise<File> {
  const response = await fetch(
    `${API_BASE}/catalog/file?dataset=${encodeURIComponent(datasetSlug)}&resource=${encodeURIComponent(resourceId)}`
  );

  if (!response.ok) {
    throw new Error(`No se pudo obtener el archivo del catálogo (HTTP ${response.status}).`);
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/);
  const filename = filenameMatch ? filenameMatch[1] : fallbackName;

  return new File([await response.blob()], filename);
}
