import fs from "node:fs";
import path from "node:path";
import { DEFAULT_WATCHED_SOURCES } from "../data/defaultSources";
import {
  isUntouchedDefault,
  mergeOverridesOverDefaults,
  sourceNotFoundMessage,
} from "../domain/sourceOverrides";
import type { WatchedSource } from "../types";

/**
 * Server-side on purpose. The catalogue is read while rendering and while serving the sync tools,
 * neither of which can see a browser's storage — a source saved only in `localStorage` would be
 * invisible exactly where it is needed.
 */
export class WatchedSourcesStorageService {
  private readonly sourcesFilePath: string;

  constructor(rootDir: string = path.join(process.cwd(), "data", "vault")) {
    this.sourcesFilePath = path.join(rootDir, "sources.json");
  }

  public async loadSources(): Promise<WatchedSource[]> {
    let persistedRows: WatchedSource[] = [];

    try {
      const rawJson = await fs.promises.readFile(this.sourcesFilePath, "utf8");
      const parsed = JSON.parse(rawJson) as unknown;
      if (Array.isArray(parsed)) {
        persistedRows = parsed.filter(
          (entry): entry is WatchedSource =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as WatchedSource).id === "string"
        );
      }
    } catch {
      // A missing or corrupt file yields the defaults rather than an error; the next write repairs the file.
    }

    return mergeOverridesOverDefaults(persistedRows);
  }

  /**
   * Adds a source, replacing any entry with the same id. The orchestrator guarantees the id does
   * not collide with a shipped default.
   */
  public async addSource(source: WatchedSource): Promise<WatchedSource[]> {
    const existing = await this.loadSources();
    const otherSources = existing.filter((candidate) => candidate.id !== source.id);

    await this.persistOverrides([...otherSources, { ...source, isDefault: false }]);
    return this.loadSources();
  }

  /**
   * Updates an existing source's properties while preserving its immutable id.
   * Throws a Spanish error when sourceId does not exist.
   */
  public async updateSource(
    sourceId: string,
    changes: Partial<Omit<WatchedSource, "id">>
  ): Promise<WatchedSource[]> {
    const existing = await this.loadSources();
    const targetIndex = existing.findIndex((candidate) => candidate.id === sourceId);

    if (targetIndex === -1) {
      throw new Error(sourceNotFoundMessage(sourceId));
    }

    const target = existing[targetIndex];
    const updated: WatchedSource = {
      ...target,
      ...changes,
      id: target.id,
      isDefault: target.isDefault,
    };

    const updatedSources = [...existing];
    updatedSources[targetIndex] = updated;

    await this.persistOverrides(updatedSources);
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
    const remaining = existing.filter((candidate) => candidate.id !== sourceId);

    await this.persistOverrides(remaining);
    return this.loadSources();
  }

  private async persistOverrides(sources: ReadonlyArray<WatchedSource>): Promise<void> {
    const rowsToPersist = sources.filter((source) => !isUntouchedDefault(source));
    await fs.promises.mkdir(path.dirname(this.sourcesFilePath), { recursive: true });
    await fs.promises.writeFile(
      this.sourcesFilePath,
      JSON.stringify(rowsToPersist, null, 2),
      "utf8"
    );
  }
}
