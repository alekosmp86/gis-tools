import { isValidJobId } from "./layout.ts";
import type { FakeConfig } from "./fakePipeline.ts";
import type { JobTiming } from "./runtime.ts";
import { JOB_MODE, JOB_STAGE } from "./types.ts";
import type { JobDbConnection, JobMode, JobStageId } from "./types.ts";

/** The ONE JSON object the Next-side API pipes to the job's stdin. Never in argv or env. */
export interface JobSpawnConfig {
  jobId: string;
  mode: JobMode;
  rootDir?: string;
  pipeline: "fake" | "real";
  fake?: FakeConfig;
  connection: JobDbConnection;
  secretsToScrub?: string[];
  timing?: Partial<JobTiming>;
}

export type ParsedJobConfig = { ok: true; config: JobSpawnConfig } | { ok: false; message: string };

const MAX_PORT = 65535;
const TIMING_KEYS: readonly (keyof JobTiming)[] = ["heartbeatMs", "cancelPollMs", "hardKillGraceMs", "progressThrottleMs"];
const STAGE_IDS: readonly string[] = Object.values(JOB_STAGE);

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseConnection(value: unknown): JobDbConnection | null {
  if (!isRecord(value)) return null;
  const { host, port, db_name, user, password } = value;
  if (!isNonEmptyString(host) || !isNonEmptyString(db_name) || !isNonEmptyString(user)) return null;
  if (typeof password !== "string") return null;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > MAX_PORT) return null;
  return { host, port, db_name, user, password };
}

function parseTiming(value: unknown): Partial<JobTiming> | null {
  if (!isRecord(value)) return null;
  const timing: Partial<JobTiming> = {};
  for (const key of TIMING_KEYS) {
    if (value[key] === undefined) continue;
    if (!isPositiveNumber(value[key])) return null;
    timing[key] = value[key];
  }
  return timing;
}

function isStageId(value: unknown): value is JobStageId {
  return typeof value === "string" && STAGE_IDS.includes(value);
}

function parseFake(value: unknown): FakeConfig | null {
  if (!isRecord(value)) return null;
  const { stageMs, failAtStage, holdStage, ignoreCancel } = value;
  const stageMsValid = isPositiveNumber(stageMs) || (isRecord(stageMs) && Object.values(stageMs).every(isPositiveNumber));
  if (!stageMsValid) return null;
  if (failAtStage !== undefined && !isStageId(failAtStage)) return null;
  if (holdStage !== undefined && !isStageId(holdStage)) return null;
  if (ignoreCancel !== undefined && typeof ignoreCancel !== "boolean") return null;
  return value as unknown as FakeConfig;
}

function bad(field: string): ParsedJobConfig {
  return { ok: false, message: `Configuración inválida: ${field}.` };
}

function parseOptionalParts(raw: Raw): { ok: true; parts: Partial<JobSpawnConfig> } | { ok: false; field: string } {
  const parts: Partial<JobSpawnConfig> = {};
  if (raw.rootDir !== undefined) {
    if (!isNonEmptyString(raw.rootDir)) return { ok: false, field: "rootDir" };
    parts.rootDir = raw.rootDir;
  }
  if (raw.secretsToScrub !== undefined) {
    if (!Array.isArray(raw.secretsToScrub) || !raw.secretsToScrub.every((s) => typeof s === "string")) return { ok: false, field: "secretsToScrub" };
    parts.secretsToScrub = raw.secretsToScrub as string[];
  }
  if (raw.timing !== undefined) {
    const timing = parseTiming(raw.timing);
    if (!timing) return { ok: false, field: "timing" };
    parts.timing = timing;
  }
  if (raw.fake !== undefined) {
    const fake = parseFake(raw.fake);
    if (!fake) return { ok: false, field: "fake" };
    parts.fake = fake;
  }
  return { ok: true, parts };
}

/** Strict validation. Messages name the field only: they never echo a value (values may be secrets). */
export function parseJobConfig(text: string): ParsedJobConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "Configuración inválida: JSON mal formado." };
  }
  if (!isRecord(raw)) return bad("se esperaba un objeto");
  if (!isValidJobId(raw.jobId)) return bad("jobId");
  if (raw.mode !== JOB_MODE.LOAD && raw.mode !== JOB_MODE.TEST) return bad("mode");
  if (raw.pipeline !== "fake" && raw.pipeline !== "real") return bad("pipeline");
  const connection = parseConnection(raw.connection);
  if (!connection) return bad("connection");
  const optional = parseOptionalParts(raw);
  if (!optional.ok) return bad(optional.field);
  if (raw.pipeline === "fake" && !optional.parts.fake) return bad("fake");
  return { ok: true, config: { jobId: raw.jobId, mode: raw.mode, pipeline: raw.pipeline, connection, ...optional.parts } };
}
