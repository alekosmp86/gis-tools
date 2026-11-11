import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CkanPortalClient } from "@/modules/cartography-watcher/services/CkanPortalClient";
import { DirectUrlDownloader } from "@/modules/cartography-watcher/services/DirectUrlDownloader";
import { VaultStorageService } from "@/modules/cartography-watcher/services/VaultStorageService";
import { WatchedSourcesStorageService } from "@/modules/cartography-watcher/services/WatchedSourcesStorageService";
import { WatcherOrchestrator } from "@/modules/cartography-watcher/services/WatcherOrchestrator";
import { createWatcherHandlers } from "@/modules/cartography-watcher/api/handlers";
import {
  MISSING_PRJ_WARNING,
  ON_DEMAND_LABEL,
} from "@/modules/cartography-watcher/constants";
import {
  buildOnDemandSummary,
  toDirectCatalogGroup,
} from "@/modules/cartography-watcher/domain/catalogMapping";
import {
  CatalogFormatFilter,
  SourceBadgeState,
  WatchedSourceKind,
} from "@/modules/cartography-watcher/types";
import type { CkanPackage, WatchedSource } from "@/modules/cartography-watcher/types";
import { buildShapefileZip, buildZip } from "./support/zipFixtures";

const ANEP_URL =
  "https://mapas.ide.uy/geoserver-vectorial/INE_NO_SEGURO_CLON_NS/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=INE_NO_SEGURO_CLON_NS:centros_anep_2&outputFormat=SHAPE-ZIP";
const OTHER_URL = "https://otro.example/wfs?layer=2";
const DEFAULT_SLUG = "ide-ejes-vias-circulacion";
const TITLE = "Centros ANEP";
const DIRECT_ID = "centros_anep";

let vaultRoot: string;

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "watcher-direct-"));
});

afterEach(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

interface Harness {
  orchestrator: WatcherOrchestrator;
  fetchFn: ReturnType<typeof vi.fn>;
  portalCalls: string[];
  vault: VaultStorageService;
}

function buildHarness(responder: (url: string) => Response | Promise<Response>): Harness {
  const portalCalls: string[] = [];
  const portal = new CkanPortalClient();
  const pkg: CkanPackage = {
    id: "p",
    name: DEFAULT_SLUG,
    title: "Ejes",
    metadata_modified: "2026-01-01T00:00:00.000Z",
    resources: [
      {
        id: "res-csv",
        name: "Ejes",
        format: "CSV",
        url: "https://catalogodatos.gub.uy/f.csv",
        hash: "h",
        last_modified: "2026-01-01T00:00:00.000Z",
        size: 10,
      },
    ],
  };
  portal.fetchPackage = async (slug: string) => {
    portalCalls.push(`package:${slug}`);
    return { ...pkg, name: slug };
  };
  portal.downloadResource = async (url: string) => {
    portalCalls.push(`download:${url}`);
    return Buffer.from("a,b");
  };

  const fetchFn = vi.fn(async (url: string) => responder(url));
  const vault = new VaultStorageService(vaultRoot);
  const orchestrator = new WatcherOrchestrator(
    portal,
    vault,
    new WatchedSourcesStorageService(vaultRoot),
    new DirectUrlDownloader(fetchFn)
  );
  return { orchestrator, fetchFn, portalCalls, vault };
}

function zipResponder(withPrj = true) {
  return () => new Response(new Uint8Array(buildShapefileZip(withPrj)), { status: 200 });
}

function vaultEntries(): string[] {
  return fs.readdirSync(vaultRoot).sort();
}

function directRow(overrides: Partial<WatchedSource> = {}): WatchedSource {
  return {
    id: DIRECT_ID,
    title: TITLE,
    datasetSlug: DIRECT_ID,
    portalHost: "mapas.ide.uy",
    isDefault: false,
    kind: WatchedSourceKind.DIRECT_URL,
    directUrl: ANEP_URL,
    ...overrides,
  };
}

describe("WatcherOrchestrator.addDirectSource", () => {
  it("should save a direct source with id slug, host and kind after one trial download", async () => {
    const { orchestrator, fetchFn } = buildHarness(zipResponder());

    const result = await orchestrator.addDirectSource(TITLE, ANEP_URL);

    const added = result.sources.find((source) => source.id === DIRECT_ID);
    expect(added).toMatchObject({
      id: DIRECT_ID,
      datasetSlug: DIRECT_ID,
      title: TITLE,
      portalHost: "mapas.ide.uy",
      kind: WatchedSourceKind.DIRECT_URL,
      directUrl: ANEP_URL,
      isDefault: false,
    });
    expect(result.warnings).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("should persist kind and directUrl so a reload still sees a direct source", async () => {
    const { orchestrator } = buildHarness(zipResponder());
    await orchestrator.addDirectSource(TITLE, ANEP_URL);

    const reloaded = (await orchestrator.listSources()).find((source) => source.id === DIRECT_ID);

    expect(reloaded?.kind).toBe(WatchedSourceKind.DIRECT_URL);
    expect(reloaded?.directUrl).toBe(ANEP_URL);
  });

  it("should never write anything to the vault besides sources.json", async () => {
    const { orchestrator } = buildHarness(zipResponder());

    await orchestrator.addDirectSource(TITLE, ANEP_URL);

    expect(vaultEntries()).toEqual(["sources.json"]);
  });

  it("should trim the title and derive the id from it", async () => {
    const { orchestrator } = buildHarness(zipResponder());

    const result = await orchestrator.addDirectSource("  Centros ANEP 2  ", ANEP_URL);

    expect(result.sources.find((s) => s.id === "centros_anep_2")?.title).toBe("Centros ANEP 2");
  });

  it("should return the .prj warning and store it on the row", async () => {
    const { orchestrator } = buildHarness(zipResponder(false));

    const result = await orchestrator.addDirectSource(TITLE, ANEP_URL);

    expect(result.warnings).toEqual([MISSING_PRJ_WARNING]);
    expect(result.sources.find((s) => s.id === DIRECT_ID)?.warnings).toEqual([MISSING_PRJ_WARNING]);
  });

  it.each(["", "   "])("should refuse an empty title %j without downloading", async (title) => {
    const { orchestrator, fetchFn } = buildHarness(zipResponder());

    await expect(orchestrator.addDirectSource(title, ANEP_URL)).rejects.toThrow(/título/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each(["file:///etc/passwd", "ftp://x.example/a.zip", "data:text/plain,x", "nope"])(
    "should refuse bad url %s without downloading or saving",
    async (badUrl) => {
      const { orchestrator, fetchFn } = buildHarness(zipResponder());

      await expect(orchestrator.addDirectSource(TITLE, badUrl)).rejects.toThrow();
      expect(fetchFn).not.toHaveBeenCalled();
      expect(vaultEntries()).toEqual([]);
    }
  );

  it("should refuse a second source with the same id", async () => {
    const { orchestrator } = buildHarness(zipResponder());
    await orchestrator.addDirectSource(TITLE, ANEP_URL);

    await expect(orchestrator.addDirectSource("centros anep", OTHER_URL)).rejects.toThrow(
      /Ya existe una fuente vigilada con identificador "centros_anep"/
    );
  });

  it("should refuse an id that collides with a default source", async () => {
    const { orchestrator } = buildHarness(zipResponder());

    await expect(orchestrator.addDirectSource(DEFAULT_SLUG, ANEP_URL)).rejects.toThrow(
      /Ya existe/
    );
  });

  it("should refuse the same URL registered twice, case-insensitively, without downloading", async () => {
    const { orchestrator, fetchFn } = buildHarness(zipResponder());
    await orchestrator.addDirectSource(TITLE, ANEP_URL);
    fetchFn.mockClear();

    await expect(orchestrator.addDirectSource("Otro titulo", ANEP_URL.toUpperCase())).rejects.toThrow(
      /ya pertenece/
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["HTTP 500", () => new Response("boom", { status: 500 }), /HTTP 500/],
    ["not a zip", () => new Response("<html/>", { status: 200 }), /no devolvió un archivo ZIP/],
    [
      "no shapefile",
      () => new Response(new Uint8Array(buildZip(["a.txt"])), { status: 200 }),
      /ningún shapefile/,
    ],
    [
      "missing dbf",
      () => new Response(new Uint8Array(buildZip(["a.shp", "a.shx"])), { status: 200 }),
      /\.dbf/,
    ],
  ])("should save nothing when the trial download fails: %s", async (_label, responder, pattern) => {
    const { orchestrator } = buildHarness(responder);

    await expect(orchestrator.addDirectSource(TITLE, ANEP_URL)).rejects.toThrow(pattern);
    expect(vaultEntries()).toEqual([]);
    expect((await orchestrator.listSources()).some((s) => s.id === DIRECT_ID)).toBe(false);
  });

  it("should report a connection failure and save nothing", async () => {
    const { orchestrator } = buildHarness(() => {
      throw new TypeError("fetch failed");
    });

    await expect(orchestrator.addDirectSource(TITLE, ANEP_URL)).rejects.toThrow(/No se pudo conectar/);
    expect(vaultEntries()).toEqual([]);
  });
});

describe("WatcherOrchestrator.updateDirectSource", () => {
  async function withDirectSource(withPrj = true) {
    const harness = buildHarness(zipResponder(withPrj));
    await harness.orchestrator.addDirectSource(TITLE, ANEP_URL);
    harness.fetchFn.mockClear();
    return harness;
  }

  it("should change only the title and keep the id when only the title is given", async () => {
    const { orchestrator, fetchFn } = await withDirectSource();

    const result = await orchestrator.updateDirectSource(DIRECT_ID, { title: "Nuevo titulo" });

    const row = result.sources.find((s) => s.id === DIRECT_ID);
    expect(row?.title).toBe("Nuevo titulo");
    expect(row?.datasetSlug).toBe(DIRECT_ID);
    expect(row?.directUrl).toBe(ANEP_URL);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("should not download again when the url is unchanged", async () => {
    const { orchestrator, fetchFn } = await withDirectSource();

    await orchestrator.updateDirectSource(DIRECT_ID, { url: ANEP_URL, title: "Otro" });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("should not download again when the url differs only by surrounding whitespace", async () => {
    const { orchestrator, fetchFn } = await withDirectSource();

    await orchestrator.updateDirectSource(DIRECT_ID, { url: `  ${ANEP_URL}  ` });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("should validate a new url by downloading it once and update url and host", async () => {
    const { orchestrator, fetchFn } = await withDirectSource();

    const result = await orchestrator.updateDirectSource(DIRECT_ID, { url: OTHER_URL });

    const row = result.sources.find((s) => s.id === DIRECT_ID);
    expect(row?.directUrl).toBe(OTHER_URL);
    expect(row?.portalHost).toBe("otro.example");
    expect(row?.id).toBe(DIRECT_ID);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(OTHER_URL);
  });

  it("should replace the stored warnings with the ones of the new url", async () => {
    const harness = buildHarness((url) =>
      new Response(new Uint8Array(buildShapefileZip(url === ANEP_URL)), { status: 200 })
    );
    await harness.orchestrator.addDirectSource(TITLE, ANEP_URL);

    const result = await harness.orchestrator.updateDirectSource(DIRECT_ID, { url: OTHER_URL });

    expect(result.warnings).toEqual([MISSING_PRJ_WARNING]);
    expect(result.sources.find((s) => s.id === DIRECT_ID)?.warnings).toEqual([MISSING_PRJ_WARNING]);
  });

  it("should refuse a url that belongs to another direct source, case-insensitively", async () => {
    const { orchestrator, fetchFn } = await withDirectSource();
    await orchestrator.addDirectSource("Segundo", OTHER_URL);
    fetchFn.mockClear();

    await expect(
      orchestrator.updateDirectSource(DIRECT_ID, { url: OTHER_URL.toUpperCase() })
    ).rejects.toThrow(/ya pertenece/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("should save nothing when the new url fails validation, even if the title changed too", async () => {
    const harness = buildHarness((url) =>
      url === ANEP_URL
        ? new Response(new Uint8Array(buildShapefileZip()), { status: 200 })
        : new Response("not zip", { status: 200 })
    );
    await harness.orchestrator.addDirectSource(TITLE, ANEP_URL);

    await expect(
      harness.orchestrator.updateDirectSource(DIRECT_ID, { title: "Cambiado", url: OTHER_URL })
    ).rejects.toThrow(/ZIP/);

    const row = (await harness.orchestrator.listSources()).find((s) => s.id === DIRECT_ID);
    expect(row?.title).toBe(TITLE);
    expect(row?.directUrl).toBe(ANEP_URL);
  });

  it("should refuse a bad scheme on update without downloading", async () => {
    const { orchestrator, fetchFn } = await withDirectSource();

    await expect(orchestrator.updateDirectSource(DIRECT_ID, { url: "ftp://x/a.zip" })).rejects.toThrow(
      /http/
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("should refuse an empty title", async () => {
    const { orchestrator } = await withDirectSource();

    await expect(orchestrator.updateDirectSource(DIRECT_ID, { title: "  " })).rejects.toThrow(/título/);
  });

  it("should refuse an unknown source id", async () => {
    const { orchestrator } = await withDirectSource();

    await expect(orchestrator.updateDirectSource("nada", { title: "x" })).rejects.toThrow(
      /No se encontró la fuente vigilada/
    );
  });

  it("should refuse to edit a CKAN source as a direct source", async () => {
    const { orchestrator } = await withDirectSource();

    await expect(orchestrator.updateDirectSource(DEFAULT_SLUG, { title: "x" })).rejects.toThrow(
      /no es una URL directa/
    );
  });

  it("should leave the vault untouched", async () => {
    const { orchestrator } = await withDirectSource();

    await orchestrator.updateDirectSource(DIRECT_ID, { url: OTHER_URL, title: "Otro" });

    expect(vaultEntries()).toEqual(["sources.json"]);
  });
});

describe("WatcherOrchestrator.updateSource refusing a direct source", () => {
  it("should refuse to turn a direct source into a CKAN one and not call the portal", async () => {
    const harness = buildHarness(zipResponder());
    await harness.orchestrator.addDirectSource(TITLE, ANEP_URL);

    await expect(harness.orchestrator.updateSource(DIRECT_ID, "otro-slug")).rejects.toThrow(
      /es una URL directa/
    );
    expect(harness.portalCalls).toEqual([]);
    const row = (await harness.orchestrator.listSources()).find((s) => s.id === DIRECT_ID);
    expect(row?.kind).toBe(WatchedSourceKind.DIRECT_URL);
  });
});

describe("WatcherOrchestrator.removeSource for a direct source", () => {
  it("should remove it and leave the vault untouched", async () => {
    const { orchestrator } = buildHarness(zipResponder());
    await orchestrator.addDirectSource(TITLE, ANEP_URL);

    const remaining = await orchestrator.removeSource(DIRECT_ID);

    expect(remaining.some((s) => s.id === DIRECT_ID)).toBe(false);
    expect(vaultEntries()).toEqual(["sources.json"]);
  });
});

describe("WatcherOrchestrator.buildCatalog with a direct source", () => {
  async function withDirect() {
    const harness = buildHarness(zipResponder());
    await harness.orchestrator.addDirectSource(TITLE, ANEP_URL);
    harness.fetchFn.mockClear();
    harness.portalCalls.length = 0;
    return harness;
  }

  it.each([CatalogFormatFilter.ALL, CatalogFormatFilter.SHP])(
    "should list the direct group for the %s filter with one SHP resource",
    async (filter) => {
      const { orchestrator } = await withDirect();

      const group = (await orchestrator.buildCatalog(filter)).find((g) => g.sourceId === DIRECT_ID);

      expect(group?.resources).toEqual([
        {
          id: DIRECT_ID,
          name: `${TITLE}.zip`,
          format: "SHP",
          sizeBytes: null,
          lastModified: null,
          isCached: false,
        },
      ]);
    }
  );

  it("should omit the direct group for the CSV filter", async () => {
    const { orchestrator } = await withDirect();

    const groups = await orchestrator.buildCatalog(CatalogFormatFilter.CSV);

    expect(groups.some((g) => g.sourceId === DIRECT_ID)).toBe(false);
  });

  it("should not call the direct url nor the portal for it when building the catalogue", async () => {
    const { orchestrator, fetchFn, portalCalls } = await withDirect();

    await orchestrator.buildCatalog(CatalogFormatFilter.ALL);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(portalCalls.every((call) => !call.includes(DIRECT_ID))).toBe(true);
  });

  it("should still list the direct group when the service would be down", async () => {
    const harness = buildHarness(() => {
      throw new TypeError("down");
    });
    await harness.orchestrator["sourcesStorage"].addSource(directRow());

    const groups = await harness.orchestrator.buildCatalog(CatalogFormatFilter.SHP);

    expect(groups.some((g) => g.sourceId === DIRECT_ID)).toBe(true);
  });
});

describe("WatcherOrchestrator.summarizeSources with a direct source", () => {
  it("should report ON_DEMAND, 1 resource, 0 pending, without calling the url", async () => {
    const harness = buildHarness(zipResponder());
    await harness.orchestrator.addDirectSource(TITLE, ANEP_URL);
    harness.fetchFn.mockClear();

    const summaries = await harness.orchestrator.summarizeSources();

    const summary = summaries.find((s) => s.sourceId === DIRECT_ID);
    expect(summary).toMatchObject({
      status: SourceBadgeState.ON_DEMAND,
      totalResources: 1,
      pendingCount: 0,
      title: TITLE,
    });
    expect(summary?.errorMessage).toBeUndefined();
    expect(harness.fetchFn).not.toHaveBeenCalled();
  });

  it("should not add to the pending total of the other sources", async () => {
    const harness = buildHarness(zipResponder());
    const before = (await harness.orchestrator.summarizeSources()).reduce(
      (total, s) => total + s.pendingCount,
      0
    );
    await harness.orchestrator.addDirectSource(TITLE, ANEP_URL);

    const after = (await harness.orchestrator.summarizeSources()).reduce(
      (total, s) => total + s.pendingCount,
      0
    );

    expect(after).toBe(before);
  });
});

describe("WatcherOrchestrator.getCatalogFile", () => {
  it("should download a direct source on every call and name it <id>.zip", async () => {
    const harness = buildHarness(zipResponder());
    await harness.orchestrator.addDirectSource(TITLE, ANEP_URL);
    harness.fetchFn.mockClear();

    const first = await harness.orchestrator.getCatalogFile(DIRECT_ID, DIRECT_ID);
    await harness.orchestrator.getCatalogFile(DIRECT_ID, DIRECT_ID);

    expect(first.filename).toBe(`${DIRECT_ID}.zip`);
    expect(Buffer.compare(first.content, buildShapefileZip())).toBe(0);
    expect(harness.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("should never read or write the vault nor ask the portal for a direct source", async () => {
    const harness = buildHarness(zipResponder());
    await harness.orchestrator.addDirectSource(TITLE, ANEP_URL);
    const readSpy = vi.spyOn(harness.vault, "readResource");
    const writeSpy = vi.spyOn(harness.vault, "writeResource");

    await harness.orchestrator.getCatalogFile(DIRECT_ID, DIRECT_ID);

    expect(readSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(harness.portalCalls).toEqual([]);
    expect(vaultEntries()).toEqual(["sources.json"]);
  });

  it("should refuse a resource id that is not the source id", async () => {
    const harness = buildHarness(zipResponder());
    await harness.orchestrator.addDirectSource(TITLE, ANEP_URL);

    await expect(harness.orchestrator.getCatalogFile(DIRECT_ID, "otro")).rejects.toThrow(
      /no figura en la fuente/
    );
  });

  it.each([
    ["HTTP error", () => new Response("x", { status: 502 }), /HTTP 502/],
    ["error body", () => new Response("<ServiceException/>", { status: 200 }), /ZIP/],
    [
      "no shapefile",
      () => new Response(new Uint8Array(buildZip(["a.txt"])), { status: 200 }),
      /ningún shapefile/,
    ],
  ])("should fail with a Spanish message and return no file on %s", async (_l, responder, pattern) => {
    const harness = buildHarness(zipResponder());
    await harness.orchestrator["sourcesStorage"].addSource(directRow());
    const failing = new WatcherOrchestrator(
      new CkanPortalClient(),
      harness.vault,
      new WatchedSourcesStorageService(vaultRoot),
      new DirectUrlDownloader(async () => responder())
    );

    await expect(failing.getCatalogFile(DIRECT_ID, DIRECT_ID)).rejects.toThrow(pattern);
  });

  it("should still serve a CKAN resource through the vault with its published filename", async () => {
    const harness = buildHarness(zipResponder());

    const file = await harness.orchestrator.getCatalogFile(DEFAULT_SLUG, "res-csv");

    expect(file.filename).toBe("f.csv");
    expect(file.content.toString()).toBe("a,b");
    expect(harness.portalCalls.some((c) => c.startsWith("download:"))).toBe(true);
  });
});

describe("kind defaulting for persisted rows", () => {
  it("should treat a row persisted without kind as a CKAN source in summaries and catalogue", async () => {
    const harness = buildHarness(zipResponder());
    fs.writeFileSync(
      path.join(vaultRoot, "sources.json"),
      JSON.stringify([
        { id: "viejo", title: "Viejo", datasetSlug: "viejo", portalHost: "catalogodatos.gub.uy", isDefault: false },
      ])
    );

    const summaries = await harness.orchestrator.summarizeSources();
    const old = summaries.find((s) => s.sourceId === "viejo");

    expect(old?.status).not.toBe(SourceBadgeState.ON_DEMAND);
    expect(harness.portalCalls).toContain("package:viejo");
  });
});

describe("catalogMapping direct helpers", () => {
  it("should build the group from the source without any network", () => {
    const group = toDirectCatalogGroup(directRow({ description: "d" }));

    expect(group).toMatchObject({ sourceId: DIRECT_ID, datasetSlug: DIRECT_ID, title: TITLE, description: "d" });
    expect(group.resources).toHaveLength(1);
    expect(group.resources[0].name).toBe("Centros ANEP.zip");
  });

  it("should build the ON_DEMAND summary with the given timestamp", () => {
    const summary = buildOnDemandSummary(directRow(), "2026-01-01T00:00:00.000Z");

    expect(summary).toEqual({
      sourceId: DIRECT_ID,
      datasetSlug: DIRECT_ID,
      title: TITLE,
      status: SourceBadgeState.ON_DEMAND,
      totalResources: 1,
      pendingCount: 0,
      checkedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(ON_DEMAND_LABEL).toBe("Se descarga en cada uso");
  });
});

describe("watcher HTTP handlers: direct URL", () => {
  function post(url: string, body: unknown): Request {
    return new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function build(responder: (url: string) => Response | Promise<Response> = zipResponder()) {
    const harness = buildHarness(responder);
    return { ...harness, handlers: createWatcherHandlers(harness.orchestrator) };
  }

  describe("addSource", () => {
    it("should add a direct source and return sources and warnings", async () => {
      const { handlers } = build(zipResponder(false));

      const response = await handlers.addSource(
        post("http://l/sources", { kind: "direct-url", title: TITLE, url: ANEP_URL })
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.warnings).toEqual([MISSING_PRJ_WARNING]);
      expect(payload.sources.some((s: WatchedSource) => s.id === DIRECT_ID)).toBe(true);
    });

    it("should return an empty warnings array on a plain CKAN add", async () => {
      const { handlers } = build();

      const payload = await (
        await handlers.addSource(post("http://l/sources", { url: "ide-direcciones-geograficas-del-uruguay2" }))
      ).json();

      expect(payload.warnings).toEqual([]);
    });

    it.each([
      ["missing title", { kind: "direct-url", url: ANEP_URL }, /title/],
      ["blank title", { kind: "direct-url", title: "  ", url: ANEP_URL }, /title/],
      ["missing url", { kind: "direct-url", title: TITLE }, /url/],
      ["blank url", { kind: "direct-url", title: TITLE, url: "  " }, /url/],
      ["file scheme", { kind: "direct-url", title: TITLE, url: "file:///x" }, /http/],
      ["ftp scheme", { kind: "direct-url", title: TITLE, url: "ftp://x/y.zip" }, /http/],
      ["malformed", { kind: "direct-url", title: TITLE, url: "nope" }, /no es válida/],
      ["unknown kind", { kind: "wms", title: TITLE, url: ANEP_URL }, /tipo de fuente/],
    ])("should answer 400 without downloading on %s", async (_l, body, pattern) => {
      const { handlers, fetchFn } = build();

      const response = await handlers.addSource(post("http://l/sources", body));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(pattern);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it.each([
      ["HTTP failure", () => new Response("x", { status: 404 }), /HTTP 404/],
      ["not a zip", () => new Response("<html/>", { status: 200 }), /ZIP/],
      [
        "missing part",
        () => new Response(new Uint8Array(buildZip(["a.shp", "a.shx"])), { status: 200 }),
        /\.dbf/,
      ],
    ])("should answer 500 with the Spanish message on %s", async (_l, responder, pattern) => {
      const { handlers } = build(responder);

      const response = await handlers.addSource(
        post("http://l/sources", { kind: "direct-url", title: TITLE, url: ANEP_URL })
      );

      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(pattern);
    });

    it("should answer 500 when the id already exists", async () => {
      const { handlers } = build();
      const body = { kind: "direct-url", title: TITLE, url: ANEP_URL };
      await handlers.addSource(post("http://l/sources", body));

      const response = await handlers.addSource(
        post("http://l/sources", { ...body, url: OTHER_URL })
      );

      expect(response.status).toBe(500);
      expect((await response.json()).error).toMatch(/Ya existe/);
    });
  });

  describe("updateSource", () => {
    async function withDirect() {
      const built = build();
      await built.handlers.addSource(
        post("http://l/sources", { kind: "direct-url", title: TITLE, url: ANEP_URL })
      );
      built.fetchFn.mockClear();
      return built;
    }

    it("should update the title of a direct source", async () => {
      const { handlers } = await withDirect();

      const response = await handlers.updateSource(
        post("http://l/sources/update", { sourceId: DIRECT_ID, title: "Nuevo" })
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.sources.find((s: WatchedSource) => s.id === DIRECT_ID).title).toBe("Nuevo");
      expect(payload.warnings).toEqual([]);
    });

    it("should update the url and report warnings of the new one", async () => {
      const harness = buildHarness((url) =>
        new Response(new Uint8Array(buildShapefileZip(url === ANEP_URL)), { status: 200 })
      );
      const handlers = createWatcherHandlers(harness.orchestrator);
      await handlers.addSource(
        post("http://l/sources", { kind: "direct-url", title: TITLE, url: ANEP_URL })
      );

      const payload = await (
        await handlers.updateSource(post("http://l/sources/update", { sourceId: DIRECT_ID, url: OTHER_URL }))
      ).json();

      expect(payload.warnings).toEqual([MISSING_PRJ_WARNING]);
    });

    it("should answer 400 when neither title nor url is given", async () => {
      const { handlers } = await withDirect();

      const response = await handlers.updateSource(
        post("http://l/sources/update", { sourceId: DIRECT_ID })
      );

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/title/);
    });

    it("should answer 400 for a bad scheme without downloading", async () => {
      const { handlers, fetchFn } = await withDirect();

      const response = await handlers.updateSource(
        post("http://l/sources/update", { sourceId: DIRECT_ID, url: "file:///x" })
      );

      expect(response.status).toBe(400);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("should answer 400 when the client tries to change the kind of a direct source", async () => {
      const { handlers } = await withDirect();

      const response = await handlers.updateSource(
        post("http://l/sources/update", { sourceId: DIRECT_ID, kind: "ckan", url: "otro-slug" })
      );

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/tipo/);
    });

    it("should answer 400 when the client tries to turn a CKAN source into a direct one", async () => {
      const { handlers, fetchFn } = build();

      const response = await handlers.updateSource(
        post("http://l/sources/update", { sourceId: DEFAULT_SLUG, kind: "direct-url", url: ANEP_URL })
      );

      expect(response.status).toBe(400);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("should answer 500 and keep the row when the new url fails validation", async () => {
      const harness = buildHarness((url) =>
        url === ANEP_URL
          ? new Response(new Uint8Array(buildShapefileZip()), { status: 200 })
          : new Response("x", { status: 500 })
      );
      const handlers = createWatcherHandlers(harness.orchestrator);
      await handlers.addSource(
        post("http://l/sources", { kind: "direct-url", title: TITLE, url: ANEP_URL })
      );

      const response = await handlers.updateSource(
        post("http://l/sources/update", { sourceId: DIRECT_ID, url: OTHER_URL })
      );

      expect(response.status).toBe(500);
      const row = (await harness.orchestrator.listSources()).find((s) => s.id === DIRECT_ID);
      expect(row?.directUrl).toBe(ANEP_URL);
    });

    it("should keep the CKAN update path working with warnings array", async () => {
      const { handlers } = build();

      const payload = await (
        await handlers.updateSource(
          post("http://l/sources/update", { sourceId: DEFAULT_SLUG, url: "nuevo-slug" })
        )
      ).json();

      expect(payload.success).toBe(true);
      expect(payload.warnings).toEqual([]);
    });

    it("should still require url for a CKAN source", async () => {
      const { handlers } = build();

      const response = await handlers.updateSource(
        post("http://l/sources/update", { sourceId: DEFAULT_SLUG, title: "x" })
      );

      expect(response.status).toBe(400);
    });
  });

  describe("removeSource", () => {
    it("should remove a direct source without touching the vault", async () => {
      const { handlers } = build();
      await handlers.addSource(
        post("http://l/sources", { kind: "direct-url", title: TITLE, url: ANEP_URL })
      );

      const response = await handlers.removeSource(post("http://l/sources/remove", { sourceId: DIRECT_ID }));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.sources.some((s: WatchedSource) => s.id === DIRECT_ID)).toBe(false);
      expect(vaultEntries()).toEqual(["sources.json"]);
    });
  });

  describe("readCatalogFile", () => {
    it("should serve the zip as an attachment named <id>.zip", async () => {
      const { handlers } = build();
      await handlers.addSource(
        post("http://l/sources", { kind: "direct-url", title: TITLE, url: ANEP_URL })
      );

      const response = await handlers.readCatalogFile(
        new Request(`http://l/catalog/file?dataset=${DIRECT_ID}&resource=${DIRECT_ID}`)
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${DIRECT_ID}.zip"`);
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(Buffer.compare(bytes, buildShapefileZip())).toBe(0);
      expect(vaultEntries()).toEqual(["sources.json"]);
    });

    it("should answer 500 with the Spanish message and not the service body when the download is bad", async () => {
      const { orchestrator } = build();
      await orchestrator["sourcesStorage"].addSource(directRow());
      const failing = createWatcherHandlers(
        new WatcherOrchestrator(
          new CkanPortalClient(),
          new VaultStorageService(vaultRoot),
          new WatchedSourcesStorageService(vaultRoot),
          new DirectUrlDownloader(async () => new Response("<ServiceException>secreto</ServiceException>"))
        )
      );

      const response = await failing.readCatalogFile(
        new Request(`http://l/catalog/file?dataset=${DIRECT_ID}&resource=${DIRECT_ID}`)
      );
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(text).toContain("ZIP");
      expect(text).not.toContain("secreto");
    });
  });

  describe("readCatalog and readSummaries", () => {
    it("should include the direct group for SHP and exclude it for CSV", async () => {
      const { handlers } = build();
      await handlers.addSource(
        post("http://l/sources", { kind: "direct-url", title: TITLE, url: ANEP_URL })
      );

      const shp = await (await handlers.readCatalog(new Request("http://l/catalog?format=SHP"))).json();
      const csv = await (await handlers.readCatalog(new Request("http://l/catalog?format=CSV"))).json();

      expect(shp.groups.some((g: { sourceId: string }) => g.sourceId === DIRECT_ID)).toBe(true);
      expect(csv.groups.some((g: { sourceId: string }) => g.sourceId === DIRECT_ID)).toBe(false);
    });

    it("should report ON_DEMAND in summaries", async () => {
      const { handlers } = build();
      await handlers.addSource(
        post("http://l/sources", { kind: "direct-url", title: TITLE, url: ANEP_URL })
      );

      const payload = await (await handlers.readSummaries(new Request("http://l/summaries"))).json();

      expect(
        payload.summaries.find((s: { sourceId: string }) => s.sourceId === DIRECT_ID).status
      ).toBe("ON_DEMAND");
    });
  });
});
