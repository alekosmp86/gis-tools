import type { JobMode, JobTarget } from "./job/types.ts";

export interface ShpPlan {
  readonly jobId: string;
  readonly target: JobTarget;
  readonly defaultMode: JobMode;
  readonly availableModes: readonly JobMode[];
  readonly currentRows: number | null;
  readonly leftovers: readonly string[];
  readonly privilegeShortfalls: readonly string[];
  readonly blockers: readonly string[];
  readonly expectedMs: number;
  readonly canStart: boolean;
}

/** What the plan reads from the database; the domain turns it into messages. */
export interface ShpDbInspection {
  readonly tableExists: boolean;
  /** Missing privileges on the target table (empty when it does not exist). */
  readonly missingTablePrivileges: readonly string[];
  readonly schemaCreateGranted: boolean;
  readonly postgisAvailable: boolean;
  /** Names of the `shp_stage_<table>` / `shp_work_<table>` tables that already exist. */
  readonly leftovers: readonly string[];
  readonly advisoryLockHeld: boolean;
  readonly currentRows: number | null;
}

export interface JobSummary {
  readonly jobId: string;
  readonly target: JobTarget;
  readonly mode: JobMode;
  readonly state: string;
  readonly stage: string | null;
  readonly stageFraction: number;
  readonly overallFraction: number;
  readonly startedAt: string | null;
  readonly updatedAt: string;
  readonly errorMessage: string | null;
  readonly stale: boolean;
}
