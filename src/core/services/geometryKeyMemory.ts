const KEY_MEMORY_PREFIX = "gis-tools.shp-replace.key";
const DEFAULT_SCHEMA = "public";

export interface KeyStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface KeyMemoryTarget {
  host: string;
  port: string;
  db_name: string;
  schema_name: string;
  table_name: string;
}

export function buildKeyMemoryId(target: KeyMemoryTarget): string {
  const schema = target.schema_name || DEFAULT_SCHEMA;
  return `${KEY_MEMORY_PREFIX}.${target.host}:${target.port}|${target.db_name}|${schema}|${target.table_name}`;
}

export function getBrowserKeyStorage(): KeyStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

const isFieldNameArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string");

function parseRememberedKey(raw: string | null): string[] | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  return isFieldNameArray(parsed) ? parsed : null;
}

export function loadRememberedKey(storage: KeyStorage | null, id: string): string[] | null {
  if (!storage) return null;
  try {
    return parseRememberedKey(storage.getItem(id));
  } catch {
    return null;
  }
}

export function saveRememberedKey(storage: KeyStorage | null, id: string, fields: readonly string[]): void {
  if (!storage || fields.length === 0) return;
  try {
    storage.setItem(id, JSON.stringify(fields));
  } catch {
    return;
  }
}
