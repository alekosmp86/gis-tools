import { SHP_PREFIX_TABLE } from "./types.ts";
import type { ShpTable } from "./types.ts";

const BYTES_PER_KIB = 1024;
const KIB_PER_GIB = 1024;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const GIB = BYTES_PER_KIB * BYTES_PER_KIB * KIB_PER_GIB;
export const UPLOAD_CAP_BYTES = 4 * GIB;

export const RETENTION_MS = 7 * MS_PER_DAY;
export const ABANDONED_UPLOAD_MS = 2 * MS_PER_HOUR;
export const DEAD_JOB_HEARTBEAT_MS = 60 * MS_PER_SECOND;
export const CORRUPT_LOCK_STALE_MS = 60 * MS_PER_SECOND;
/** A pid that still answers but whose heartbeat is this old is treated as a reused pid: the job is dead. */
export const PID_REUSE_HEARTBEAT_BOUND_MS = 10 * DEAD_JOB_HEARTBEAT_MS;
export const READY_ABANDONED_MS = 24 * MS_PER_HOUR;
/** A READY job that owns a table lock with a dead pid frees the table only after this grace. */
export const READY_LOCK_GRACE_MS = 2 * MS_PER_MINUTE;
/** A `start.lock` younger than this means a start is in progress: nothing may sweep that job. */
export const START_MARKER_FRESH_MS = 1 * MS_PER_MINUTE;

export const HEARTBEAT_INTERVAL_MS = 2 * MS_PER_SECOND;
export const CANCEL_POLL_INTERVAL_MS = 1 * MS_PER_SECOND;
export const PROGRESS_WRITE_THROTTLE_MS = 1 * MS_PER_SECOND;
export const HARD_KILL_GRACE_MS = 15 * MS_PER_SECOND;

export const STATUS_RENAME_RETRIES = 3;
export const STATUS_RENAME_BACKOFF_MS = 25;
/** Terminal and state-changing writes are never superseded, so they keep retrying this long. */
export const STATUS_DURABLE_BUDGET_MS = 10 * MS_PER_SECOND;
export const STATUS_DURABLE_BACKOFF_START_MS = 25;
export const STATUS_DURABLE_BACKOFF_CAP_MS = 500;
/** How many times the runtime repeats a whole terminal write (each with the durable budget). */
export const STATUS_FINAL_WRITE_ATTEMPTS = 2;
export const STATUS_READ_RETRIES = 3;
export const STATUS_READ_BACKOFF_MS = 20;

export const PG_CONNECTION_TIMEOUT_MS = 15 * MS_PER_SECOND;
export const PG_KEEPALIVE_INITIAL_DELAY_MS = 10 * MS_PER_SECOND;
export const PG_APPLICATION_NAME = "coverage-loads-shp-job";
export const PG_TCP_KEEPALIVES_IDLE_S = 30;
export const PG_TCP_KEEPALIVES_INTERVAL_S = 10;
export const PG_TCP_KEEPALIVES_COUNT = 6;

export const SCRUBBED_SECRET = "***";

const MIN_EXPECTED_MS = 5 * MS_PER_MINUTE;
export const EXPECTED_MS_BY_TABLE: Readonly<Record<ShpTable, number>> = {
  cobertura5g: MIN_EXPECTED_MS,
  nbiot: 35 * MS_PER_MINUTE,
  wcdma: 35 * MS_PER_MINUTE,
  lte: 70 * MS_PER_MINUTE,
};

export const SHP_TABLES: readonly ShpTable[] = Object.values(SHP_PREFIX_TABLE);

/**
 * Work tables of the new loader. Deliberately distinct from the legacy GeoKettle `stg_<table>`
 * tables so the two processes can never trample each other.
 */
const STAGE_TABLE_PREFIX = "shp_stage_";
const WORK_TABLE_PREFIX = "shp_work_";

export function stageTableName(table: ShpTable): string {
  return `${STAGE_TABLE_PREFIX}${table}`;
}

export function workTableName(table: ShpTable): string {
  return `${WORK_TABLE_PREFIX}${table}`;
}

export const EXIT_CODE = { SUCCEEDED: 0, FAILED: 1, CANCELLED: 2, BAD_CONFIG: 3, STATUS_WRITE_FAILED: 4 } as const;

/**
 * Two-int advisory lock key `(namespace, table id)`, taken by the loader with `pg_try_advisory_lock`
 * for the whole run. The plan only reads `pg_locks` for it and never takes it.
 */
export const ADVISORY_LOCK_NAMESPACE = 0x4c4f4144;
export const ADVISORY_LOCK_ID_BY_TABLE: Readonly<Record<ShpTable, number>> = {
  cobertura5g: 1,
  wcdma: 2,
  nbiot: 3,
  lte: 4,
};

export const TARGET_SCHEMA = "public";
export const TABLE_PRIVILEGES_REQUIRED = ["DELETE", "INSERT", "SELECT"] as const;
export const SCHEMA_PRIVILEGE_REQUIRED = "CREATE";

/** Written to the `fuente` column of every loaded row (same value as the legacy GeoKettle job). */
export const LOAD_SOURCE = "EXTERNO/F.Maresca";

export const SUBDIVIDE_MAX_VERTICES = 256;
/** Repair can add a vertex to a piece, so the gate has headroom over the 256 split target. */
export const GATE_MAX_PIECE_VERTICES = 1024;
export const GATE_AREA_RELATIVE_TOLERANCE = 1e-6;

/** Upper bound of raw vertices handed to one `ST_Subdivide` statement (a bigger record runs alone). */
export const SUBDIVIDE_BATCH_POINTS = 2_000_000;
export const REPAIR_BATCH_PIECES = 2000;

export const SHORT_STATEMENT_TIMEOUT_MS = 2 * MS_PER_MINUTE;
export const LONG_STATEMENT_TIMEOUT_MS = 4 * MS_PER_HOUR;
export const SWAP_LOCK_TIMEOUT_MS = 30 * MS_PER_SECOND;
export const CLEANUP_RETRIES = 2;
export const COPY_ABORT_WAIT_MS = 10 * MS_PER_SECOND;
