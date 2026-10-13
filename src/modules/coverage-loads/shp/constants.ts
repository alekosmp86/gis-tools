import { HARD_KILL_GRACE_MS } from "./job/constants.ts";

const BYTES_PER_KIB = 1024;
export const BYTES_PER_MIB = BYTES_PER_KIB * BYTES_PER_KIB;
export const BYTES_PER_GIB = BYTES_PER_MIB * BYTES_PER_KIB;
const MS_PER_SECOND = 1000;

export const UPLOAD_CONTENT_TYPE = "application/octet-stream";
export const HEADER_FILE_NAME = "x-file-name";
export const HEADER_FILE_SIZE = "x-file-size";

/** Free space required on the data volume: the file times this factor, plus the fixed margin. */
export const DISK_HEADROOM_FACTOR = 1.2;
export const DISK_SAFETY_MARGIN_BYTES = 512 * BYTES_PER_MIB;

export const UPLOAD_STATUS_THROTTLE_MS = 1 * MS_PER_SECOND;
export const FILE_REMOVE_MAX_RETRIES = 5;
export const FILE_REMOVE_RETRY_DELAY_MS = 100;

export const PLAN_STATEMENT_TIMEOUT_MS = 60 * MS_PER_SECOND;

export const LOG_TAIL_DEFAULT_LINES = 200;
export const LOG_TAIL_MAX_LINES = 5000;
/** The most that is ever read from job.log into memory: its last bytes. */
export const LOG_READ_CAP_BYTES = 4 * BYTES_PER_MIB;
export const LOG_CONTENT_TYPE = "text/plain; charset=utf-8";

/** A cancel that the job has ignored for this long gets its process killed by the lazy sweep. */
export const FORCE_KILL_AFTER_MS = 2 * HARD_KILL_GRACE_MS;

/** Relative to the process working directory (the project root for `next dev` / `next start`). */
export const JOB_ENTRY_RELATIVE_PATH = ["src", "modules", "coverage-loads", "shp", "job", "jobEntry.ts"] as const;
export const JOB_NODE_ARGS = ["--max-old-space-size=1536", "--disable-warning=ExperimentalWarning"] as const;
export const CHILD_ENV_ALLOW_LIST = ["PATH", "SystemRoot", "windir", "TEMP", "TMP", "TMPDIR", "TZ", "LANG", "LC_ALL"] as const;

/** Dev/test only: `fake` runs the job against the fake pipeline, which never touches a database. */
export const PIPELINE_ENV_VAR = "COVERAGE_LOADS_SHP_PIPELINE";
export const FAKE_STAGE_MS = 1500;

export {
  ADVISORY_LOCK_ID_BY_TABLE,
  ADVISORY_LOCK_NAMESPACE,
  SCHEMA_PRIVILEGE_REQUIRED,
  TABLE_PRIVILEGES_REQUIRED,
  TARGET_SCHEMA,
} from "./job/constants.ts";

export const JOB_ID_FIELD = "jobId";
export const TAIL_FIELD = "tail";
