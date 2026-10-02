import type { AnalysisRow, DuplicateAnalysisParameters } from "../../types";
import { DUPLICATE_ANALYSIS_SQL, toQueryValues } from "./duplicateAnalysisQuery";
import { mapAnalysisRow } from "./mapAnalysisRow";

/** The slice of a driver the analysis needs; `pg.Client` and PGlite both satisfy it. */
export interface Queryable {
  query(text: string, values: unknown[]): Promise<{ rows: ReadonlyArray<unknown> }>;
}

/**
 * Runs the exported query text with bound values. The `pg` repository and the PGlite tests both
 * call this, so they execute identical SQL.
 */
export async function runDuplicateAnalysis(
  queryable: Queryable,
  parameters: DuplicateAnalysisParameters
): Promise<AnalysisRow[]> {
  const result = await queryable.query(DUPLICATE_ANALYSIS_SQL, toQueryValues(parameters));
  return result.rows.map((row) => mapAnalysisRow(row as Record<string, unknown>));
}
