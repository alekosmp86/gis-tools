import { DEFAULT_WATCHED_SOURCES } from "../data/defaultSources";
import type { WatchedSource } from "../types";

/**
 * Compares a source against its corresponding shipped default entry.
 * Returns true only when every tracked field is identical to the shipped default.
 */
export function isUntouchedDefault(source: WatchedSource): boolean {
  const original = DEFAULT_WATCHED_SOURCES.find((defaultSource) => defaultSource.id === source.id);
  if (!original) {
    return false;
  }
  return (
    source.portalHost === original.portalHost &&
    source.datasetSlug === original.datasetSlug &&
    source.title === original.title &&
    source.description === original.description
  );
}

/**
 * Shared message when a requested watched source id does not exist.
 */
export function sourceNotFoundMessage(sourceId: string): string {
  return `No se encontró la fuente vigilada con identificador "${sourceId}".`;
}

/**
 * Combines persisted rows with the shipped defaults.
 *
 * Persisted rows matching a default ID act as overrides over the shipped default, with
 * isDefault: true re-stamped. Persisted custom rows are included with isDefault: false.
 * Persisted rows with unknown IDs claiming to be defaults are ignored to prevent shadowing.
 * Retiring a shipped default requires a migration, because override rows for it will otherwise be dropped.
 */
export function mergeOverridesOverDefaults(
  persistedRows: ReadonlyArray<WatchedSource>
): WatchedSource[] {
  const defaultIds = new Set(DEFAULT_WATCHED_SOURCES.map((source) => source.id));

  const resolvedDefaults: WatchedSource[] = DEFAULT_WATCHED_SOURCES.map((defaultSource) => {
    const override = persistedRows.find((row) => row.id === defaultSource.id);
    if (override) {
      return {
        ...defaultSource,
        ...override,
        id: defaultSource.id,
        isDefault: true,
      };
    }
    return { ...defaultSource, isDefault: true };
  });

  const customSources: WatchedSource[] = [];
  for (const row of persistedRows) {
    if (!defaultIds.has(row.id) && !row.isDefault) {
      customSources.push({ ...row, isDefault: false });
    }
  }

  return [...resolvedDefaults, ...customSources];
}
