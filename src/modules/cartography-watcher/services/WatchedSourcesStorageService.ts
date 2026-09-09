import fs from "node:fs";
import path from "node:path";
import { DEFAULT_WATCHED_SOURCES } from "../data/defaultSources";
import type { WatchedSourceConfig } from "../types/watcher";

/**
 * WatchedSourcesStorageService.ts
 * Manages persistent storage of cartographic watched sources in data/vault/sources.json.
 * Strictly adheres to Single Responsibility Principle (SRP) for sources persistence.
 */
export class WatchedSourcesStorageService {
  private readonly baseVaultDir: string;
  private readonly sourcesFilePath: string;

  constructor(customBaseDir?: string) {
    this.baseVaultDir =
      customBaseDir ?? path.join(process.cwd(), "data", "vault");
    this.sourcesFilePath = path.join(this.baseVaultDir, "sources.json");
  }

  /**
   * Loads watched sources from the vault disk storage.
   * Falls back to DEFAULT_WATCHED_SOURCES if the file does not exist or cannot be read.
   */
  public async loadSources(): Promise<WatchedSourceConfig[]> {
    try {
      if (!fs.existsSync(this.sourcesFilePath)) {
        return [...DEFAULT_WATCHED_SOURCES];
      }

      const rawJson = await fs.promises.readFile(this.sourcesFilePath, "utf-8");
      const parsedSources = JSON.parse(rawJson) as WatchedSourceConfig[];

      if (!Array.isArray(parsedSources) || parsedSources.length === 0) {
        return [...DEFAULT_WATCHED_SOURCES];
      }

      // Ensure all default sources are preserved
      const existingIds = new Set(parsedSources.map((sourceItem) => sourceItem.id));
      const missingDefaults = DEFAULT_WATCHED_SOURCES.filter(
        (defaultItem) => !existingIds.has(defaultItem.id)
      );

      return [...missingDefaults, ...parsedSources];
    } catch {
      return [...DEFAULT_WATCHED_SOURCES];
    }
  }

  /**
   * Persists an array of watched sources to sources.json in the vault directory.
   */
  public async saveSources(sources: readonly WatchedSourceConfig[]): Promise<void> {
    if (!fs.existsSync(this.baseVaultDir)) {
      await fs.promises.mkdir(this.baseVaultDir, { recursive: true });
    }

    const jsonContent = JSON.stringify(sources, null, 2);
    await fs.promises.writeFile(this.sourcesFilePath, jsonContent, "utf-8");
  }

  /**
   * Adds or updates a watched source in the persisted storage.
   */
  public async addSource(newSource: WatchedSourceConfig): Promise<WatchedSourceConfig[]> {
    const currentSources = await this.loadSources();
    const updatedSources = [
      ...currentSources.filter((sourceItem) => sourceItem.id !== newSource.id),
      newSource,
    ];

    await this.saveSources(updatedSources);
    return updatedSources;
  }

  /**
   * Removes a custom watched source from the persisted storage.
   * Default system sources are protected and cannot be removed.
   */
  public async removeSource(sourceId: string): Promise<WatchedSourceConfig[]> {
    const isDefaultSource = DEFAULT_WATCHED_SOURCES.some(
      (defaultItem) => defaultItem.id === sourceId
    );

    if (isDefaultSource) {
      throw new Error("No se pueden eliminar las fuentes predeterminadas del sistema.");
    }

    const currentSources = await this.loadSources();
    const updatedSources = currentSources.filter(
      (sourceItem) => sourceItem.id !== sourceId
    );

    await this.saveSources(updatedSources);
    return updatedSources;
  }

  public getSourcesFilePath(): string {
    return this.sourcesFilePath;
  }
}
