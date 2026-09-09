import path from "node:path";
import type { CkanResource } from "../types/watcher";

/**
 * Sanitizes a string to be safely used as a filename or folder name.
 */
export function sanitizeSlug(raw: string): string {
  return (
    raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "recurso"
  );
}

/**
 * Resolves the clean filename for a given CKAN resource (e.g. "artigas.csv").
 */
export function resolveResourceFilename(resource: CkanResource): string {
  const extension = resource.format ? `.${resource.format.toLowerCase().trim()}` : ".csv";

  // Extract base name from URL or name
  if (resource.url) {
    try {
      const urlObj = new URL(resource.url);
      const urlFilename = path.basename(urlObj.pathname);
      if (urlFilename && urlFilename.includes(".")) {
        return urlFilename;
      }
    } catch {
      // Fall back to resource name
    }
  }

  const baseName = sanitizeSlug(resource.name);
  return `${baseName}${extension}`;
}
