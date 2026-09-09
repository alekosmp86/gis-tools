import {
  type WatcherSourceCheckResult,
  type WatchResourceDelta,
  type WatchedSourceConfig,
  type SourceCheckSummary,
  type CatalogSourceGroup,
  type CatalogFormatFilter,
  WatcherApiAction,
} from "../types/watcher";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const API_BASE_URL = "/api/modules/cartography-watcher";

/**
 * Helper method to query summaries across multiple watched cartography sources.
 */
export async function fetchSourcesSummariesApi(
  sources: readonly WatchedSourceConfig[]
): Promise<ApiResult<SourceCheckSummary[]>> {
  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: WatcherApiAction.SUMMARIES,
        sources,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Error HTTP ${response.status} al consultar resúmenes de fuentes.`,
      };
    }

    const payload = (await response.json()) as {
      success: boolean;
      data?: SourceCheckSummary[];
      error?: string;
    };

    if (!payload.success || !payload.data) {
      return {
        ok: false,
        error: payload.error || "No se pudieron obtener los resúmenes de las fuentes.",
      };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error de red al consultar resúmenes de fuentes.";
    return { ok: false, error: message };
  }
}

/**
 * Helper method to query the cartography-watcher check endpoint.
 */
export async function fetchSourceCheckApi(
  sourceUrl: string
): Promise<ApiResult<WatcherSourceCheckResult>> {
  try {
    const response = await fetch(
      `${API_BASE_URL}?url=${encodeURIComponent(sourceUrl)}`
    );

    if (!response.ok) {
      return {
        ok: false,
        error: `Error HTTP ${response.status} al consultar el catálogo de datos.`,
      };
    }

    const payload = (await response.json()) as {
      success: boolean;
      data?: WatcherSourceCheckResult;
      error?: string;
    };

    if (!payload.success || !payload.data) {
      return {
        ok: false,
        error: payload.error || "No se pudo consultar el catálogo de datos.",
      };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error de red al consultar el catálogo.";
    return { ok: false, error: message };
  }
}

/**
 * Helper method to trigger a resource download into the local vault.
 */
export async function downloadResourceApi(
  sourceUrl: string,
  resourceId: string
): Promise<ApiResult<{ delta: WatchResourceDelta }>> {
  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: WatcherApiAction.DOWNLOAD,
        url: sourceUrl,
        resourceId,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Error HTTP ${response.status} al descargar el archivo en el vault.`,
      };
    }

    const payload = (await response.json()) as {
      success: boolean;
      data?: { delta: WatchResourceDelta };
      error?: string;
    };

    if (!payload.success || !payload.data) {
      return {
        ok: false,
        error: payload.error || "Error al descargar el archivo en el vault.",
      };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error de red al descargar el recurso.";
    return { ok: false, error: message };
  }
}

/**
 * Fetches the hierarchical catalog tree across all configured sources.
 */
export async function fetchCatalogTreeApi(
  formatFilter?: CatalogFormatFilter
): Promise<ApiResult<CatalogSourceGroup[]>> {
  try {
    const formatQuery = formatFilter ? `&format=${encodeURIComponent(formatFilter)}` : "";
    const response = await fetch(`${API_BASE_URL}?action=${WatcherApiAction.CATALOG_TREE}${formatQuery}`);

    if (!response.ok) {
      return {
        ok: false,
        error: `Error HTTP ${response.status} al consultar el catálogo.`,
      };
    }

    const payload = (await response.json()) as {
      success: boolean;
      data?: CatalogSourceGroup[];
      error?: string;
    };

    if (!payload.success || !payload.data) {
      return {
        ok: false,
        error: payload.error || "No se pudo obtener el árbol del catálogo cartográfico.",
      };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error de red al consultar el catálogo.";
    return { ok: false, error: message };
  }
}

/**
 * Downloads or retrieves a catalog file directly as an in-memory browser File instance.
 */
export async function fetchCatalogFileAsBrowserFile(
  sourceSlug: string,
  resourceId: string,
  fallbackFileName?: string
): Promise<ApiResult<File>> {
  try {
    const response = await fetch(
      `${API_BASE_URL}?action=${WatcherApiAction.CATALOG_FILE}&sourceSlug=${encodeURIComponent(
        sourceSlug
      )}&resourceId=${encodeURIComponent(resourceId)}`
    );

    if (!response.ok) {
      return {
        ok: false,
        error: `Error al obtener archivo del catálogo (${response.status})`,
      };
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition");
    let fileName = fallbackFileName || "archivo-catalogo.csv";

    if (disposition && disposition.includes("filename=")) {
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) {
        fileName = match[1];
      }
    }

    const file = new File([blob], fileName, {
      type: response.headers.get("Content-Type") || "application/octet-stream",
    });

    return { ok: true, data: file };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al obtener archivo del catálogo.";
    return { ok: false, error: message };
  }
}

/**
 * Fetches the list of persisted watched sources from the server vault.
 */
export async function fetchPersistedSourcesApi(): Promise<ApiResult<WatchedSourceConfig[]>> {
  try {
    const response = await fetch(`${API_BASE_URL}?action=${WatcherApiAction.SOURCES}`);

    if (!response.ok) {
      return {
        ok: false,
        error: `Error HTTP ${response.status} al consultar las fuentes persistidas.`,
      };
    }

    const payload = (await response.json()) as {
      success: boolean;
      data?: WatchedSourceConfig[];
      error?: string;
    };

    if (!payload.success || !payload.data) {
      return {
        ok: false,
        error: payload.error || "No se pudieron obtener las fuentes del vault.",
      };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error de red al consultar fuentes del vault.";
    return { ok: false, error: message };
  }
}

/**
 * Adds a custom watched source to the server vault.
 */
export async function addCustomSourceApi(
  sourceUrl: string
): Promise<ApiResult<WatchedSourceConfig>> {
  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: WatcherApiAction.ADD_SOURCE,
        url: sourceUrl,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Error HTTP ${response.status} al agregar la fuente cartográfica.`,
      };
    }

    const payload = (await response.json()) as {
      success: boolean;
      data?: WatchedSourceConfig;
      error?: string;
    };

    if (!payload.success || !payload.data) {
      return {
        ok: false,
        error: payload.error || "Error al agregar la fuente en el vault.",
      };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error de red al agregar la fuente.";
    return { ok: false, error: message };
  }
}

/**
 * Removes a custom watched source from the server vault.
 */
export async function removeCustomSourceApi(
  sourceId: string
): Promise<ApiResult<WatchedSourceConfig[]>> {
  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: WatcherApiAction.REMOVE_SOURCE,
        sourceId,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Error HTTP ${response.status} al eliminar la fuente cartográfica.`,
      };
    }

    const payload = (await response.json()) as {
      success: boolean;
      data?: WatchedSourceConfig[];
      error?: string;
    };

    if (!payload.success || !payload.data) {
      return {
        ok: false,
        error: payload.error || "Error al eliminar la fuente del vault.",
      };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error de red al eliminar la fuente.";
    return { ok: false, error: message };
  }
}

