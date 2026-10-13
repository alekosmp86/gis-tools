const FILE_NAME_PATTERN = /filename="?([^";]+)"?/i;

/** The file name a server offers in a `Content-Disposition` header, or `null` when it gives none. */
export function parseContentDispositionFileName(header: string | null): string | null {
  if (header === null) return null;
  const match = FILE_NAME_PATTERN.exec(header);
  return match ? match[1].trim() : null;
}
