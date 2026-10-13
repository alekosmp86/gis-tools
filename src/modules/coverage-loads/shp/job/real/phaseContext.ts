import type { JobContext } from "../pipeline.ts";
import type { PgSession } from "./pgSession.ts";
import type { TableIdentifiers } from "./realQueries.ts";

/** What every phase needs: the job context (progress, log, cancel), the work connection and the table names. */
export interface PhaseContext {
  readonly job: JobContext;
  readonly session: PgSession;
  readonly names: TableIdentifiers;
}
