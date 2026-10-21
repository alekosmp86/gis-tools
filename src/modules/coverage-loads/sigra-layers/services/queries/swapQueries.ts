import { STAGING_TABLE } from "../../constants";
import type { LayerColumns, SigraLayerDefinition } from "../../types";
import { quoteIdentifier, quoteQualified } from "./identifiers";

export const lockFinalTableSql = (layer: SigraLayerDefinition): string =>
  `LOCK TABLE ${quoteQualified(layer.finalTable)} IN SHARE ROW EXCLUSIVE MODE`;

export const deleteFinalTableSql = (layer: SigraLayerDefinition): string =>
  `DELETE FROM ${quoteQualified(layer.finalTable)}`;

export function swapInsertSql(layer: SigraLayerDefinition, columns: LayerColumns): string {
  const list = columns.swapColumns.map(quoteIdentifier).join(", ");
  return `WITH inserted AS (
  INSERT INTO ${quoteQualified(layer.finalTable)} (${list})
  SELECT ${list} FROM ${quoteIdentifier(STAGING_TABLE)}
  RETURNING 1
)
SELECT count(*)::int AS inserted FROM inserted`;
}
