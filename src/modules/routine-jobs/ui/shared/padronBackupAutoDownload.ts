const STORAGE_KEY = "gisTools.routineJobs.actualizarPadron.downloadedBackups";

function storedTokens(): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((token): token is string => typeof token === "string") : [];
  } catch {
    return [];
  }
}

function persist(tokens: Set<string>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...tokens]));
  } catch {
    return;
  }
}

const downloadedTokens = new Set<string>(storedTokens());

/** Returns true only the first time a token is seen in this session: the caller then downloads it automatically. */
export function claimAutomaticBackupDownload(token: string): boolean {
  if (downloadedTokens.has(token)) return false;
  downloadedTokens.add(token);
  persist(downloadedTokens);
  return true;
}
