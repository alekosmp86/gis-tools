import type { ReportKind } from "../constants";
import type { HistoryState } from "../domain/plan";
import type { DbConnection } from "../../types";
import type { LoadResult, ParsedCut, ReportRow } from "../types";

export interface LoadRequest {
  readonly cuts: ReadonlyArray<ParsedCut>;
  readonly acceptShrink: boolean;
}

/**
 * Everything the handlers need from the database. A fake implements it in handler tests; the
 * `pg` implementation runs the same query functions the PGlite tests run.
 */
export interface IndicatorsRepository {
  /** Read-only: privileges and the rows stored for each date. Writes nothing. */
  inspectHistory(connection: DbConnection, fechaacts: ReadonlyArray<string>): Promise<HistoryState>;
  /** One transaction: re-checks the plan, then writes every cut or none. Throws `LoadRefusedError` before writing. */
  loadCuts(connection: DbConnection, request: LoadRequest): Promise<LoadResult>;
  /** Read-only: the rows of one report. */
  readReport(connection: DbConnection, kind: ReportKind): Promise<ReportRow[]>;
}
