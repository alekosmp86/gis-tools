import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { CkanPortalClient } from "@/modules/cartography-watcher/services/CkanPortalClient";
import { VaultStorageService } from "@/modules/cartography-watcher/services/VaultStorageService";
import { WatchedSourcesStorageService } from "@/modules/cartography-watcher/services/WatchedSourcesStorageService";
import { WatcherOrchestrator } from "@/modules/cartography-watcher/services/WatcherOrchestrator";
import { createWatcherHandlers } from "@/modules/cartography-watcher/api/handlers";
import {
  CatalogFormatFilter,
  SourceBadgeState,
  VaultRenameResult,
} from "@/modules/cartography-watcher/types";
import type { CkanPackage } from "@/modules/cartography-watcher/types";

/**
 * The portal is replaced by a fake and the vault by a temporary directory, so the whole
 * orchestration is exercised without a network or a shared disk. Nothing here is a mock of our own
 * logic: only the two boundaries the module does not own are stood in for.
 */

const DEFAULT_SLUG = "ide-ejes-vias-circulacion";

let vaultRoot: string;

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "watcher-orch-"));
});

afterEach(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

function buildPackage(overrides: Partial<CkanPackage> = {}): CkanPackage {
  return {
    id: "pkg-1",
    name: DEFAULT_SLUG,
    title: "Ejes de vias de circulacion",
    metadata_modified: "2026-09-03T12:58:02.000Z",
    resources: [
      {
        id: "res-csv",
        name: "Ejes - FLORES",
        format: "CSV",
        url: "https://catalogodatos.gub.uy/download/flores.csv",
        hash: "hash-csv",
        last_modified: "2026-09-01T10:00:00.000Z",
        size: 1200,
      },
      {
        id: "res-zip",
        name: "Ejes - FLORES SHP",
        format: "ZIP",
        url: "https://catalogodatos.gub.uy/download/flores.zip",
        hash: "hash-zip",
        last_modified: "2026-09-01T10:00:00.000Z",
        size: 3400,
      },
    ],
    ...overrides,
  };
}

/** Records every URL it is asked for, so caching can be asserted by counting portal calls. */
class FakePortal {
  public readonly requestedUrls: string[] = [];
  private readonly packagesBySlug: Map<string, CkanPackage | Error>;
  private readonly fileContent: Buffer;

  constructor(
    packagesBySlug: Map<string, CkanPackage | Error>,
    fileContent = Buffer.from("id,nombre\n1,Flores")
  ) {
    this.packagesBySlug = packagesBySlug;
    this.fileContent = fileContent;
  }

  public buildClient(): CkanPortalClient {
    const client = new CkanPortalClient();

    client.fetchPackage = async (datasetSlug: string) => {
      this.requestedUrls.push(`package:${datasetSlug}`);
      const entry = this.packagesBySlug.get(datasetSlug);
      if (entry === undefined) {
        throw new Error(`El catalogo no publica "${datasetSlug}".`);
      }
      if (entry instanceof Error) {
        throw entry;
      }
      return entry;
    };

    client.downloadResource = async (resourceUrl: string) => {
      this.requestedUrls.push(`download:${resourceUrl}`);
      return this.fileContent;
    };

    return client;
  }
}

function buildOrchestrator(portal: FakePortal): WatcherOrchestrator {
  return new WatcherOrchestrator(
    portal.buildClient(),
    new VaultStorageService(vaultRoot),
    new WatchedSourcesStorageService(vaultRoot)
  );
}

function buildDefaultPortal(): FakePortal {
  return new FakePortal(
    new Map<string, CkanPackage | Error>([
      [DEFAULT_SLUG, buildPackage()],
      ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
    ])
  );
}

describe("WatcherOrchestrator: inspection and summaries", () => {
  it("should report every resource as pending before anything is downloaded", async () => {
    // Arrange
    const orchestrator = buildOrchestrator(buildDefaultPortal());
    const [source] = await orchestrator.listSources();

    // Act
    const deltas = await orchestrator.inspectSource(source);

    // Assert
    expect(deltas).toHaveLength(2);
    expect(deltas.every((delta) => delta.localMeta === null)).toBe(true);
  });

  it("should stop reporting a resource as pending once it is in the vault", async () => {
    // Arrange
    const orchestrator = buildOrchestrator(buildDefaultPortal());
    await orchestrator.downloadResource(DEFAULT_SLUG, "res-csv");
    const [source] = await orchestrator.listSources();

    // Act
    const deltas = await orchestrator.inspectSource(source);
    const summaries = await orchestrator.summarizeSources();

    // Assert
    expect(deltas.filter((delta) => delta.localMeta !== null)).toHaveLength(1);
    expect(summaries[0].pendingCount).toBe(1);
    expect(summaries[0].status).toBe(SourceBadgeState.NOT_DOWNLOADED);
  });

  it("should report a source as up to date only once nothing is pending", async () => {
    // Arrange
    const orchestrator = buildOrchestrator(buildDefaultPortal());
    await orchestrator.downloadResource(DEFAULT_SLUG, "res-csv");
    await orchestrator.downloadResource(DEFAULT_SLUG, "res-zip");

    // Act
    const summaries = await orchestrator.summarizeSources();

    // Assert
    expect(summaries[0].pendingCount).toBe(0);
    expect(summaries[0].status).toBe(SourceBadgeState.UP_TO_DATE);
  });

  it("should let one unreachable source fail without hiding the others", async () => {
    // Arrange: a portal outage on one dataset must not blank the whole dashboard.
    const portal = new FakePortal(
      new Map<string, CkanPackage | Error>([
        [DEFAULT_SLUG, new Error("El catalogo respondio 503.")],
        ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
      ])
    );
    const orchestrator = buildOrchestrator(portal);

    // Act
    const summaries = await orchestrator.summarizeSources();

    // Assert
    expect(summaries).toHaveLength(2);
    expect(summaries[0].status).toBe(SourceBadgeState.ERROR);
    expect(summaries[0].errorMessage).toContain("503");
    expect(summaries[1].status).toBe(SourceBadgeState.UP_TO_DATE);
  });
});

describe("WatcherOrchestrator: catalogue", () => {
  it("should offer only the formats the requesting tool can ingest", async () => {
    // Arrange
    const orchestrator = buildOrchestrator(buildDefaultPortal());

    // Act
    const csvGroups = await orchestrator.buildCatalog(CatalogFormatFilter.CSV);
    const shpGroups = await orchestrator.buildCatalog(CatalogFormatFilter.SHP);

    // Assert
    expect(csvGroups[0].resources.map((resource) => resource.id)).toEqual(["res-csv"]);
    expect(shpGroups[0].resources.map((resource) => resource.id)).toEqual(["res-zip"]);
  });

  it("should mark a resource as cached once it is in the vault", async () => {
    // Arrange
    const orchestrator = buildOrchestrator(buildDefaultPortal());

    // Act
    const before = await orchestrator.buildCatalog(CatalogFormatFilter.CSV);
    await orchestrator.downloadResource(DEFAULT_SLUG, "res-csv");
    const after = await orchestrator.buildCatalog(CatalogFormatFilter.CSV);

    // Assert
    expect(before[0].resources[0].isCached).toBe(false);
    expect(after[0].resources[0].isCached).toBe(true);
  });

  it("should drop a source it cannot read rather than failing the whole tree", async () => {
    // Arrange
    const portal = new FakePortal(
      new Map<string, CkanPackage | Error>([
        [DEFAULT_SLUG, new Error("sin respuesta")],
        ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
      ])
    );

    // Act
    const groups = await buildOrchestrator(portal).buildCatalog(CatalogFormatFilter.ALL);

    // Assert
    expect(groups).toHaveLength(1);
    expect(groups[0].datasetSlug).toBe("ide-direcciones-geograficas-del-uruguay");
  });
});

describe("WatcherOrchestrator: read-through cache", () => {
  it("should fetch a resource from the portal on first request", async () => {
    // Arrange
    const portal = buildDefaultPortal();
    const orchestrator = buildOrchestrator(portal);

    // Act
    const { content } = await orchestrator.getResourceFile(DEFAULT_SLUG, "res-csv");

    // Assert
    expect(content.toString()).toContain("Flores");
    expect(portal.requestedUrls.filter((url) => url.startsWith("download:"))).toHaveLength(1);
  });

  it("should not transfer the file again when the cached copy is still current", async () => {
    // Arrange: the vault exists to avoid re-transferring 20-100 MB, which is what is asserted here.
    // Metadata is still re-read each time, cheaply, so a superseded file is never served.
    const portal = buildDefaultPortal();
    const orchestrator = buildOrchestrator(portal);
    await orchestrator.getResourceFile(DEFAULT_SLUG, "res-csv");

    // Act
    await orchestrator.getResourceFile(DEFAULT_SLUG, "res-csv");

    // Assert
    expect(portal.requestedUrls.filter((url) => url.startsWith("download:"))).toHaveLength(1);
  });

  it("should re-fetch a cached copy the portal has since superseded", async () => {
    // Arrange: serving a stale file would silently hand the sync tools yesterday's cartography.
    const packages = new Map<string, CkanPackage | Error>([
      [DEFAULT_SLUG, buildPackage()],
      ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
    ]);
    const portal = new FakePortal(packages);
    const orchestrator = buildOrchestrator(portal);
    await orchestrator.getResourceFile(DEFAULT_SLUG, "res-csv");

    // Act: the portal republishes the resource under a new checksum.
    const republished = buildPackage();
    packages.set(DEFAULT_SLUG, {
      ...republished,
      resources: republished.resources.map((resource) =>
        resource.id === "res-csv" ? { ...resource, hash: "hash-nuevo" } : resource
      ),
    });
    await orchestrator.getResourceFile(DEFAULT_SLUG, "res-csv");

    // Assert
    expect(portal.requestedUrls.filter((url) => url.startsWith("download:"))).toHaveLength(2);
  });

  it("should re-fetch when a download is explicitly requested", async () => {
    // Arrange
    const portal = buildDefaultPortal();
    const orchestrator = buildOrchestrator(portal);
    await orchestrator.getResourceFile(DEFAULT_SLUG, "res-csv");

    // Act
    await orchestrator.downloadResource(DEFAULT_SLUG, "res-csv");

    // Assert
    expect(portal.requestedUrls.filter((url) => url.startsWith("download:"))).toHaveLength(2);
  });

  it("should refuse a resource the dataset no longer publishes", async () => {
    // Arrange
    const orchestrator = buildOrchestrator(buildDefaultPortal());

    // Act & Assert
    await expect(orchestrator.downloadResource(DEFAULT_SLUG, "res-ausente")).rejects.toThrow(
      /ya no figura/
    );
  });
});

describe("WatcherOrchestrator: sources", () => {
  it("should confirm a source with the portal before persisting it", async () => {
    // Arrange: saving an unreachable source would only fail later, and less clearly.
    const orchestrator = buildOrchestrator(buildDefaultPortal());

    // Act & Assert
    await expect(orchestrator.addSource("conjunto-inexistente")).rejects.toThrow(
      /no publica/
    );
    expect(await orchestrator.listSources()).toHaveLength(2);
  });

  it("should take the title the portal publishes when adding a source", async () => {
    // Arrange
    const portal = new FakePortal(
      new Map<string, CkanPackage | Error>([
        [DEFAULT_SLUG, buildPackage()],
        ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
        ["otro-conjunto", buildPackage({ title: "Titulo publicado" })],
      ])
    );
    const orchestrator = buildOrchestrator(portal);

    // Act
    const sources = await orchestrator.addSource(
      "https://catalogodatos.gub.uy/dataset/otro-conjunto"
    );

    // Assert
    const added = sources.find((source) => source.datasetSlug === "otro-conjunto");
    expect(added?.title).toBe("Titulo publicado");
    expect(added?.isDefault).toBe(false);
  });

  it("should refuse adding a source whose portal reference already belongs to a watched source", async () => {
    // Arrange
    const orchestrator = buildOrchestrator(buildDefaultPortal());

    // Act & Assert
    await expect(
      orchestrator.addSource("https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion")
    ).rejects.toThrow(/Ya existe una fuente vigilada para el conjunto/);
  });

  it("should refuse adding a source that collides with an edited default's slug or id", async () => {
    // Arrange
    const portal = new FakePortal(
      new Map<string, CkanPackage | Error>([
        [DEFAULT_SLUG, buildPackage()],
        ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
        ["padron-rural", buildPackage({ name: "padron-rural", title: "Padrón Rural" })],
      ])
    );
    const orchestrator = buildOrchestrator(portal);

    // Act 1: Edit default #1 to 'padron-rural'
    await orchestrator.updateSource(DEFAULT_SLUG, "padron-rural");

    // Act 2 & Assert: Attempt to add original default slug back -> refuses by derived id collision
    await expect(
      orchestrator.addSource("https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion")
    ).rejects.toThrow(/Ya existe una fuente vigilada con identificador "ide-ejes-vias-circulacion"/);

    // Act 3 & Assert: Attempt to add 'padron-rural' again -> refuses by datasetSlug collision
    await expect(
      orchestrator.addSource("https://catalogodatos.gub.uy/dataset/padron-rural")
    ).rejects.toThrow(/Ya existe una fuente vigilada para el conjunto "padron-rural"/);

    // Act 4 & Assert: Verify loadSources / listSources still has edited default
    const sources = await orchestrator.listSources();
    const defaultRow = sources.find((source) => source.id === DEFAULT_SLUG);
    expect(defaultRow?.datasetSlug).toBe("padron-rural");
    expect(defaultRow?.isDefault).toBe(true);
  });

  it("should keep the source id when its portal reference changes", async () => {
    // Arrange
    const portal = new FakePortal(
      new Map<string, CkanPackage | Error>([
        [DEFAULT_SLUG, buildPackage()],
        ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
        ["nuevo-slug", buildPackage({ name: "nuevo-slug", title: "Nuevo Titulo" })],
      ])
    );
    const orchestrator = buildOrchestrator(portal);

    // Act
    const updated = await orchestrator.updateSource(
      DEFAULT_SLUG,
      "https://catalogodatos.gub.uy/dataset/nuevo-slug"
    );

    // Assert
    const source = updated.find((entry) => entry.id === DEFAULT_SLUG);
    expect(source?.datasetSlug).toBe("nuevo-slug");
    expect(source?.id).toBe(DEFAULT_SLUG);
  });

  it("should refresh the title and description from the portal when a source is edited", async () => {
    // Arrange
    const portal = new FakePortal(
      new Map<string, CkanPackage | Error>([
        [DEFAULT_SLUG, buildPackage()],
        ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
        [
          "nuevo-slug",
          buildPackage({
            name: "nuevo-slug",
            title: "Titulo Refrescado Desde Portal",
            notes: "Notas del portal",
          }),
        ],
        [
          "sin-notas",
          buildPackage({
            name: "sin-notas",
            title: "Titulo Sin Notas",
            notes: undefined,
          }),
        ],
      ])
    );
    const orchestrator = buildOrchestrator(portal);

    // Act 1: edit with notes present
    const updatedWithNotes = await orchestrator.updateSource(DEFAULT_SLUG, "nuevo-slug");
    const sourceWithNotes = updatedWithNotes.find((entry) => entry.id === DEFAULT_SLUG);
    expect(sourceWithNotes?.title).toBe("Titulo Refrescado Desde Portal");
    expect(sourceWithNotes?.description).toBe("Notas del portal");

    // Act 2: edit with notes absent -> falls back to empty string and overrides default
    const updatedWithoutNotes = await orchestrator.updateSource(DEFAULT_SLUG, "sin-notas");
    const sourceWithoutNotes = updatedWithoutNotes.find((entry) => entry.id === DEFAULT_SLUG);
    expect(sourceWithoutNotes?.title).toBe("Titulo Sin Notas");
    expect(sourceWithoutNotes?.description).toBe("");

    const reloaded = await orchestrator.listSources();
    const reloadedDefault = reloaded.find((entry) => entry.id === DEFAULT_SLUG);
    expect(reloadedDefault?.description).toBe("");
  });

  it("should refuse an edit whose reference the portal cannot resolve, leaving the stored row untouched", async () => {
    // Arrange
    const orchestrator = buildOrchestrator(buildDefaultPortal());

    // Act & Assert
    await expect(orchestrator.updateSource(DEFAULT_SLUG, "slug-inexistente")).rejects.toThrow(
      /no publica/
    );
    const sources = await orchestrator.listSources();
    const source = sources.find((entry) => entry.id === DEFAULT_SLUG);
    expect(source?.datasetSlug).toBe(DEFAULT_SLUG);
  });

  it("should refuse an edit that collides with another watched source", async () => {
    // Arrange
    const orchestrator = buildOrchestrator(buildDefaultPortal());

    // Act & Assert
    await expect(
      orchestrator.updateSource(DEFAULT_SLUG, "ide-direcciones-geograficas-del-uruguay")
    ).rejects.toThrow(/Ya existe una fuente vigilada/);
  });

  it("should refuse an edit naming a source that is not watched", async () => {
    // Arrange
    const orchestrator = buildOrchestrator(buildDefaultPortal());

    // Act & Assert
    await expect(orchestrator.updateSource("fuente-inexistente", "nuevo-slug")).rejects.toThrow(
      /No se encontró la fuente vigilada/
    );
  });

  it("should persist an edit to a shipped default while still refusing to remove it", async () => {
    // Arrange
    const portal = new FakePortal(
      new Map<string, CkanPackage | Error>([
        [DEFAULT_SLUG, buildPackage()],
        ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
        ["slug-modificado", buildPackage({ name: "slug-modificado", title: "Ejes Actualizados" })],
      ])
    );
    const orchestrator = buildOrchestrator(portal);

    // Act
    await orchestrator.updateSource(DEFAULT_SLUG, "slug-modificado");
    const reloadedSources = await orchestrator.listSources();
    const editedDefault = reloadedSources.find((entry) => entry.id === DEFAULT_SLUG);

    // Assert
    expect(editedDefault?.datasetSlug).toBe("slug-modificado");
    expect(editedDefault?.isDefault).toBe(true);
    await expect(orchestrator.removeSource(DEFAULT_SLUG)).rejects.toThrow(
      /viene incluida con el módulo/
    );
  });

  it("should carry the vault directory over when the dataset slug changes", async () => {
    // Arrange
    const portal = new FakePortal(
      new Map<string, CkanPackage | Error>([
        [DEFAULT_SLUG, buildPackage()],
        ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
        ["nuevo-slug", buildPackage({ name: "nuevo-slug", title: "Nuevo Slug" })],
      ])
    );
    const vault = new VaultStorageService(vaultRoot);
    await vault.writeResource(
      DEFAULT_SLUG,
      {
        id: "res-1",
        name: "test.csv",
        format: "CSV",
        url: "http://example.com/test.csv",
      },
      Buffer.from("datos")
    );
    const orchestrator = new WatcherOrchestrator(
      portal.buildClient(),
      vault,
      new WatchedSourcesStorageService(vaultRoot)
    );

    // Act
    await orchestrator.updateSource(DEFAULT_SLUG, "nuevo-slug");

    // Assert
    expect(fs.existsSync(path.join(vaultRoot, DEFAULT_SLUG))).toBe(false);
    expect(fs.existsSync(path.join(vaultRoot, "nuevo-slug"))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, "nuevo-slug", "test.csv"))).toBe(true);
  });

  it("should leave both directories alone when the destination vault directory already exists", async () => {
    // Arrange
    const portal = new FakePortal(
      new Map<string, CkanPackage | Error>([
        [DEFAULT_SLUG, buildPackage()],
        ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
        ["nuevo-slug", buildPackage({ name: "nuevo-slug", title: "Nuevo Slug" })],
      ])
    );
    const vault = new VaultStorageService(vaultRoot);
    await vault.writeResource(
      DEFAULT_SLUG,
      {
        id: "res-1",
        name: "test1.csv",
        format: "CSV",
        url: "http://example.com/test1.csv",
      },
      Buffer.from("datos1")
    );
    await vault.writeResource(
      "nuevo-slug",
      {
        id: "res-2",
        name: "test2.csv",
        format: "CSV",
        url: "http://example.com/test2.csv",
      },
      Buffer.from("datos2")
    );
    const orchestrator = new WatcherOrchestrator(
      portal.buildClient(),
      vault,
      new WatchedSourcesStorageService(vaultRoot)
    );

    // Act
    await orchestrator.updateSource(DEFAULT_SLUG, "nuevo-slug");

    // Assert
    expect(fs.existsSync(path.join(vaultRoot, DEFAULT_SLUG))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, "nuevo-slug"))).toBe(true);
  });

  it("should abort update and leave sources untouched when vault rename fails", async () => {
    // Arrange
    const portal = new FakePortal(
      new Map<string, CkanPackage | Error>([
        [DEFAULT_SLUG, buildPackage()],
        ["ide-direcciones-geograficas-del-uruguay", buildPackage({ resources: [] })],
        ["nuevo-slug", buildPackage({ name: "nuevo-slug", title: "Nuevo Slug" })],
      ])
    );
    const vault = new VaultStorageService(vaultRoot);
    const orchestrator = new WatcherOrchestrator(
      portal.buildClient(),
      vault,
      new WatchedSourcesStorageService(vaultRoot)
    );

    vi.spyOn(vault, "renameSourceDir").mockResolvedValueOnce(VaultRenameResult.FAILED);

    // Act & Assert
    await expect(orchestrator.updateSource(DEFAULT_SLUG, "nuevo-slug")).rejects.toThrow(
      /No se pudo renombrar el directorio del vault para "nuevo-slug"/
    );

    const sources = await orchestrator.listSources();
    const source = sources.find((entry) => entry.id === DEFAULT_SLUG);
    expect(source?.datasetSlug).toBe(DEFAULT_SLUG);
  });
});

describe("watcher HTTP handlers", () => {
  function buildRequest(url: string, body?: unknown): Request {
    return body === undefined
      ? new Request(url)
      : new Request(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
  }

  it("should list sources as a successful envelope", async () => {
    // Arrange
    const handlers = createWatcherHandlers(buildOrchestrator(buildDefaultPortal()));

    // Act
    const response = await handlers.listSources(buildRequest("http://localhost/sources"));
    const payload = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.sources).toHaveLength(2);
  });

  it("should reject adding a source with no url instead of guessing one", async () => {
    // Arrange
    const handlers = createWatcherHandlers(buildOrchestrator(buildDefaultPortal()));

    // Act
    const response = await handlers.addSource(buildRequest("http://localhost/sources", {}));

    // Assert
    expect(response.status).toBe(400);
    expect((await response.json()).success).toBe(false);
  });

  it("should report a portal failure as a server error, not as an empty success", async () => {
    // Arrange
    const handlers = createWatcherHandlers(buildOrchestrator(buildDefaultPortal()));

    // Act
    const response = await handlers.addSource(
      buildRequest("http://localhost/sources", { url: "conjunto-inexistente" })
    );

    // Assert
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("no publica");
  });

  it("should reject removing a source with no identifier", async () => {
    // Arrange
    const handlers = createWatcherHandlers(buildOrchestrator(buildDefaultPortal()));

    // Act
    const response = await handlers.removeSource(
      buildRequest("http://localhost/sources/remove", {})
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("should reject an update with no sourceId", async () => {
    // Arrange
    const handlers = createWatcherHandlers(buildOrchestrator(buildDefaultPortal()));

    // Act
    const response = await handlers.updateSource(
      buildRequest("http://localhost/sources/update", { url: "algun-slug" })
    );

    // Assert
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("sourceId");
  });

  it("should reject an update with no url", async () => {
    // Arrange
    const handlers = createWatcherHandlers(buildOrchestrator(buildDefaultPortal()));

    // Act
    const response = await handlers.updateSource(
      buildRequest("http://localhost/sources/update", { sourceId: "ide-ejes" })
    );

    // Assert
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("url");
  });

  it("should filter the catalogue by the requested format", async () => {
    // Arrange
    const handlers = createWatcherHandlers(buildOrchestrator(buildDefaultPortal()));

    // Act
    const response = await handlers.readCatalog(
      buildRequest("http://localhost/catalog?format=SHP")
    );
    const payload = await response.json();

    // Assert
    expect(payload.groups[0].resources).toHaveLength(1);
    expect(payload.groups[0].resources[0].format).toBe("ZIP");
  });

  it("should serve a catalogue file as a download with its published filename", async () => {
    // Arrange
    const handlers = createWatcherHandlers(buildOrchestrator(buildDefaultPortal()));

    // Act
    const response = await handlers.readCatalogFile(
      buildRequest(
        `http://localhost/catalog/file?dataset=${DEFAULT_SLUG}&resource=res-csv`
      )
    );

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("flores.csv");
    expect(await response.text()).toContain("Flores");
  });

  it("should reject a file request that names no resource", async () => {
    // Arrange
    const handlers = createWatcherHandlers(buildOrchestrator(buildDefaultPortal()));

    // Act
    const response = await handlers.readCatalogFile(
      buildRequest(`http://localhost/catalog/file?dataset=${DEFAULT_SLUG}`)
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("should summarise every source through the endpoint", async () => {
    // Arrange
    const handlers = createWatcherHandlers(buildOrchestrator(buildDefaultPortal()));

    // Act
    const payload = await (
      await handlers.readSummaries(buildRequest("http://localhost/summaries"))
    ).json();

    // Assert
    expect(payload.summaries).toHaveLength(2);
    expect(payload.summaries[0].datasetSlug).toBe(DEFAULT_SLUG);
  });
});

describe("CkanPortalClient", () => {
  it("should reject a portal that answers with an error status", async () => {
    // Arrange
    const client = new CkanPortalClient(async () => new Response("nope", { status: 503 }));

    // Act & Assert
    await expect(client.fetchPackage("cualquiera")).rejects.toThrow(/respondio 503|respondió 503/);
  });

  it("should reject a CKAN payload that reports failure", async () => {
    // Arrange
    const client = new CkanPortalClient(
      async () =>
        new Response(JSON.stringify({ success: false, error: { message: "No encontrado" } }), {
          status: 200,
        })
    );

    // Act & Assert
    await expect(client.fetchPackage("cualquiera")).rejects.toThrow(/No encontrado/);
  });

  it("should return the package when the portal answers normally", async () => {
    // Arrange
    const client = new CkanPortalClient(
      async () =>
        new Response(JSON.stringify({ success: true, result: buildPackage() }), { status: 200 })
    );

    // Act
    const ckanPackage = await client.fetchPackage(DEFAULT_SLUG);

    // Assert
    expect(ckanPackage.resources).toHaveLength(2);
  });

  it("should request the dataset from the host it is given", async () => {
    // Arrange
    const requestedUrls: string[] = [];
    const client = new CkanPortalClient(async (url) => {
      requestedUrls.push(url);
      return new Response(JSON.stringify({ success: true, result: buildPackage() }), {
        status: 200,
      });
    });

    // Act
    await client.fetchPackage("un-conjunto", "datos.example.org");

    // Assert
    expect(requestedUrls[0]).toBe(
      "https://datos.example.org/api/3/action/package_show?id=un-conjunto"
    );
  });

  it("should refuse to download a resource with no url", async () => {
    // Arrange
    const client = new CkanPortalClient(async () => new Response("x", { status: 200 }));

    // Act & Assert
    await expect(client.downloadResource("")).rejects.toThrow(/no publica una URL/);
  });

  it("should report a failed download with its status", async () => {
    // Arrange
    const client = new CkanPortalClient(async () => new Response("x", { status: 404 }));

    // Act & Assert
    await expect(client.downloadResource("https://example.org/f.csv")).rejects.toThrow(/404/);
  });
});
