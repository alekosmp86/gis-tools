import { cleanValue } from "@/core/common/GisStringSanitizer";

function resolveCaseInsensitive(
  record: Record<string, unknown>,
  lowerKeyMap: Map<string, string>,
  columnName: string
): unknown {
  if (record[columnName] !== undefined) return record[columnName];
  const actualKey = lowerKeyMap.get(columnName.toLowerCase());
  return actualKey === undefined ? undefined : record[actualKey];
}

export interface ContentSignatureOptions {
  suidColumns?: readonly string[];
  cleanSuidPart?: (value: unknown) => string;
  allProperties?: boolean;
}

const GEOMETRY_KEYS = new Set(["_geometry", "geometry"]);
const NO_GEOMETRY_TOKEN = "<no-geometry>";

function fingerprintGeometry(geometry: unknown): string {
  if (geometry === undefined || geometry === null) return NO_GEOMETRY_TOKEN;
  try {
    return JSON.stringify(geometry) ?? NO_GEOMETRY_TOKEN;
  } catch {
    return NO_GEOMETRY_TOKEN;
  }
}

/**
 * Builds a deterministic content signature from the cleaned values of the given columns
 * (or all non-geometry properties when options.allProperties) plus a geometry fingerprint.
 * Two records with the same signature are considered exact duplicates.
 */
export function buildContentSignature(
  record: Record<string, unknown>,
  columns: readonly string[],
  geometry?: unknown,
  options?: ContentSignatureOptions
): string {
  const lowerKeyMap = new Map<string, string>();
  for (const key of Object.keys(record)) {
    lowerKeyMap.set(key.toLowerCase(), key);
  }
  const suidLower = new Set((options?.suidColumns ?? []).map((name) => name.toLowerCase()));
  const columnList = options?.allProperties
    ? Object.keys(record)
        .filter((key) => !GEOMETRY_KEYS.has(key.toLowerCase()))
        .sort()
    : columns;
  const parts: string[] = [];
  for (const columnName of columnList) {
    const value = resolveCaseInsensitive(record, lowerKeyMap, columnName);
    const isSuid = options?.cleanSuidPart && suidLower.has(columnName.toLowerCase());
    parts.push(isSuid ? options!.cleanSuidPart!(value) : cleanValue(value));
  }
  if (geometry !== undefined || options) parts.push(fingerprintGeometry(geometry));
  return JSON.stringify(parts);
}
