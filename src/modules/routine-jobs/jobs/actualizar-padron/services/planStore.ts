import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPlanRecord, isPlanId, isPlanRecord, PLAN_TTL_MS } from "../domain/plan";
import type { ActualizarPlanRecord, PadronGeometryChange, PlanSnapshot } from "../types";
import { ensureRevertBackupDirectory, revertBackupDirectory } from "./revertBackupStore";

const PLANS_DIRECTORY_NAME = "plans";
const PRIVATE_DIRECTORY_MODE = 0o700;
const PLAN_FILE_MODE = 0o600;
const PLAN_FILE_EXTENSION = ".json";
const PLAN_ID_BYTES = 16;

const plansDirectory = (): string => path.join(revertBackupDirectory(), PLANS_DIRECTORY_NAME);

const planFilePath = (planId: string): string => path.join(plansDirectory(), `${planId}${PLAN_FILE_EXTENSION}`);

async function ensurePlansDirectory(): Promise<void> {
  await ensureRevertBackupDirectory();
  const directory = plansDirectory();
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("La carpeta de planes no es una carpeta normal.");
}

async function removeIfExpired(filePath: string, cutoff: number): Promise<void> {
  const info = await stat(filePath).catch(() => undefined);
  if (info === undefined || info.mtimeMs >= cutoff) return;
  await rm(filePath, { force: true }).catch(() => undefined);
}

async function removeExpiredPlans(nowMs: number): Promise<void> {
  const directory = plansDirectory();
  const names = await readdir(directory).catch((): string[] => []);
  const cutoff = nowMs - PLAN_TTL_MS;
  await Promise.all(
    names
      .filter((name) => name.endsWith(PLAN_FILE_EXTENSION))
      .map((name) => removeIfExpired(path.join(directory, name), cutoff))
  );
}

const newPlanId = (): string => randomBytes(PLAN_ID_BYTES).toString("hex");

/** Stores the analysis as a plan and returns its id. The record holds no password; its pending geometry list is served as a CSV only. */
export async function savePlanRecord(
  paramsFingerprint: string,
  snapshot: PlanSnapshot,
  pendingGeometryChanges: readonly PadronGeometryChange[],
  nowMs: number = Date.now()
): Promise<string> {
  await ensurePlansDirectory();
  await removeExpiredPlans(nowMs);
  const record = buildPlanRecord(newPlanId(), paramsFingerprint, snapshot, pendingGeometryChanges, nowMs);
  await writeFile(planFilePath(record.planId), JSON.stringify(record), { flag: "wx", mode: PLAN_FILE_MODE });
  return record.planId;
}

/** Undefined for an unknown id, a missing file or a file that is not a plan. */
export async function readPlanRecord(planId: string): Promise<ActualizarPlanRecord | undefined> {
  if (!isPlanId(planId)) return undefined;
  const text = await readFile(planFilePath(planId), "utf8").catch((): undefined => undefined);
  if (text === undefined) return undefined;
  const parsed: unknown = parseJson(text);
  return isPlanRecord(parsed) ? parsed : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Single use: a plan is removed once the run that consumed it has committed. */
export async function removePlanRecord(planId: string): Promise<void> {
  if (!isPlanId(planId)) return;
  await rm(planFilePath(planId), { force: true });
}
