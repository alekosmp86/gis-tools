import type { PgClientLike } from "../../../shared/pgClient";
import { mapFeature } from "../../domain/featureMapping";
import type { LayerColumns, PageWriter, SigraLayerDefinition } from "../../types";
import { firstRow } from "./queryRows";
import {
  FINAL_TYPES_SQL,
  createStagingKeyIndexSql,
  createStagingSql,
  pageInsertSql,
  pageParameters,
  stagingColumnTypes,
} from "./stagingQueries";
import { countRowsSql } from "./stateQueries";
import { deleteFinalTableSql, lockFinalTableSql, swapInsertSql } from "./swapQueries";

async function readFinalTypes(client: PgClientLike, layer: SigraLayerDefinition): Promise<Record<string, string>> {
  const result = await client.query(FINAL_TYPES_SQL, [layer.finalTable]);
  const rows = result.rows as Array<Record<string, unknown>>;
  return Object.fromEntries(rows.map((row) => [String(row.column_name), String(row.column_type)]));
}

/** Creates the TEMP staging table and returns the function that inserts one page into it. */
export async function createStaging(
  client: PgClientLike,
  layer: SigraLayerDefinition,
  columns: LayerColumns,
): Promise<PageWriter> {
  const types = stagingColumnTypes(layer, columns, await readFinalTypes(client, layer));
  await client.query(createStagingSql(columns, types), []);
  await client.query(createStagingKeyIndexSql(layer), []);
  const insertSql = pageInsertSql(layer, columns, types);
  return async (features) => {
    const mapped = features.map((feature) => mapFeature(layer, feature));
    const row = await firstRow(client, insertSql, pageParameters(columns, mapped));
    return Number(row.inserted);
  };
}

export async function countFinalRows(client: PgClientLike, layer: SigraLayerDefinition): Promise<number> {
  return Number((await firstRow(client, countRowsSql(layer.finalTable))).total);
}

/** Replaces the final table's content with the staging table's; returns the rows actually inserted. */
export async function swapFinalTable(
  client: PgClientLike,
  layer: SigraLayerDefinition,
  columns: LayerColumns,
): Promise<number> {
  await client.query(lockFinalTableSql(layer), []);
  await client.query(deleteFinalTableSql(layer), []);
  return Number((await firstRow(client, swapInsertSql(layer, columns))).inserted);
}
