/**
 * Naming rules shared by the vault, the catalogue and the source list.
 *
 * Pure string work, kept away from the services so the filesystem layout can be reasoned about —
 * and tested — without touching a disk.
 */

/** Portal assumed when the user supplies a bare dataset slug rather than a full URL. */
export const DEFAULT_PORTAL_HOST = "catalogodatos.gub.uy";

/** Fallback when a name sanitises down to nothing at all. */
const FALLBACK_SLUG = "recurso";

/**
 * Reduces arbitrary text to something safe as a file or folder name: accents folded, anything
 * outside a conservative alphabet collapsed to single underscores.
 */
export function sanitizeSlug(rawValue: string): string {
  const sanitized = rawValue
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized.length > 0 ? sanitized : FALLBACK_SLUG;
}

/**
 * Picks the filename a resource is stored under, preferring the name the portal itself publishes
 * in the download URL so a vaulted file looks like the file the user would have downloaded.
 */
export function resolveResourceFilename(resourceName: string, format: string, url?: string): string {
  if (url) {
    try {
      const urlPath = new URL(url).pathname;
      const lastSegment = urlPath.slice(urlPath.lastIndexOf("/") + 1);
      if (lastSegment.includes(".")) {
        return decodeURIComponent(lastSegment);
      }
    } catch {
      // Not a usable URL; fall through to the resource name.
    }
  }

  const extension = format.trim() ? `.${format.toLowerCase().trim()}` : ".csv";
  return `${sanitizeSlug(resourceName)}${extension}`;
}

/**
 * Extracts the dataset slug and host from whatever the user pasted: a dataset URL, a resource URL
 * beneath it, or a bare slug.
 */
export function parsePortalReference(rawInput: string): {
  portalHost: string;
  datasetSlug: string;
} {
  const trimmedInput = rawInput.trim();

  if (trimmedInput.length === 0) {
    throw new Error("La URL o el identificador del conjunto de datos no puede estar vacío.");
  }

  if (!trimmedInput.startsWith("http://") && !trimmedInput.startsWith("https://")) {
    return { portalHost: DEFAULT_PORTAL_HOST, datasetSlug: trimmedInput };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedInput);
  } catch {
    throw new Error(`La URL del catálogo no es válida: ${trimmedInput}`);
  }

  const datasetMatch = parsedUrl.pathname.match(/\/dataset\/([^/?#]+)/i);
  if (!datasetMatch) {
    throw new Error(
      `No se pudo identificar el conjunto de datos en la URL: ${trimmedInput}. Debe incluir /dataset/<identificador>.`
    );
  }

  return { portalHost: parsedUrl.host, datasetSlug: datasetMatch[1] };
}

/** Human-readable title derived from a slug, used until the portal supplies the real one. */
export function formatTitleFromSlug(datasetSlug: string): string {
  return datasetSlug
    .replace(/^ide-/, "")
    .split("-")
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
