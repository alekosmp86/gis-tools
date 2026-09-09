import { CkanPortalClient } from "./CkanPortalClient";
import { VaultStorageService } from "./VaultStorageService";
import { WatchedSourcesStorageService } from "./WatchedSourcesStorageService";
import { extractSlugFromUrl, formatTitleFromSlug } from "../utils/watcherUrls";
import {
  type WatcherSourceCheckResult,
  type WatchResourceDelta,
  type VaultResourceMeta,
  type WatchedSourceConfig,
  type SourceCheckSummary,
  type CatalogSourceGroup,
  type CatalogResourceItem,
  DeltaStatus,
  SourceBadgeState,
  CatalogFormatFilter,
  SpatialFileFormat,
  WATCHED_SOURCE_CATEGORY,
  isCsvFormat,
  isShapefileCompatibleFormat,
} from "../types/watcher";

/**
 * WatcherOrchestrator.ts
 * Coordinates portal reconnaissance probes with local vault storage.
 */
export class WatcherOrchestrator {
  private readonly client: CkanPortalClient;
  private readonly vault: VaultStorageService;
  private readonly sourcesStorage: WatchedSourcesStorageService;

  constructor(
    client: CkanPortalClient = new CkanPortalClient(),
    vault: VaultStorageService = new VaultStorageService(),
    sourcesStorage: WatchedSourcesStorageService = new WatchedSourcesStorageService()
  ) {
    this.client = client;
    this.vault = vault;
    this.sourcesStorage = sourcesStorage;
  }

  /**
   * Probes the remote CKAN portal, evaluates local vault states, and produces
   * a comprehensive delta report.
   */
  public async checkSource(portalUrlOrSlug: string): Promise<WatcherSourceCheckResult> {
    const { host, datasetSlug } = this.client.parsePortalUrl(portalUrlOrSlug);
    const ckanPackage = await this.client.fetchPackageMetadata(datasetSlug, host);

    const deltaPromises = ckanPackage.resources.map(async (resource) => {
      const localMeta = await this.vault.readResourceMeta(datasetSlug, resource.id);
      return this.client.evaluateResourceDelta(resource, localMeta);
    });

    const resourceDeltas = await Promise.all(deltaPromises);
    const updatesCount = resourceDeltas.filter(
      (delta) =>
        delta.status === DeltaStatus.UPDATE_AVAILABLE ||
        delta.status === DeltaStatus.NOT_DOWNLOADED
    ).length;

    return {
      datasetSlug,
      datasetTitle: ckanPackage.title,
      datasetModified: ckanPackage.metadata_modified,
      updateFrequency: ckanPackage.update_frequency,
      totalResources: ckanPackage.resources.length,
      updatesCount,
      resources: resourceDeltas,
    };
  }

  /**
   * Evaluates delta status summaries across multiple configured watched sources in parallel.
   */
  public async checkMultipleSources(
    sources: readonly WatchedSourceConfig[]
  ): Promise<SourceCheckSummary[]> {
    const summaryPromises = sources.map(async (source): Promise<SourceCheckSummary> => {
      try {
        const result = await this.checkSource(source.url || source.datasetSlug);

        let status: SourceBadgeState = SourceBadgeState.UP_TO_DATE;
        if (result.updatesCount > 0) {
          status = SourceBadgeState.UPDATE_AVAILABLE;
        } else {
          const hasAnyDownloaded = result.resources.some(
            (item) => item.status === DeltaStatus.UP_TO_DATE
          );
          if (!hasAnyDownloaded && result.totalResources > 0) {
            status = SourceBadgeState.NOT_DOWNLOADED;
          }
        }

        return {
          sourceId: source.id,
          datasetSlug: result.datasetSlug,
          title: result.datasetTitle || source.title,
          status,
          totalResources: result.totalResources,
          updatesCount: result.updatesCount,
          lastChecked: new Date().toISOString(),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error al consultar fuente";
        return {
          sourceId: source.id,
          datasetSlug: source.datasetSlug,
          title: source.title,
          status: SourceBadgeState.ERROR,
          totalResources: 0,
          updatesCount: 0,
          errorMessage: message,
          lastChecked: new Date().toISOString(),
        };
      }
    });

    return Promise.all(summaryPromises);
  }

  /**
   * Downloads a specific resource from the remote portal and vaults it locally.
   */
  public async downloadResource(
    portalUrlOrSlug: string,
    resourceId: string
  ): Promise<{ meta: VaultResourceMeta; delta: WatchResourceDelta; content: Buffer }> {
    const { host, datasetSlug } = this.client.parsePortalUrl(portalUrlOrSlug);
    const ckanPackage = await this.client.fetchPackageMetadata(datasetSlug, host);

    const resource = ckanPackage.resources.find((item) => item.id === resourceId);
    if (!resource) {
      throw new Error(
        `El recurso "${resourceId}" no fue encontrado en el conjunto de datos "${datasetSlug}".`
      );
    }

    if (!resource.url) {
      throw new Error(`El recurso "${resource.name}" no tiene una URL de descarga válida.`);
    }

    const content = await this.client.downloadResourceBinary(resource.url);
    const savedMeta = await this.vault.saveVaultResource(datasetSlug, resource, content);
    const updatedDelta = this.client.evaluateResourceDelta(resource, savedMeta);

    return {
      meta: savedMeta,
      delta: updatedDelta,
      content,
    };
  }

  public async getVaultFile(
    sourceSlug: string,
    resourceId: string
  ): Promise<{ meta: VaultResourceMeta; content: Buffer } | null> {
    return this.vault.getVaultFile(sourceSlug, resourceId);
  }

  /**
   * Retrieves all watched sources from the server-side vault storage.
   */
  public async getWatchedSources(): Promise<WatchedSourceConfig[]> {
    return this.sourcesStorage.loadSources();
  }

  /**
   * Adds a new custom watched source by portal URL and saves it to vault storage.
   */
  public async addWatchedSource(portalUrl: string): Promise<WatchedSourceConfig> {
    const trimmedUrl = portalUrl.trim();
    if (!trimmedUrl) {
      throw new Error("La URL de la fuente cartográfica no puede estar vacía.");
    }

    const slug = extractSlugFromUrl(trimmedUrl);
    const title = formatTitleFromSlug(slug);
    const newConfig: WatchedSourceConfig = {
      id: slug,
      title,
      url: trimmedUrl,
      datasetSlug: slug,
      category: WATCHED_SOURCE_CATEGORY.CUSTOM,
      isDefault: false,
    };

    await this.sourcesStorage.addSource(newConfig);
    return newConfig;
  }

  /**
   * Removes a custom watched source from vault storage.
   */
  public async removeWatchedSource(sourceId: string): Promise<WatchedSourceConfig[]> {
    return this.sourcesStorage.removeSource(sourceId);
  }

  /**
   * Retrieves the catalog tree across all configured sources, filtering by format and tagging cached items.
   * If sources are not explicitly provided, defaults to all server-persisted sources.
   */
  public async getCatalogTree(
    formatFilter: CatalogFormatFilter = CatalogFormatFilter.ALL,
    sources?: readonly WatchedSourceConfig[]
  ): Promise<CatalogSourceGroup[]> {
    const activeSources = sources ?? (await this.sourcesStorage.loadSources());
    const treePromises = activeSources.map(async (source): Promise<CatalogSourceGroup> => {
      try {
        const { host, datasetSlug } = this.client.parsePortalUrl(source.url || source.datasetSlug);
        const ckanPackage = await this.client.fetchPackageMetadata(datasetSlug, host);

        const filteredResources = ckanPackage.resources.filter((resource) => {
          if (formatFilter === CatalogFormatFilter.ALL) return true;
          if (formatFilter === CatalogFormatFilter.CSV) {
            return isCsvFormat(resource.format);
          }
          if (formatFilter === CatalogFormatFilter.SHP) {
            return isShapefileCompatibleFormat(resource.format);
          }
          return true;
        });

        const resourceItems: CatalogResourceItem[] = filteredResources.map((resource) => {
          const isCached = this.vault.isResourceCached(source.datasetSlug, resource.id);
          return {
            id: resource.id,
            name: resource.name,
            format: (resource.format || SpatialFileFormat.CSV).toUpperCase(),
            size: resource.size ?? null,
            lastModified: resource.last_modified || resource.metadata_modified || null,
            url: resource.url || null,
            isCached,
          };
        });

        return {
          sourceSlug: source.datasetSlug,
          title: source.title || ckanPackage.title,
          description: source.description || ckanPackage.notes || "",
          resources: resourceItems,
        };
      } catch {
        return {
          sourceSlug: source.datasetSlug,
          title: source.title,
          description: source.description || "",
          resources: [],
        };
      }
    });

    const groups = await Promise.all(treePromises);
    return groups.filter((group) => group.resources.length > 0);
  }

  /**
   * Transparently retrieves a catalog file. If cached locally, loads directly from disk.
   * If not cached or outdated, downloads and caches the resource on-the-fly before returning.
   */
  public async getCatalogFile(
    sourceSlug: string,
    resourceId: string
  ): Promise<{ meta: VaultResourceMeta; content: Buffer }> {
    // 1. Check if already cached in vault
    const existing = await this.vault.getVaultFile(sourceSlug, resourceId);
    if (existing) {
      return existing;
    }

    // 2. Not cached: fetch from portal, download into vault silently, and return in-memory buffer
    const { meta, content } = await this.downloadResource(sourceSlug, resourceId);
    return {
      meta,
      content,
    };
  }

  public getVault(): VaultStorageService {
    return this.vault;
  }

  public getClient(): CkanPortalClient {
    return this.client;
  }

  public getSourcesStorage(): WatchedSourcesStorageService {
    return this.sourcesStorage;
  }
}

