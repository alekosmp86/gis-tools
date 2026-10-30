import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BACKUP_DIRECTORY_NAME = "gis-tools-routine-jobs";
const PRIVATE_DIRECTORY_MODE = 0o700;
const BACKUP_FILE_PATTERN = /^padron-revert-.*\.sql\.gz$/;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const REGISTRY_KEY = "__gisToolsRevertBackups";

export interface RevertBackupFile {
  filePath: string;
  fileName: string;
  bytes: number;
}

interface RevertBackupEntry extends RevertBackupFile {
  createdAt: number;
}

interface RegistryHolder {
  [REGISTRY_KEY]?: Map<string, RevertBackupEntry>;
}

/* On globalThis, like the job store: the run and the download route may load this module in different bundles. */
const registryOf = (): Map<string, RevertBackupEntry> => {
  const holder = globalThis as typeof globalThis & RegistryHolder;
  holder[REGISTRY_KEY] ??= new Map<string, RevertBackupEntry>();
  return holder[REGISTRY_KEY];
};

export const revertBackupDirectory = (): string => path.join(os.tmpdir(), BACKUP_DIRECTORY_NAME);

const ownedByAnotherUser = (info: Stats): boolean => typeof process.getuid === "function" && info.uid !== process.getuid();

/** Creates the private folder of the backups and refuses one that is a link or belongs to another user. */
export async function ensureRevertBackupDirectory(): Promise<string> {
  const directory = revertBackupDirectory();
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("La carpeta de respaldos no es una carpeta normal.");
  if (ownedByAnotherUser(info)) throw new Error("La carpeta de respaldos pertenece a otro usuario.");
  return directory;
}

export function getRevertBackup(token: string): RevertBackupEntry | undefined {
  return registryOf().get(token);
}

/** Registers a finished backup file and returns the token the client downloads it with. */
export async function registerRevertBackup(file: RevertBackupFile, now: number = Date.now()): Promise<string> {
  await removeExpiredRevertBackups(now);
  const token = randomUUID();
  registryOf().set(token, { ...file, createdAt: now });
  return token;
}

async function removeExpiredRevertBackups(now: number): Promise<void> {
  const cutoff = now - RETENTION_MS;
  const holder = globalThis as typeof globalThis & RegistryHolder;
  holder[REGISTRY_KEY] = new Map(Array.from(registryOf()).filter(([, entry]) => entry.createdAt >= cutoff));
  const directory = revertBackupDirectory();
  const names = await readdir(directory).catch((): string[] => []);
  await Promise.all(
    names
      .filter((name) => BACKUP_FILE_PATTERN.test(name))
      .map((name) => removeIfOlder(path.join(directory, name), cutoff))
  );
}

async function removeIfOlder(filePath: string, cutoff: number): Promise<void> {
  const info = await stat(filePath).catch(() => undefined);
  if (info === undefined || info.mtimeMs >= cutoff) return;
  await rm(filePath, { force: true }).catch(() => undefined);
}
