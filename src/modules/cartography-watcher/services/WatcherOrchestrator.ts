import {
  buildErrorSummary,
  deriveSourceBadge,
  matchesFormatFilter,
  toCatalogResourceItem,
} from "../domain/catalogMapping";
import { countPendingResources, evaluateResourceDelta } from "../domain/deltaEvaluation";
import { CatalogFormatFilter, DeltaStatus, VaultRenameResult } from "../types";
import { formatTitleFromSlug, parsePortalReference, sanitizeSlug } from "../domain/sourceNaming";
import { sourceNotFoundMessage } from "../domain/sourceOverrides";
import { CkanPortalClient } from "./CkanPortalClient";
import { VaultStorageService } from "./VaultStorageService";
import { WatchedSourcesStorageService } from "./WatchedSourcesStorageService";
import type {
  CatalogResourceItem,
  CatalogSourceGroup,
  ResourceDelta,
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

  constructor(
    portal: CkanPortalClient = new CkanPortalClient(),
    vault: VaultStorageService = new VaultStorageService(),
    sourcesStorage: WatchedSourcesStorageService = new WatchedSourcesStorageService()
  ) {
    this.portal = portal;
    this.vault = vault;
    this.sourcesStorage = sourcesStorage;
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
