import type { RunSession } from "../../cargar-padrones/types";
import { referenceScanOf, type ReferenceScan } from "../domain/referenceScan";
import { referenceTablesScanSql } from "../domain/replacementSql";

/** AP-102: every table of the carto schema, other than the destination, that carries an id_padron column. Catalog-only and read-only: it never fails the run, and it fails closed (a table the role cannot read blocks the deletion). */
export async function scanReferenceTables(session: RunSession, schema: string, excludedTable: string): Promise<ReferenceScan> {
  const result = await session.query(referenceTablesScanSql(schema, excludedTable));
  return referenceScanOf(
    result.rows.map((row) => ({ schema: String(row.schema), table: String(row.table), readable: row.readable === true }))
  );
}
