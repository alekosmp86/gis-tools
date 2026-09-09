import fs from "node:fs";
import path from "node:path";
import { DEFAULT_WATCHED_SOURCES } from "../data/defaultSources";
import type { WatchedSource } from "../types";

/**
 * Persists the list of watched sources on the server.
 *
 * Server-side on purpose. The catalogue is read while rendering and while serving the sync tools,
 * neither of which can see a browser's storage — a source saved only in `localStorage` would be
 * invisible exactly where it is needed. One file, one responsibility, separate from the vault that
 * stores downloaded bytes.
 */
export class WatchedSourcesStorageService {
  private readonly sourcesFilePath: string;

  constructor(rootDir: string = path.join(process.cwd(), "data", "vault")) {
    this.sourcesFilePath = path.join(rootDir, "sources.json");
  }

  /**
   * Reads the persisted sources, always with the shipped defaults in front.
   *
   * A missing or corrupt file yields the defaults rather than an error: the watcher stays usable,
   * and the next write repairs the file.
   */
  public async loadSources(): Promise<WatchedSource[]> {
    let customSources: WatchedSource[] = [];

    try {
      const rawJson = await fs.promises.readFile(this.sourcesFilePath, "utf8");
      const parsed = JSON.parse(rawJson) as unknown;
      if (Array.isArray(parsed)) {
        customSources = parsed.filter(
          (entry): entry is WatchedSource =>
            typeof entry === "object" && entry !== null && !(entry as WatchedSource).isDefault
        );
      }
    } catch {
      // No usable file yet; the defaults alone are a valid state.
    }

    return [...DEFAULT_WATCHED_SOURCES, ...customSources];
  }

  /** Adds a source, replacing any existing entry with the same id. Defaults are never touched. */
  public async addSource(source: WatchedSource): Promise<WatchedSource[]> {
    const existing = await this.loadSources();
    const customSources = existing.filter(
      (candidate) => !candidate.isDefault && candidate.id !== source.id
    );

    await this.persist([...customSources, { ...source, isDefault: false }]);
    return this.loadSources();
  }

  /** Removes a user-added source. Removing a shipped default is refused, not silently ignored. */
  public async removeSource(sourceId: string): Promise<WatchedSource[]> {
    if (DEFAULT_WATCHED_SOURCES.some((source) => source.id === sourceId)) {
      throw new Error(
        `La fuente "${sourceId}" viene incluida con el módulo y no se puede eliminar.`
      );
    }

    const existing = await this.loadSources();
    const customSources = existing.filter(
      (candidate) => !candidate.isDefault && candidate.id !== sourceId
    );

    await this.persist(customSources);
    return this.loadSources();
  }

  private async persist(customSources: ReadonlyArray<WatchedSource>): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.sourcesFilePath), { recursive: true });
    await fs.promises.writeFile(
      this.sourcesFilePath,
      JSON.stringify(customSources, null, 2),
      "utf8"
    );
  }
}
