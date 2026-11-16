/** Catalog failures keyed by catalogKey: the first message recorded for a key is kept. */
export type CatalogFailures = Readonly<Record<string, string>>;

const hasKey = (failures: CatalogFailures, key: string): boolean => Object.prototype.hasOwnProperty.call(failures, key);

export function emptyCatalogFailures(): CatalogFailures {
  return {};
}

export function recordCatalogFailure(failures: CatalogFailures, key: string, message: string): CatalogFailures {
  return { ...failures, [key]: hasKey(failures, key) ? failures[key] : message };
}

export function clearCatalogFailure(failures: CatalogFailures, key: string): CatalogFailures {
  const next: Record<string, string> = { ...failures };
  delete next[key];
  return next;
}

export function currentCatalogError(failures: CatalogFailures, key: string): string | null {
  if (key === "" || !hasKey(failures, key)) return null;
  return failures[key];
}
