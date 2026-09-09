import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WatchedSourcesStorageService } from "@/modules/cartography-watcher/services/WatchedSourcesStorageService";
import { DEFAULT_WATCHED_SOURCES } from "@/modules/cartography-watcher/data/defaultSources";
import type { WatchedSourceConfig } from "@/modules/cartography-watcher/types/watcher";

describe("WatchedSourcesStorageService", () => {
  let tempDirectory: string;
  let storageService: WatchedSourcesStorageService;

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sources-test-"));
    storageService = new WatchedSourcesStorageService(tempDirectory);
  });

  afterEach(() => {
    if (fs.existsSync(tempDirectory)) {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  describe("loadSources", () => {
    it("should return DEFAULT_WATCHED_SOURCES when sources.json does not exist", async () => {
      // Act
      const loadedSources = await storageService.loadSources();

      // Assert
      expect(loadedSources.length).toBe(DEFAULT_WATCHED_SOURCES.length);
      expect(loadedSources[0].id).toBe(DEFAULT_WATCHED_SOURCES[0].id);
    });

    it("should return DEFAULT_WATCHED_SOURCES when sources.json contains invalid JSON", async () => {
      // Arrange
      fs.writeFileSync(storageService.getSourcesFilePath(), "{ invalid json", "utf-8");

      // Act
      const loadedSources = await storageService.loadSources();

      // Assert
      expect(loadedSources.length).toBe(DEFAULT_WATCHED_SOURCES.length);
    });

    it("should automatically preserve default sources if custom file omits them", async () => {
      // Arrange
      const customOnly: WatchedSourceConfig[] = [
        {
          id: "custom-source-1",
          title: "Custom Source 1",
          url: "https://example.com/dataset/custom-source-1",
          datasetSlug: "custom-source-1",
          isDefault: false,
        },
      ];
      await storageService.saveSources(customOnly);

      // Act
      const loadedSources = await storageService.loadSources();

      // Assert
      const customFound = loadedSources.find((sourceItem) => sourceItem.id === "custom-source-1");
      expect(customFound).toBeDefined();

      const defaultFound = loadedSources.find((sourceItem) => sourceItem.id === DEFAULT_WATCHED_SOURCES[0].id);
      expect(defaultFound).toBeDefined();
    });
  });

  describe("addSource and saveSources", () => {
    it("should persist a new custom source to sources.json", async () => {
      // Arrange
      const newCustomSource: WatchedSourceConfig = {
        id: "ide-infraestructura-datos",
        title: "Infraestructura de Datos",
        url: "https://catalogodatos.gub.uy/dataset/ide-infraestructura-datos",
        datasetSlug: "ide-infraestructura-datos",
        isDefault: false,
      };

      // Act
      const resultSources = await storageService.addSource(newCustomSource);

      // Assert
      expect(resultSources.some((sourceItem) => sourceItem.id === newCustomSource.id)).toBe(true);
      expect(fs.existsSync(storageService.getSourcesFilePath())).toBe(true);

      const reloadedSources = await storageService.loadSources();
      expect(reloadedSources.some((sourceItem) => sourceItem.id === newCustomSource.id)).toBe(true);
    });

    it("should overwrite an existing custom source with matching ID", async () => {
      // Arrange
      const initialSource: WatchedSourceConfig = {
        id: "custom-source",
        title: "Initial Title",
        url: "https://example.com/initial",
        datasetSlug: "custom-source",
        isDefault: false,
      };
      await storageService.addSource(initialSource);

      const updatedSource: WatchedSourceConfig = {
        id: "custom-source",
        title: "Updated Title",
        url: "https://example.com/updated",
        datasetSlug: "custom-source",
        isDefault: false,
      };

      // Act
      const resultSources = await storageService.addSource(updatedSource);

      // Assert
      const foundSource = resultSources.find((sourceItem) => sourceItem.id === "custom-source");
      expect(foundSource?.title).toBe("Updated Title");
      expect(foundSource?.url).toBe("https://example.com/updated");
    });
  });

  describe("removeSource", () => {
    it("should successfully remove a custom source", async () => {
      // Arrange
      const customSource: WatchedSourceConfig = {
        id: "custom-to-delete",
        title: "Source to Delete",
        url: "https://example.com/delete",
        datasetSlug: "custom-to-delete",
        isDefault: false,
      };
      await storageService.addSource(customSource);

      // Act
      const updatedSources = await storageService.removeSource("custom-to-delete");

      // Assert
      expect(updatedSources.some((sourceItem) => sourceItem.id === "custom-to-delete")).toBe(false);

      const reloadedSources = await storageService.loadSources();
      expect(reloadedSources.some((sourceItem) => sourceItem.id === "custom-to-delete")).toBe(false);
    });

    it("should reject removing default system sources", async () => {
      // Act & Assert
      await expect(
        storageService.removeSource(DEFAULT_WATCHED_SOURCES[0].id)
      ).rejects.toThrow("No se pueden eliminar las fuentes predeterminadas del sistema.");
    });
  });
});
