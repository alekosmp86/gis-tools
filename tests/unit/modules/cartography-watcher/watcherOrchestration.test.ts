import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { CkanPortalClient } from "@/modules/cartography-watcher/services/CkanPortalClient";
import { VaultStorageService } from "@/modules/cartography-watcher/services/VaultStorageService";
import { WatchedSourcesStorageService } from "@/modules/cartography-watcher/services/WatchedSourcesStorageService";
import { WatcherOrchestrator } from "@/modules/cartography-watcher/services/WatcherOrchestrator";
import { createWatcherHandlers } from "@/modules/cartography-watcher/api/handlers";
import {
  CatalogFormatFilter,
  SourceBadgeState,
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
