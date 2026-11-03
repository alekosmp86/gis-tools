import type { RunSession } from "../../cargar-padrones/types";
import { referenceScanOf, type ReferenceScan, type ReferenceScanRow } from "../domain/referenceScan";
import { referenceTablesScanSql } from "../domain/replacementSql";
import { numberOf, textOf, type Row } from "../../shared/rowMapping";

const scanRowOf = (row: Row): ReferenceScanRow => ({
  schema: String(row.schema),
  table: String(row.table),
  readable: row.readable === true,
  updatable: row.updatable === true,
  primaryKeyColumns: numberOf(row.pk_columns),
  primaryKeyColumn: textOf(row.pk_column),
  geometryColumns: numberOf(row.geometry_columns),
  geometryColumn: textOf(row.geometry_column),
  geometryType: textOf(row.geometry_type),
  companionTable: textOf(row.companion_table),
  companionColumn: textOf(row.companion_column),
  companionRefColumn: textOf(row.companion_ref_column),
  companionPrimaryKeyColumns: numberOf(row.companion_pk_columns),
  companionPrimaryKeyColumn: textOf(row.companion_pk_column),
  companionGeometryColumns: numberOf(row.companion_geometry_columns),
  companionGeometryColumn: textOf(row.companion_geometry_column),
  companionGeometryType: textOf(row.companion_geometry_type),
  companionReadable: row.companion_readable === true,
  companionJoinColumns: numberOf(row.companion_join_columns),
});

/** AP-102: every table of the carto schema, other than the destination, that carries an id_padron column. Catalog-only and read-only: it never fails the run, and it fails closed (a table the role cannot read blocks the deletion). AP-110 reads the primary key and geometry facts of the same tables. */
export async function scanReferenceTables(
  session: RunSession,
  schema: string,
  excludedTable: string,
  reassignAllowed: boolean
): Promise<ReferenceScan> {
  const result = await session.query(referenceTablesScanSql(schema, excludedTable));
  return referenceScanOf(result.rows.map(scanRowOf), { reassignAllowed });
}
