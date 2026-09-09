import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { VaultStorageService } from "@/modules/cartography-watcher/services/VaultStorageService";
import { WatchedSourcesStorageService } from "@/modules/cartography-watcher/services/WatchedSourcesStorageService";
import { DEFAULT_WATCHED_SOURCES } from "@/modules/cartography-watcher/data/defaultSources";
import type { CkanResource, WatchedSource } from "@/modules/cartography-watcher/types";

/**
 * Each test gets its own vault directory, so the suite never touches the real one and no test can
 * observe what another one wrote.
 */
let vaultRoot: string;

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "watcher-vault-"));
});

afterEach(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

function buildResource(overrides: Partial<CkanResource> = {}): CkanResource {
  return {
    id: "res-1",
    name: "Ejes - FLORES",
    format: "CSV",
    url: "https://catalogodatos.gub.uy/dataset/x/resource/y/download/flores.csv",
    hash: "abc123",
    last_modified: "2026-09-01T10:00:00.000Z",
    size: 9,
    ...overrides,
  };
}

function buildCustomSource(overrides: Partial<WatchedSource> = {}): WatchedSource {
  return {
    id: "otro-conjunto",
    title: "Otro conjunto",
    datasetSlug: "otro-conjunto",
    portalHost: "datos.example.org",
    isDefault: false,
    ...overrides,
  };
}

describe("VaultStorageService", () => {
  it("should store a resource beside a sidecar describing it", async () => {
    // Arrange
    const vault = new VaultStorageService(vaultRoot);
    const content = Buffer.from("id,nombre");

    // Act
    const meta = await vault.writeResource("ide-ejes", buildResource(), content);

    // Assert
    expect(meta.relativeFilePath).toBe("ide-ejes/flores.csv");
    expect(meta.fileSize).toBe(content.byteLength);
    expect(meta.hash).toBe("abc123");
    expect(fs.existsSync(path.join(vaultRoot, "ide-ejes", "flores.csv"))).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, "ide-ejes", "res-1.meta.json"))).toBe(true);
  });

  it("should read back exactly the bytes it stored", async () => {
    // Arrange
    const vault = new VaultStorageService(vaultRoot);
    const content = Buffer.from("id,nombre\n1,Flores");
    await vault.writeResource("ide-ejes", buildResource(), content);

    // Act
    const stored = await vault.readResource("ide-ejes", "res-1");

    // Assert
    expect(stored?.content.equals(content)).toBe(true);
    expect(stored?.meta.resourceId).toBe("res-1");
  });

  it("should record the download instant it is given, so callers control the clock", async () => {
    // Arrange
    const vault = new VaultStorageService(vaultRoot);
    const downloadedAt = new Date("2026-09-09T12:00:00.000Z");

    // Act
    const meta = await vault.writeResource(
      "ide-ejes",
      buildResource(),
      Buffer.from("x"),
      downloadedAt
    );

    // Assert
    expect(meta.downloadedAt).toBe("2026-09-09T12:00:00.000Z");
  });

  it("should fall back to the download instant when the portal publishes no timestamp", async () => {
    // Arrange
    const vault = new VaultStorageService(vaultRoot);
    const downloadedAt = new Date("2026-09-09T12:00:00.000Z");
    const resource = buildResource({ last_modified: null, metadata_modified: null });

    // Act
    const meta = await vault.writeResource("ide-ejes", resource, Buffer.from("x"), downloadedAt);

    // Assert
    expect(meta.remoteLastModified).toBe("2026-09-09T12:00:00.000Z");
  });

  it("should report nothing for a resource it never stored", async () => {
    // Arrange
    const vault = new VaultStorageService(vaultRoot);

    // Act & Assert
    expect(await vault.readMeta("ide-ejes", "ausente")).toBeNull();
    expect(await vault.readResource("ide-ejes", "ausente")).toBeNull();
    expect((await vault.readAllMeta("ide-ejes")).size).toBe(0);
  });

  it("should treat a sidecar whose file was deleted as absent", async () => {
    // Arrange: the vault may be cleaned by hand, and a dangling sidecar must not break a read.
    const vault = new VaultStorageService(vaultRoot);
    await vault.writeResource("ide-ejes", buildResource(), Buffer.from("x"));
    fs.rmSync(path.join(vaultRoot, "ide-ejes", "flores.csv"));

    // Act & Assert
    expect(await vault.readResource("ide-ejes", "res-1")).toBeNull();
  });

  it("should skip a corrupt sidecar rather than failing the whole listing", async () => {
    // Arrange
    const vault = new VaultStorageService(vaultRoot);
    await vault.writeResource("ide-ejes", buildResource(), Buffer.from("x"));
    await vault.writeResource("ide-ejes", buildResource({ id: "res-2" }), Buffer.from("y"));
    fs.writeFileSync(path.join(vaultRoot, "ide-ejes", "res-2.meta.json"), "{ roto");

    // Act
    const storedMeta = await vault.readAllMeta("ide-ejes");

    // Assert
    expect([...storedMeta.keys()]).toEqual(["res-1"]);
  });

  it("should index stored metadata by resource id", async () => {
    // Arrange
    const vault = new VaultStorageService(vaultRoot);
    await vault.writeResource("ide-ejes", buildResource(), Buffer.from("x"));
    await vault.writeResource(
      "ide-ejes",
      buildResource({ id: "res-2", name: "Ejes - SALTO", url: "https://x/download/salto.csv" }),
      Buffer.from("y")
    );

    // Act
    const storedMeta = await vault.readAllMeta("ide-ejes");

    // Assert
    expect([...storedMeta.keys()].sort()).toEqual(["res-1", "res-2"]);
  });

  it("should replace a previous copy of the same resource", async () => {
    // Arrange
    const vault = new VaultStorageService(vaultRoot);
    await vault.writeResource("ide-ejes", buildResource(), Buffer.from("viejo"));

    // Act
    await vault.writeResource("ide-ejes", buildResource({ hash: "def456" }), Buffer.from("nuevo"));
    const stored = await vault.readResource("ide-ejes", "res-1");

    // Assert
    expect(stored?.content.toString()).toBe("nuevo");
    expect(stored?.meta.hash).toBe("def456");
  });
});

describe("WatchedSourcesStorageService", () => {
  it("should return the shipped defaults before anything was ever saved", async () => {
    // Arrange
    const storage = new WatchedSourcesStorageService(vaultRoot);

    // Act
    const sources = await storage.loadSources();

    // Assert
    expect(sources.map((source) => source.id)).toEqual(
      DEFAULT_WATCHED_SOURCES.map((source) => source.id)
    );
  });

  it("should persist an added source and list it after the defaults", async () => {
    // Arrange
    const storage = new WatchedSourcesStorageService(vaultRoot);

    // Act
    const sources = await storage.addSource(buildCustomSource());

    // Assert
    expect(sources).toHaveLength(DEFAULT_WATCHED_SOURCES.length + 1);
    expect(sources[sources.length - 1].id).toBe("otro-conjunto");
    expect(fs.existsSync(path.join(vaultRoot, "sources.json"))).toBe(true);
  });

  it("should survive a restart, since the list lives on disk and not in memory", async () => {
    // Arrange
    await new WatchedSourcesStorageService(vaultRoot).addSource(buildCustomSource());

    // Act: a second instance stands in for a restarted server.
    const sources = await new WatchedSourcesStorageService(vaultRoot).loadSources();

    // Assert
    expect(sources.some((source) => source.id === "otro-conjunto")).toBe(true);
  });

  it("should replace an existing entry rather than duplicating it", async () => {
    // Arrange
    const storage = new WatchedSourcesStorageService(vaultRoot);
    await storage.addSource(buildCustomSource({ title: "Primer titulo" }));

    // Act
    const sources = await storage.addSource(buildCustomSource({ title: "Titulo corregido" }));

    // Assert
    const matching = sources.filter((source) => source.id === "otro-conjunto");
    expect(matching).toHaveLength(1);
    expect(matching[0].title).toBe("Titulo corregido");
  });

  it("should force a persisted source to be non-default whatever it claims", async () => {
    // Arrange: a saved source must never be able to impersonate a shipped one.
    const storage = new WatchedSourcesStorageService(vaultRoot);

    // Act
    const sources = await storage.addSource(buildCustomSource({ isDefault: true }));

    // Assert
    expect(sources.find((source) => source.id === "otro-conjunto")?.isDefault).toBe(false);
  });

  it("should remove a source the user added", async () => {
    // Arrange
    const storage = new WatchedSourcesStorageService(vaultRoot);
    await storage.addSource(buildCustomSource());

    // Act
    const sources = await storage.removeSource("otro-conjunto");

    // Assert
    expect(sources.some((source) => source.id === "otro-conjunto")).toBe(false);
  });

  it("should refuse to remove a source shipped with the module", async () => {
    // Arrange
    const storage = new WatchedSourcesStorageService(vaultRoot);

    // Act & Assert
    await expect(storage.removeSource(DEFAULT_WATCHED_SOURCES[0].id)).rejects.toThrow(
      /viene incluida con el módulo/
    );
  });

  it("should fall back to the defaults when the file on disk is corrupt", async () => {
    // Arrange: a half-written file must not take the watcher down.
    fs.writeFileSync(path.join(vaultRoot, "sources.json"), "{ no es json");
    const storage = new WatchedSourcesStorageService(vaultRoot);

    // Act
    const sources = await storage.loadSources();

    // Assert
    expect(sources.map((source) => source.id)).toEqual(
      DEFAULT_WATCHED_SOURCES.map((source) => source.id)
    );
  });

  it("should ignore persisted entries that claim to be defaults", async () => {
    // Arrange: otherwise a hand-edited file could shadow a shipped source.
    fs.writeFileSync(
      path.join(vaultRoot, "sources.json"),
      JSON.stringify([{ ...buildCustomSource(), isDefault: true }])
    );

    // Act
    const sources = await new WatchedSourcesStorageService(vaultRoot).loadSources();

    // Assert
    expect(sources).toHaveLength(DEFAULT_WATCHED_SOURCES.length);
  });
});
