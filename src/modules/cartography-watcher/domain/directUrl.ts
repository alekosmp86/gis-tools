import { iter } from "but-unzip";
import {
  DIRECT_ALLOWED_PROTOCOLS,
  MISSING_PRJ_WARNING,
  SHAPEFILE_PROJECTION_EXTENSION,
  SHAPEFILE_REQUIRED_EXTENSIONS,
  ZIP_END_OF_CENTRAL_DIRECTORY_MIN_BYTES,
  ZIP_END_OF_CENTRAL_DIRECTORY_SEARCH_BYTES,
  ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE,
  ZIP_LOCAL_HEADER_SIGNATURE,
  ZIP_MAX_ENTRIES,
} from "../constants";
import type { WatchedSource } from "../types";

/**
 * Rules for sources that are a bare service URL: what the URL may be, and what the downloaded
 * bytes must contain. Pure, so every refusal is testable without a network.
 */

const IGNORED_ENTRY_MARKER = "__macosx";
const INVALID_ZIP_MESSAGE = "El archivo descargado no es un ZIP válido.";

export interface ParsedDirectUrl {
  readonly url: string;
  readonly host: string;
}

export interface ShapefileCheckResult {
  /** Spanish reason the ZIP holds no usable shapefile, or null when it does. */
  readonly errorMessage: string | null;
  readonly warnings: ReadonlyArray<string>;
}

/** Accepts only a well-formed `http` or `https` URL. */
export function parseDirectUrl(rawUrl: string): ParsedDirectUrl {
  const trimmedUrl = rawUrl.trim();

  if (trimmedUrl.length === 0) {
    throw new Error("La URL no puede estar vacía.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error(`La URL no es válida: ${trimmedUrl}`);
  }

  if (!DIRECT_ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error("La URL debe comenzar con http:// o https://.");
  }

  return { url: trimmedUrl, host: parsedUrl.host };
}

/** The source, other than `exceptSourceId`, that already uses this URL (case-insensitive). */
export function findSourceWithDirectUrl(
  sources: ReadonlyArray<WatchedSource>,
  url: string,
  exceptSourceId?: string
): WatchedSource | undefined {
  const normalizedUrl = url.toLowerCase();
  return sources.find(
    (source) =>
      source.id !== exceptSourceId &&
      source.directUrl !== undefined &&
      source.directUrl.toLowerCase() === normalizedUrl
  );
}

export function hasZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= ZIP_LOCAL_HEADER_SIGNATURE.length &&
    ZIP_LOCAL_HEADER_SIGNATURE.every((signatureByte, index) => bytes[index] === signatureByte)
  );
}

/** Entry names read from the ZIP central directory; nothing is inflated or written. */
export function listZipEntryNames(bytes: Uint8Array): string[] {
  if (!hasEndOfCentralDirectory(bytes)) {
    throw new Error(INVALID_ZIP_MESSAGE);
  }

  const entryNames: string[] = [];
  for (const entry of iter(bytes)) {
    entryNames.push(entry.filename);
    if (entryNames.length > ZIP_MAX_ENTRIES) {
      throw new Error(INVALID_ZIP_MESSAGE);
    }
  }
  return entryNames;
}

/** `iter` never returns on a buffer without this record, so it is checked before iterating. */
function hasEndOfCentralDirectory(bytes: Uint8Array): boolean {
  const lastStart = bytes.length - ZIP_END_OF_CENTRAL_DIRECTORY_MIN_BYTES;
  const firstStart = Math.max(0, bytes.length - ZIP_END_OF_CENTRAL_DIRECTORY_SEARCH_BYTES);

  for (let start = lastStart; start >= firstStart; start--) {
    const matches = ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE.every(
      (signatureByte, offset) => bytes[start + offset] === signatureByte
    );
    if (matches) {
      return true;
    }
  }
  return false;
}

function groupExtensionsByBaseName(entryNames: ReadonlyArray<string>): Map<string, Set<string>> {
  const extensionsByBaseName = new Map<string, Set<string>>();

  for (const entryName of entryNames) {
    const normalizedName = entryName.replace(/\\/g, "/").toLowerCase();
    if (normalizedName.endsWith("/") || normalizedName.includes(IGNORED_ENTRY_MARKER)) {
      continue;
    }

    const fileStart = normalizedName.lastIndexOf("/") + 1;
    const dotIndex = normalizedName.lastIndexOf(".");
    if (dotIndex <= fileStart) {
      continue;
    }

    const baseName = normalizedName.slice(0, dotIndex);
    const extensions = extensionsByBaseName.get(baseName) ?? new Set<string>();
    extensions.add(normalizedName.slice(dotIndex));
    extensionsByBaseName.set(baseName, extensions);
  }

  return extensionsByBaseName;
}

function countRequiredParts(extensions: ReadonlySet<string>): number {
  return SHAPEFILE_REQUIRED_EXTENSIONS.filter((extension) => extensions.has(extension)).length;
}

function describeMissingPart(extensionSets: ReadonlyArray<ReadonlySet<string>>): string {
  const closestSet = extensionSets.reduce<ReadonlySet<string> | null>(
    (best, candidate) =>
      countRequiredParts(candidate) > (best ? countRequiredParts(best) : 0) ? candidate : best,
    null
  );

  if (!closestSet) {
    return "El ZIP no contiene ningún shapefile (.shp, .dbf y .shx).";
  }

  const missingExtension = SHAPEFILE_REQUIRED_EXTENSIONS.find(
    (extension) => !closestSet.has(extension)
  );
  return `El ZIP no contiene el archivo ${missingExtension} del shapefile.`;
}

/**
 * Looks for at least one complete `.shp` + `.dbf` + `.shx` set sharing a base name, at any folder
 * depth. A missing `.prj` is not a refusal; it is a warning, because the sync tool asks for the SRID.
 */
export function checkShapefileParts(entryNames: ReadonlyArray<string>): ShapefileCheckResult {
  const extensionSets = [...groupExtensionsByBaseName(entryNames).values()];
  const completeSets = extensionSets.filter(
    (extensions) => countRequiredParts(extensions) === SHAPEFILE_REQUIRED_EXTENSIONS.length
  );

  if (completeSets.length === 0) {
    return { errorMessage: describeMissingPart(extensionSets), warnings: [] };
  }

  const hasProjection = completeSets.some((extensions) =>
    extensions.has(SHAPEFILE_PROJECTION_EXTENSION)
  );
  return { errorMessage: null, warnings: hasProjection ? [] : [MISSING_PRJ_WARNING] };
}

/**
 * The checks shared by add, edit and download, applied to the downloaded bytes: ZIP signature, then
 * shapefile parts. Returns the warnings; throws a Spanish message when the bytes are unusable.
 */
export function assertShapefileZip(bytes: Uint8Array): ReadonlyArray<string> {
  if (!hasZipSignature(bytes)) {
    throw new Error(
      "La URL no devolvió un archivo ZIP (puede ser un mensaje de error del servicio)."
    );
  }

  let entryNames: string[];
  try {
    entryNames = listZipEntryNames(bytes);
  } catch {
    throw new Error(INVALID_ZIP_MESSAGE);
  }

  const { errorMessage, warnings } = checkShapefileParts(entryNames);
  if (errorMessage) {
    throw new Error(errorMessage);
  }
  return warnings;
}
