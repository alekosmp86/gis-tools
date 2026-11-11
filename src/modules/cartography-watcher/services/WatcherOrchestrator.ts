import { DIRECT_CATALOG_FORMAT, DIRECT_ZIP_EXTENSION } from "../constants";
import {
  buildErrorSummary,
  buildOnDemandSummary,
  deriveSourceBadge,
  matchesFormatFilter,
  toCatalogResourceItem,
  toDirectCatalogGroup,
} from "../domain/catalogMapping";
import { countPendingResources, evaluateResourceDelta } from "../domain/deltaEvaluation";
import { findSourceWithDirectUrl, parseDirectUrl } from "../domain/directUrl";
import { isDirectSource } from "../domain/sourceKind";
import {
  CatalogFormatFilter,
  DeltaStatus,
  VaultRenameResult,
  WatchedSourceKind,
} from "../types";
import { formatTitleFromSlug, parsePortalReference, sanitizeSlug } from "../domain/sourceNaming";
import { sourceNotFoundMessage } from "../domain/sourceOverrides";
import { CkanPortalClient } from "./CkanPortalClient";
import { DirectUrlDownloader } from "./DirectUrlDownloader";
import { VaultStorageService } from "./VaultStorageService";
import { WatchedSourcesStorageService } from "./WatchedSourcesStorageService";
import type {
  CatalogResourceItem,
  CatalogSourceGroup,
  ResourceDelta,
  SourceEditChanges,
  SourceMutationResult,
  SourceSummary,
  VaultResourceMeta,
  WatchedSource,
} from "../types";

/**
 * Composes the portal, the vault and the source list into the operations the module offers.
 *
 * The three collaborators are injected, so the whole orchestration can be exercised against a fake
 * portal and a temporary vault. It holds no state of its own: every call reads the current truth
 * from disk and from the portal.
 */
export class WatcherOrchestrator {
  private readonly portal: CkanPortalClient;
  private readonly vault: VaultStorageService;
  private readonly sourcesStorage: WatchedSourcesStorageService;
  private readonly directDownloader: DirectUrlDownloader;

  constructor(
    portal: CkanPortalClient = new CkanPortalClient(),
    vault: VaultStorageService = new VaultStorageService(),
    sourcesStorage: WatchedSourcesStorageService = new WatchedSourcesStorageService(),
    directDownloader: DirectUrlDownloader = new DirectUrlDownloader()
  ) {
    this.portal = portal;
    this.vault = vault;
    this.sourcesStorage = sourcesStorage;
    this.directDownloader = directDownloader;
  }

  public async listSources(): Promise<WatchedSource[]> {
    return this.sourcesStorage.loadSources();
  }

  /**
   * Adds a source from whatever the user pasted, confirming with the portal that the dataset
   * exists before persisting it. Saving an unreachable source would only fail later, less clearly.
   */
  public async addSource(rawInput: string): Promise<WatchedSource[]> {
    const { portalHost, datasetSlug } = parsePortalReference(rawInput);

    const sources = await this.sourcesStorage.loadSources();
    this.assertReferenceIsFree(sources, portalHost, datasetSlug);

    const derivedId = sanitizeSlug(datasetSlug);
    const collisionById = sources.find((source) => source.id === derivedId);
    if (collisionById) {
      throw new Error(`Ya existe una fuente vigilada con identificador "${derivedId}".`);
    }

    const ckanPackage = await this.portal.fetchPackage(datasetSlug, portalHost);

    return this.sourcesStorage.addSource({
      id: derivedId,
      title: ckanPackage.title || formatTitleFromSlug(datasetSlug),
      datasetSlug,
      portalHost,
      description: ckanPackage.notes,
      isDefault: false,
    });
  }

  /**
   * Adds a direct-URL source after one trial download proves it serves a zipped shapefile. The
   * bytes are discarded: a direct source is never stored in the vault.
   */
  public async addDirectSource(title: string, rawUrl: string): Promise<SourceMutationResult> {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      throw new Error("El título de la fuente no puede estar vacío.");
    }

    const { url, host } = parseDirectUrl(rawUrl);
    const sources = await this.sourcesStorage.loadSources();
    const derivedId = sanitizeSlug(trimmedTitle);

    if (sources.some((source) => source.id === derivedId || source.datasetSlug === derivedId)) {
      throw new Error(`Ya existe una fuente vigilada con identificador "${derivedId}".`);
    }
    this.assertDirectUrlIsFree(sources, url);

    const { warnings } = await this.directDownloader.downloadShapefileZip(url);

    const updatedSources = await this.sourcesStorage.addSource({
      id: derivedId,
      title: trimmedTitle,
      datasetSlug: derivedId,
      portalHost: host,
      isDefault: false,
      kind: WatchedSourceKind.DIRECT_URL,
      directUrl: url,
      warnings,
    });
    return { sources: updatedSources, warnings };
  }

  /**
   * Edits a direct-URL source. Nothing is saved unless every requested change validates, and an
   * unchanged URL is not downloaded again.
   */
  public async updateDirectSource(
    sourceId: string,
    changes: SourceEditChanges
  ): Promise<SourceMutationResult> {
    const sources = await this.sourcesStorage.loadSources();
    const existing = sources.find((source) => source.id === sourceId);
    if (!existing) {
      throw new Error(sourceNotFoundMessage(sourceId));
    }
    if (!isDirectSource(existing)) {
      throw new Error(`La fuente "${sourceId}" no es una URL directa.`);
    }

    const newTitle = changes.title?.trim();
    if (newTitle !== undefined && newTitle.length === 0) {
      throw new Error("El título de la fuente no puede estar vacío.");
    }

    let warnings: ReadonlyArray<string> = existing.warnings ?? [];
    let urlChanges: Partial<WatchedSource> = {};

    if (changes.url !== undefined) {
      const { url, host } = parseDirectUrl(changes.url);
      if (url !== existing.directUrl) {
        this.assertDirectUrlIsFree(sources, url, sourceId);
        warnings = (await this.directDownloader.downloadShapefileZip(url)).warnings;
        urlChanges = { directUrl: url, portalHost: host, warnings };
      }
    }

    const updatedSources = await this.sourcesStorage.updateSource(sourceId, {
      ...urlChanges,
      ...(newTitle !== undefined ? { title: newTitle } : {}),
    });
    return { sources: updatedSources, warnings };
  }

  public async removeSource(sourceId: string): Promise<WatchedSource[]> {
    return this.sourcesStorage.removeSource(sourceId);
  }

  public async updateSource(sourceId: string, rawInput: string): Promise<WatchedSource[]> {
    const { portalHost, datasetSlug } = parsePortalReference(rawInput);

    const sources = await this.sourcesStorage.loadSources();
    const existing = sources.find((source) => source.id === sourceId);
    if (!existing) {
      throw new Error(sourceNotFoundMessage(sourceId));
    }
    if (isDirectSource(existing)) {
      throw new Error(
        `La fuente "${sourceId}" es una URL directa y no se edita con un conjunto CKAN.`
      );
    }

    this.assertReferenceIsFree(sources, portalHost, datasetSlug, sourceId);

    const ckanPackage = await this.portal.fetchPackage(datasetSlug, portalHost);

    if (existing.datasetSlug !== datasetSlug) {
      const renameResult = await this.vault.renameSourceDir(existing.datasetSlug, datasetSlug);
      if (renameResult === VaultRenameResult.FAILED) {
        throw new Error(
          `No se pudo renombrar el directorio del vault para "${datasetSlug}".`
        );
      }
    }

    return this.sourcesStorage.updateSource(sourceId, {
      portalHost,
      datasetSlug,
      title: ckanPackage.title || formatTitleFromSlug(datasetSlug),
      description: ckanPackage.notes ?? "",
    });
  }

  /** Compares every resource of one source against the vault. */
  public async inspectSource(source: WatchedSource): Promise<ReadonlyArray<ResourceDelta>> {
    // The portal call and the vault read do not depend on each other.
    const [ckanPackage, storedMeta] = await Promise.all([
      this.portal.fetchPackage(source.datasetSlug, source.portalHost),
      this.vault.readAllMeta(source.datasetSlug),
    ]);

    return ckanPackage.resources.map((resource) =>
      evaluateResourceDelta(resource, storedMeta.get(resource.id) ?? null)
    );
  }

  /**
   * One unreachable portal must not hide the others, so a failure becomes that source's summary
   * rather than the whole request's error.
   */
  public async summarizeSources(): Promise<SourceSummary[]> {
    const sources = await this.sourcesStorage.loadSources();
    const checkedAt = new Date().toISOString();

    return Promise.all(
      sources.map(async (source) => {
        if (isDirectSource(source)) {
          return buildOnDemandSummary(source, checkedAt);
        }
        try {
          const deltas = await this.inspectSource(source);
          return {
            sourceId: source.id,
            datasetSlug: source.datasetSlug,
            title: source.title,
            status: deriveSourceBadge(deltas),
            totalResources: deltas.length,
            pendingCount: countPendingResources(deltas),
            checkedAt,
          } satisfies SourceSummary;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "No se pudo consultar el catálogo.";
          return buildErrorSummary(source.id, source.datasetSlug, source.title, message, checkedAt);
        }
      })
    );
  }

  /** Builds the catalogue tree, filtered to the formats the requesting tool can ingest. */
  public async buildCatalog(
    formatFilter: CatalogFormatFilter = CatalogFormatFilter.ALL
  ): Promise<CatalogSourceGroup[]> {
    const sources = await this.sourcesStorage.loadSources();

    const groups = await Promise.all(
      sources.map(async (source): Promise<CatalogSourceGroup | null> => {
        if (isDirectSource(source)) {
          return matchesFormatFilter(DIRECT_CATALOG_FORMAT, formatFilter)
            ? toDirectCatalogGroup(source)
            : null;
        }
        try {
          const [ckanPackage, storedMeta] = await Promise.all([
            this.portal.fetchPackage(source.datasetSlug, source.portalHost),
            this.vault.readAllMeta(source.datasetSlug),
          ]);

          const resources = ckanPackage.resources.reduce<CatalogResourceItem[]>(
            (accepted, resource) => {
              if (matchesFormatFilter(resource.format, formatFilter)) {
                accepted.push(toCatalogResourceItem(resource, storedMeta.has(resource.id)));
              }
              return accepted;
            },
            []
          );

          return {
            sourceId: source.id,
            datasetSlug: source.datasetSlug,
            title: source.title,
            description: source.description,
            resources,
          };
        } catch {
          // A source that cannot be read contributes nothing rather than failing the tree.
          return null;
        }
      })
    );

    return groups.filter((group): group is CatalogSourceGroup => group !== null);
  }

  /**
   * The file behind a catalogue entry, with the name it is served under. A direct source is
   * downloaded and validated on every call and never touches the vault.
   */
  public async getCatalogFile(
    datasetSlug: string,
    resourceId: string
  ): Promise<{ filename: string; content: Buffer }> {
    const sources = await this.sourcesStorage.loadSources();
    const directSource = sources.find(
      (source) => isDirectSource(source) && source.datasetSlug === datasetSlug
    );

    if (directSource) {
      return this.downloadDirectSource(directSource, resourceId);
    }

    const { meta, content } = await this.getResourceFile(datasetSlug, resourceId);
    return {
      filename: meta.relativeFilePath.slice(meta.relativeFilePath.lastIndexOf("/") + 1),
      content,
    };
  }

  private async downloadDirectSource(
    source: WatchedSource,
    resourceId: string
  ): Promise<{ filename: string; content: Buffer }> {
    if (resourceId !== source.id || !source.directUrl) {
      throw new Error(
        `El recurso "${resourceId}" no figura en la fuente "${source.datasetSlug}".`
      );
    }

    const { content } = await this.directDownloader.downloadShapefileZip(source.directUrl);
    return { filename: `${source.id}${DIRECT_ZIP_EXTENSION}`, content };
  }

  /**
   * Returns a resource's bytes, fetching and caching them when the local copy is missing or stale.
   *
   * The cheap half of the check still happens every time: comparing published metadata against the
   * sidecar costs one small request, while serving a superseded file would silently hand the sync
   * tools yesterday's cartography. What the vault saves is the expensive half — the file transfer.
   */
  public async getResourceFile(
    datasetSlug: string,
    resourceId: string
  ): Promise<{ meta: VaultResourceMeta; content: Buffer }> {
    const source = await this.resolveSource(datasetSlug);
    const [ckanPackage, cached] = await Promise.all([
      this.portal.fetchPackage(source.datasetSlug, source.portalHost),
      this.vault.readResource(source.datasetSlug, resourceId),
    ]);

    const resource = ckanPackage.resources.find((candidate) => candidate.id === resourceId);
    if (!resource) {
      throw new Error(
        `El recurso "${resourceId}" ya no figura en el conjunto de datos "${datasetSlug}".`
      );
    }

    if (cached && evaluateResourceDelta(resource, cached.meta).status === DeltaStatus.UP_TO_DATE) {
      return cached;
    }

    const content = await this.portal.downloadResource(resource.url);
    const meta = await this.vault.writeResource(source.datasetSlug, resource, content);

    return { meta, content };
  }

  /** Fetches a resource from the portal and stores it, replacing any cached copy. */
  public async downloadResource(
    datasetSlug: string,
    resourceId: string
  ): Promise<{ meta: VaultResourceMeta; content: Buffer }> {
    const source = await this.resolveSource(datasetSlug);
    const ckanPackage = await this.portal.fetchPackage(source.datasetSlug, source.portalHost);
    const resource = ckanPackage.resources.find((candidate) => candidate.id === resourceId);

    if (!resource) {
      throw new Error(
        `El recurso "${resourceId}" ya no figura en el conjunto de datos "${datasetSlug}".`
      );
    }

    const content = await this.portal.downloadResource(resource.url);
    const meta = await this.vault.writeResource(source.datasetSlug, resource, content);

    return { meta, content };
  }

  /**
   * Finds a watched source by its dataset slug, falling back to treating the slug as a portal
   * reference so a resource can be fetched from a dataset that is not being watched.
   */
  private async resolveSource(datasetSlug: string): Promise<WatchedSource> {
    const sources = await this.sourcesStorage.loadSources();
    const watched = sources.find((source) => source.datasetSlug === datasetSlug);

    if (watched) {
      return watched;
    }

    const { portalHost, datasetSlug: parsedSlug } = parsePortalReference(datasetSlug);
    return {
      id: sanitizeSlug(parsedSlug),
      title: formatTitleFromSlug(parsedSlug),
      datasetSlug: parsedSlug,
      portalHost,
      isDefault: false,
    };
  }

  private assertDirectUrlIsFree(
    sources: ReadonlyArray<WatchedSource>,
    url: string,
    exceptSourceId?: string
  ): void {
    const collision = findSourceWithDirectUrl(sources, url, exceptSourceId);
    if (collision) {
      throw new Error(`Esa URL ya pertenece a la fuente vigilada "${collision.title}".`);
    }
  }

  /**
   * Refuses a portal reference that already belongs to another watched source.
   */
  private assertReferenceIsFree(
    sources: ReadonlyArray<WatchedSource>,
    portalHost: string,
    datasetSlug: string,
    exceptSourceId?: string
  ): void {
    const collision = sources.find(
      (source) =>
        (exceptSourceId === undefined || source.id !== exceptSourceId) &&
        source.portalHost.toLowerCase() === portalHost.toLowerCase() &&
        source.datasetSlug.toLowerCase() === datasetSlug.toLowerCase()
    );
    if (collision) {
      throw new Error(
        `Ya existe una fuente vigilada para el conjunto "${datasetSlug}" en "${portalHost}".`
      );
    }
  }
}
