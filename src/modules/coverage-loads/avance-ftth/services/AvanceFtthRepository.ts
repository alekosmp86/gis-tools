import type { DbConnection } from "../../types";
import type { ReportKind } from "../constants";
import type { AvanceDbState, AvanceLoadResult, ParsedAvanceFile, ReportData } from "../types";

export interface LoadRequest {
  readonly files: ReadonlyArray<ParsedAvanceFile>;
  readonly dryRun: boolean;
}

/**
 * Everything the handlers need from the database. A fake implements it in handler tests; the `pg`
 * implementation runs the same query functions the PGlite tests run.
 */
export interface AvanceFtthRepository {
  /** Read-only: privileges, current table contents and the district statuses. Writes nothing. */
  inspect(connection: DbConnection): Promise<AvanceDbState>;
  /** One transaction: re-checks the plan, then writes everything or nothing. Throws `LoadRefusedError` before writing. */
  load(connection: DbConnection, request: LoadRequest): Promise<AvanceLoadResult>;
  /** Read-only: the rows of the requested reports, each failure isolated. */
  readReports(connection: DbConnection, kinds: ReadonlyArray<ReportKind>): Promise<ReportData[]>;
}
