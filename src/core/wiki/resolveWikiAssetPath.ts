import path from "node:path";

/** Extensions the asset route may serve; anything else is never read. */
const ALLOWED_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const FORBIDDEN_SEGMENT_CHARACTERS = /[\\/\0%:]/;
const TRAVERSAL_SEGMENTS: ReadonlySet<string> = new Set([".", ".."]);

function isSafeSegment(segment: string): boolean {
  return segment.length > 0 && !TRAVERSAL_SEGMENTS.has(segment) && !FORBIDDEN_SEGMENT_CHARACTERS.test(segment);
}

/**
 * Maps a requested asset path to an absolute file path inside `contentDir`, or null.
 *
 * Pure: it never touches the disk. Null means "answer 404 and do not read anything": non-image
 * extension, empty / `.` / `..` segments, separators, drive letters, null bytes, percent-encoding,
 * or a resolved path that would leave the content directory.
 */
export function resolveWikiAssetPath(contentDir: string, requestedSegments: ReadonlyArray<string>): string | null {
  if (requestedSegments.length === 0 || !requestedSegments.every(isSafeSegment)) return null;

  const fileName = requestedSegments[requestedSegments.length - 1];
  if (!ALLOWED_ASSET_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return null;

  // Intentional: the wiki reads repo content at runtime, so Turbopack must not trace these paths.
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), contentDir);
  const resolved = path.resolve(/*turbopackIgnore: true*/ root, ...requestedSegments);
  const relative = path.relative(root, resolved);
  const staysInside = relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);

  return staysInside ? resolved : null;
}
