import { randomUUID } from "node:crypto";
import path from "node:path";
import { SHP_TABLES } from "./constants.ts";
import type { ShpTable } from "./types.ts";

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const JOBS_DIR_NAME = "jobs";
export const LOCKS_DIR_NAME = "locks";

export interface JobPaths {
  dir: string;
  upload: string;
  source: string;
  status: string;
  statusTmp: string;
  log: string;
  cancel: string;
  startLock: string;
}

export function defaultRootDir(): string {
  return path.join(process.cwd(), "data", "coverage-loads");
}

export function newJobId(): string {
  return randomUUID();
}

/** The single path-traversal guard: every path under `jobs/` is built from an id that passed it. */
export function isValidJobId(value: unknown): value is string {
  return typeof value === "string" && JOB_ID_PATTERN.test(value);
}

export function assertJobId(value: unknown): string {
  if (!isValidJobId(value)) throw new Error("Identificador de carga inválido.");
  return value;
}

export function jobsDir(rootDir: string): string {
  return path.join(rootDir, JOBS_DIR_NAME);
}

export function locksDir(rootDir: string): string {
  return path.join(rootDir, LOCKS_DIR_NAME);
}

export function jobPaths(rootDir: string, jobId: string): JobPaths {
  const dir = path.join(jobsDir(rootDir), assertJobId(jobId));
  return {
    dir,
    upload: path.join(dir, "upload.part"),
    source: path.join(dir, "source.shp"),
    status: path.join(dir, "status.json"),
    statusTmp: path.join(dir, "status.json.tmp"),
    log: path.join(dir, "job.log"),
    cancel: path.join(dir, "cancel.request"),
    startLock: path.join(dir, "start.lock"),
  };
}

export function lockPath(rootDir: string, table: ShpTable): string {
  if (!SHP_TABLES.includes(table)) throw new Error("Tabla destino inválida.");
  return path.join(locksDir(rootDir), `${table}.json`);
}
