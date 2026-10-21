import { AUDIT_TABLE, SqlPrivilege, type SigraLayerId } from "../../constants";
import { resolveLayerColumns } from "../../domain/layerColumns";
import { getSigraLayer } from "../../domain/layerRegistry";
import type { Queryable } from "../../../shared/pgClient";
import { findPrivilegeShortfalls } from "../../../shared/tablePrivileges";
import type { LayerDbState, SigraDbState } from "../../types";
import { firstRow } from "./queryRows";
import {
  AUDIT_AVAILABLE_SQL,
  CAN_CREATE_TEMP_SQL,
  SERIAL_SEQUENCES_SQL,
  tableStatsSql,
} from "./stateQueries";

const REQUIRED_TABLE_PRIVILEGES = [SqlPrivilege.SELECT, SqlPrivilege.INSERT, SqlPrivilege.DELETE];

async function readMissingSequenceUsages(queryable: Queryable, table: string): Promise<string[]> {
  const result = await queryable.query(SERIAL_SEQUENCES_SQL, [table]);
  return (result.rows as Array<Record<string, unknown>>).flatMap((row) =>
    row.granted === true ? [] : [`${SqlPrivilege.USAGE}:${String(row.sequence_name)}`],
  );
}

async function readTableStats(queryable: Queryable, table: string, dateColumn: string) {
  const row = await firstRow(queryable, tableStatsSql(table, dateColumn));
  return { rowCount: Number(row.row_count), lastUpdated: row.last_updated === null ? null : String(row.last_updated) };
}

async function readLayerState(queryable: Queryable, layerId: SigraLayerId): Promise<LayerDbState> {
  const layer = getSigraLayer(layerId);
  const [shortfall] = await findPrivilegeShortfalls(queryable, [
    { table: layer.finalTable, privileges: REQUIRED_TABLE_PRIVILEGES },
  ]);
  if (shortfall && !shortfall.tableExists) {
    return { layerId, tableExists: false, rowCount: null, lastUpdated: null, missingPrivileges: [] };
  }
  const missingPrivileges = [
    ...(shortfall?.missing ?? []),
    ...(await readMissingSequenceUsages(queryable, layer.finalTable)),
  ];
  if (missingPrivileges.includes(SqlPrivilege.SELECT)) {
    return { layerId, tableExists: true, rowCount: null, lastUpdated: null, missingPrivileges };
  }
  const stats = await readTableStats(queryable, layer.finalTable, resolveLayerColumns(layer).loadDateColumn);
  return { layerId, tableExists: true, ...stats, missingPrivileges };
}

async function readLayerStates(queryable: Queryable, layerIds: ReadonlyArray<SigraLayerId>): Promise<LayerDbState[]> {
  const states: LayerDbState[] = [];
  for (const layerId of layerIds) states.push(await readLayerState(queryable, layerId));
  return states;
}

export async function readSigraDbState(queryable: Queryable, layerIds: ReadonlyArray<SigraLayerId>): Promise<SigraDbState> {
  const layers = await readLayerStates(queryable, layerIds);
  const canCreateTemp = (await firstRow(queryable, CAN_CREATE_TEMP_SQL)).allowed === true;
  const auditAvailable = (await firstRow(queryable, AUDIT_AVAILABLE_SQL, [AUDIT_TABLE])).available === true;
  return { layers, canCreateTemp, auditAvailable };
}
