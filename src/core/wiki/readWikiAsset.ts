import path from "node:path";
import { resolveWikiAssetPath } from "./resolveWikiAssetPath";

const CONTENT_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/** An image read from a tool's content directory. */
export interface WikiAsset {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/** Reads a file's bytes; rejects when it cannot be read. Injectable so tests can fake it. */
export type WikiAssetReader = (filePath: string) => Promise<Uint8Array>;

/**
 * Resolves the requested path inside `contentDir` and reads it. Null when the path is not an
 * allowed image path (the reader is then never called) or the file cannot be read.
 */
export async function readWikiAsset(
  contentDir: string,
  segments: ReadonlyArray<string>,
  readFile: WikiAssetReader,
): Promise<WikiAsset | null> {
  const resolvedPath = resolveWikiAssetPath(contentDir, segments);
  if (!resolvedPath) return null;

  const contentType = CONTENT_TYPES_BY_EXTENSION[path.extname(resolvedPath).toLowerCase()];
  if (!contentType) return null;

  try {
    return { bytes: await readFile(resolvedPath), contentType };
  } catch {
    return null;
  }
}
