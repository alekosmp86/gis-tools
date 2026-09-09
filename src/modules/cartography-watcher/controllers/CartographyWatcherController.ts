import path from "node:path";
import { NextResponse } from "next/server";
import { WatcherOrchestrator } from "../services/WatcherOrchestrator";
import { DEFAULT_WATCHED_SOURCES } from "../data/defaultSources";
import {
  CatalogFormatFilter,
  SpatialFileFormat,
  WatcherApiAction,
  type WatchedSourceConfig,
} from "../types/watcher";

export interface CartographyWatcherRequestBody {
  action?: string;
  url?: string;
  resourceId?: string;
  sourceId?: string;
  sources?: WatchedSourceConfig[];
}

function resolveFileContentType(formatString?: string): string {
  const normalizedFormat = (formatString || "").toUpperCase();
  if (normalizedFormat === SpatialFileFormat.CSV) {
    return "text/csv; charset=utf-8";
  }
  if (
    normalizedFormat === SpatialFileFormat.JSON ||
    normalizedFormat === SpatialFileFormat.GEOJSON
  ) {
    return "application/json";
  }
  return "application/octet-stream";
}

/**
 * Controller layer for Cartography Watcher API operations.
 * Handles HTTP requests, parameter extraction, response serialization, and status codes.
 */
export class CartographyWatcherController {
  private readonly getActionHandlers: Record<
    string,
    (searchParams: URLSearchParams) => Promise<Response>
  >;

  private readonly postActionHandlers: Record<
    string,
    (body: CartographyWatcherRequestBody) => Promise<Response>
  >;

  constructor(
    private readonly service: WatcherOrchestrator = new WatcherOrchestrator()
  ) {
    this.getActionHandlers = {
      [WatcherApiAction.SOURCES]: () => this.getSources(),
      [WatcherApiAction.CATALOG_TREE]: (searchParams: URLSearchParams) =>
        this.getCatalogTree(searchParams),
      [WatcherApiAction.CATALOG_FILE]: (searchParams: URLSearchParams) =>
        this.getCatalogFile(searchParams),
      [WatcherApiAction.VAULT_FILE]: (searchParams: URLSearchParams) =>
        this.getCatalogFile(searchParams),
      [WatcherApiAction.SUMMARIES]: (searchParams: URLSearchParams) =>
        this.getSummaries(searchParams),
    };

    this.postActionHandlers = {
      [WatcherApiAction.SUMMARIES]: (body: CartographyWatcherRequestBody) =>
        this.postSummaries(body.sources),
      [WatcherApiAction.ADD_SOURCE]: (body: CartographyWatcherRequestBody) =>
        this.postAddSource(body.url),
      [WatcherApiAction.REMOVE_SOURCE]: (body: CartographyWatcherRequestBody) =>
        this.postRemoveSource(body.sourceId),
      [WatcherApiAction.DOWNLOAD]: (body: CartographyWatcherRequestBody) =>
        this.downloadResource(body.url, body.resourceId),
    };
  }

  /**
   * Dispatches incoming GET requests to the appropriate controller action via dispatch table.
   */
  public async handleGet(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url);
      const actionName = searchParams.get("action");
      const targetHandler = actionName ? this.getActionHandlers[actionName] : undefined;

      if (targetHandler) {
        return await targetHandler(searchParams);
      }

      return await this.checkSource(searchParams);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error al consultar el catálogo";
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  }

  /**
   * Dispatches incoming POST requests to the appropriate controller action via dispatch table.
   */
  public async handlePost(request: Request): Promise<Response> {
    try {
      const requestBody = (await request.json()) as CartographyWatcherRequestBody;
      const targetHandler = requestBody.action
        ? this.postActionHandlers[requestBody.action]
        : undefined;

      if (targetHandler) {
        return await targetHandler(requestBody);
      }

      return await this.downloadResource(requestBody.url, requestBody.resourceId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error al procesar la solicitud";
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  }

  /**
   * Retrieves the catalog tree, filtered by format.
   */
  public async getCatalogTree(searchParams: URLSearchParams): Promise<Response> {
    const formatParam = (
      searchParams.get("format") || CatalogFormatFilter.ALL
    ).toUpperCase();

    const formatFilter =
      formatParam === CatalogFormatFilter.CSV || formatParam === CatalogFormatFilter.SHP
        ? (formatParam as CatalogFormatFilter)
        : CatalogFormatFilter.ALL;

    const tree = await this.service.getCatalogTree(formatFilter);
    return NextResponse.json({ success: true, data: tree });
  }

  /**
   * Streams a catalog file from vault or remote portal with proper download headers.
   */
  public async getCatalogFile(searchParams: URLSearchParams): Promise<Response> {
    const sourceSlug = searchParams.get("sourceSlug");
    const resourceId = searchParams.get("resourceId");

    if (!sourceSlug || !resourceId) {
      return NextResponse.json(
        { success: false, error: "sourceSlug y resourceId son requeridos." },
        { status: 400 }
      );
    }

    const fileResult = await this.service.getCatalogFile(sourceSlug, resourceId);
    if (!fileResult) {
      return NextResponse.json(
        { success: false, error: "Archivo no encontrado en el catálogo." },
        { status: 404 }
      );
    }

    const contentType = resolveFileContentType(fileResult.meta.format);
    const fileName = path.basename(fileResult.meta.localFilePath);

    return new NextResponse(new Uint8Array(fileResult.content), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Resource-Id": fileResult.meta.resourceId,
        "X-Resource-Name": encodeURIComponent(fileResult.meta.resourceName),
      },
    });
  }

  /**
   * Computes delta status summaries for watched sources via GET searchParams.
   */
  public async getSummaries(searchParams: URLSearchParams): Promise<Response> {
    const sourcesParam = searchParams.get("sources");
    let sources: readonly WatchedSourceConfig[] = DEFAULT_WATCHED_SOURCES;

    if (sourcesParam) {
      try {
        sources = JSON.parse(sourcesParam) as WatchedSourceConfig[];
      } catch {
        // Fallback to default watched sources if parsing fails
      }
    }

    const summaries = await this.service.checkMultipleSources(sources);
    return NextResponse.json({ success: true, data: summaries });
  }

  /**
   * Checks the status and delta reports of a single CKAN portal source.
   */
  public async checkSource(searchParams: URLSearchParams): Promise<Response> {
    const sourceUrl = searchParams.get("url") || DEFAULT_WATCHED_SOURCES[0].url;
    const checkResult = await this.service.checkSource(sourceUrl);
    return NextResponse.json({ success: true, data: checkResult });
  }

  /**
   * Computes delta status summaries for sources supplied in a POST body.
   */
  public async postSummaries(
    sources: readonly WatchedSourceConfig[] | undefined
  ): Promise<Response> {
    const activeSources =
      sources && sources.length > 0 ? sources : DEFAULT_WATCHED_SOURCES;
    const summaries = await this.service.checkMultipleSources(activeSources);
    return NextResponse.json({ success: true, data: summaries });
  }

  /**
   * Initiates downloading a specific resource into the local vault.
   */
  public async downloadResource(
    sourceUrl: string | undefined,
    resourceId: string | undefined
  ): Promise<Response> {
    if (!resourceId) {
      return NextResponse.json(
        { success: false, error: "El parámetro resourceId es obligatorio." },
        { status: 400 }
      );
    }

    const url = sourceUrl || DEFAULT_WATCHED_SOURCES[0].url;
    const downloadResult = await this.service.downloadResource(url, resourceId);
    return NextResponse.json({ success: true, data: downloadResult });
  }

  /**
   * Retrieves all watched sources stored in the server vault.
   */
  public async getSources(): Promise<Response> {
    const sources = await this.service.getWatchedSources();
    return NextResponse.json({ success: true, data: sources });
  }

  /**
   * Adds a new watched source from a portal URL.
   */
  public async postAddSource(url?: string): Promise<Response> {
    if (!url || !url.trim()) {
      return NextResponse.json(
        { success: false, error: "El parámetro url es obligatorio para agregar una fuente." },
        { status: 400 }
      );
    }

    const newSource = await this.service.addWatchedSource(url);
    return NextResponse.json({ success: true, data: newSource });
  }

  /**
   * Removes a custom watched source by ID.
   */
  public async postRemoveSource(sourceId?: string): Promise<Response> {
    if (!sourceId || !sourceId.trim()) {
      return NextResponse.json(
        { success: false, error: "El parámetro sourceId es obligatorio para eliminar una fuente." },
        { status: 400 }
      );
    }

    const updatedSources = await this.service.removeWatchedSource(sourceId);
    return NextResponse.json({ success: true, data: updatedSources });
  }
}
