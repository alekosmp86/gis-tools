import { parseFormatFilter } from "../domain/catalogMapping";
import { WatcherOrchestrator } from "../services/WatcherOrchestrator";
import type { ModuleEndpointHandler } from "@/core/modules/contracts";

/**
 * HTTP surface of the module.
 *
 * One handler per declared path — the router does the dispatching, so there is no action string to
 * keep in sync with a table. Handlers stay thin: parse the request, call the orchestrator, shape
 * the response. The orchestrator is injected so the whole surface is testable without a portal.
 *
 * They speak the Web platform Request/Response and never Next types.
 */

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
} as const;

/** Query parameters the endpoints read. */
const QueryParameter = {
  FORMAT: "format",
  DATASET: "dataset",
  RESOURCE: "resource",
} as const;

export interface WatcherHandlers {
  readonly listSources: ModuleEndpointHandler;
  readonly addSource: ModuleEndpointHandler;
  readonly removeSource: ModuleEndpointHandler;
  readonly readSummaries: ModuleEndpointHandler;
  readonly readCatalog: ModuleEndpointHandler;
  readonly readCatalogFile: ModuleEndpointHandler;
}

function jsonResponse(body: unknown, status: number = HTTP_STATUS.OK): Response {
  return Response.json(body, { status });
}

function failure(message: string, status: number): Response {
  return jsonResponse({ success: false, error: message }, status);
}

/** Turns anything thrown into a response, so a portal outage never becomes an unhandled rejection. */
function toErrorResponse(error: unknown, fallbackMessage: string): Response {
  const message = error instanceof Error ? error.message : fallbackMessage;
  return failure(message, HTTP_STATUS.SERVER_ERROR);
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readRequiredParameter(request: Request, parameterName: string): string | null {
  const value = new URL(request.url).searchParams.get(parameterName);
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Builds the module's handlers around an orchestrator.
 *
 * @param orchestrator - injected in tests; defaults to the real portal, vault and source list.
 */
export function createWatcherHandlers(
  orchestrator: WatcherOrchestrator = new WatcherOrchestrator()
): WatcherHandlers {
  return {
    listSources: async () => {
      try {
        return jsonResponse({ success: true, sources: await orchestrator.listSources() });
      } catch (error: unknown) {
        return toErrorResponse(error, "No se pudieron leer las fuentes vigiladas.");
      }
    },

    addSource: async (request) => {
      const body = await readJsonBody(request);
      const rawUrl = typeof body.url === "string" ? body.url : "";

      if (rawUrl.trim().length === 0) {
        return failure(
          'Indique la URL o el identificador del conjunto de datos en el campo "url".',
          HTTP_STATUS.BAD_REQUEST
        );
      }

      try {
        return jsonResponse({ success: true, sources: await orchestrator.addSource(rawUrl) });
      } catch (error: unknown) {
        return toErrorResponse(error, "No se pudo agregar la fuente.");
      }
    },

    removeSource: async (request) => {
      const body = await readJsonBody(request);
      const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";

      if (sourceId.trim().length === 0) {
        return failure(
          'Indique el identificador de la fuente en el campo "sourceId".',
          HTTP_STATUS.BAD_REQUEST
        );
      }

      try {
        return jsonResponse({ success: true, sources: await orchestrator.removeSource(sourceId) });
      } catch (error: unknown) {
        return toErrorResponse(error, "No se pudo eliminar la fuente.");
      }
    },

    readSummaries: async () => {
      try {
        return jsonResponse({ success: true, summaries: await orchestrator.summarizeSources() });
      } catch (error: unknown) {
        return toErrorResponse(error, "No se pudo consultar el estado de las fuentes.");
      }
    },

    readCatalog: async (request) => {
      const formatFilter = parseFormatFilter(
        new URL(request.url).searchParams.get(QueryParameter.FORMAT)
      );

      try {
        return jsonResponse({ success: true, groups: await orchestrator.buildCatalog(formatFilter) });
      } catch (error: unknown) {
        return toErrorResponse(error, "No se pudo construir el catálogo.");
      }
    },

    readCatalogFile: async (request) => {
      const datasetSlug = readRequiredParameter(request, QueryParameter.DATASET);
      const resourceId = readRequiredParameter(request, QueryParameter.RESOURCE);

      if (!datasetSlug || !resourceId) {
        return failure(
          'Indique los parámetros "dataset" y "resource".',
          HTTP_STATUS.BAD_REQUEST
        );
      }

      try {
        const { meta, content } = await orchestrator.getResourceFile(datasetSlug, resourceId);
        const filename = meta.relativeFilePath.slice(meta.relativeFilePath.lastIndexOf("/") + 1);

        // Served as a download so the browser hands the sync tool a real File.
        return new Response(new Uint8Array(content), {
          status: HTTP_STATUS.OK,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(content.byteLength),
          },
        });
      } catch (error: unknown) {
        return toErrorResponse(error, "No se pudo obtener el archivo del catálogo.");
      }
    },
  };
}
