import { GEOMETRY_TYPE_NAME } from "../constants";
import { REASSIGN_BLOCKER } from "./reassignBlockers";
import type { ReassignCompanion, ReferenceTable } from "./replacementSql";

/** The outcome of AP-102's catalog scan. `tables` are the readable referencing tables the counts run over; a non-null
    `blockedReason` means the scan cannot vouch for "no references", so no padrón is deleted (fail closed). */
export interface ReferenceScan {
  tables: readonly ReferenceTable[];
  blockedReason: string | null;
}

export interface ReferenceScanRow {
  schema: string;
  table: string;
  readable: boolean;
  updatable?: boolean;
  primaryKeyColumns?: number;
  primaryKeyColumn?: string | null;
  geometryColumns?: number;
  geometryColumn?: string | null;
  geometryType?: string | null;
  companionTable?: string | null;
  companionColumn?: string | null;
  companionRefColumn?: string | null;
  companionPrimaryKeyColumns?: number;
  companionPrimaryKeyColumn?: string | null;
  companionGeometryColumns?: number;
  companionGeometryColumn?: string | null;
  companionGeometryType?: string | null;
  companionReadable?: boolean;
  companionJoinColumns?: number;
}

export interface ReferenceScanOptions {
  /** AP-114: without an address master table no subdivided padrón can be reassigned. */
  reassignAllowed?: boolean;
}

const NO_TABLES_BLOCKED_REASON = "No se encontraron tablas que referencien padrones: no se eliminan padrones faltantes.";

export const NO_REFERENCE_SCAN: ReferenceScan = { tables: [], blockedReason: NO_TABLES_BLOCKED_REASON };

const labelOf = ({ schema, table }: ReferenceTable): string => `${schema}.${table}`;

const unreadableReasonOf = (unreadable: readonly ReferenceTable[]): string =>
  `No se pueden leer las tablas que referencian padrones (${unreadable.map(labelOf).join(", ")}): no se eliminan padrones faltantes.`;

/** AP-110: the companion that gives the point of a table with no geometry of its own. It needs exactly one geometry or geography column, a primary key of exactly that one join column (so a join never multiplies rows), both join columns present and SELECT on it. */
function companionPointOf(row: ReferenceScanRow): { geometryColumn: string; geography: boolean; companion: ReassignCompanion } | null {
  const { companionTable, companionColumn, companionRefColumn, companionGeometryColumn } = row;
  if (!companionTable || !companionColumn || !companionRefColumn || !companionGeometryColumn) return null;
  if (row.companionPrimaryKeyColumns !== 1 || row.companionPrimaryKeyColumn !== companionColumn) return null;
  if (row.companionGeometryColumns !== 1 || row.companionJoinColumns !== 2 || row.companionReadable !== true) return null;
  return {
    geometryColumn: companionGeometryColumn,
    geography: row.companionGeometryType === GEOMETRY_TYPE_NAME.GEOGRAPHY,
    companion: { schema: row.schema, table: companionTable, column: companionRefColumn, companionColumn },
  };
}

/** AP-110: exactly one primary key column, a point (its own single geometry or geography column, or its companion's when it has none), and the role may update id_padron. */
function reassignOf(row: ReferenceScanRow): Pick<ReferenceTable, "reassign" | "reassignBlocker"> {
  if (row.primaryKeyColumns !== 1 || !row.primaryKeyColumn) return { reassignBlocker: REASSIGN_BLOCKER.NO_PRIMARY_KEY };
  const own = row.geometryColumns === 1 && row.geometryColumn ? { geometryColumn: row.geometryColumn, geography: row.geometryType === GEOMETRY_TYPE_NAME.GEOGRAPHY } : null;
  const point = own ?? (row.geometryColumns === 0 ? companionPointOf(row) : null);
  if (point === null) return { reassignBlocker: REASSIGN_BLOCKER.NO_GEOMETRY };
  if (row.updatable !== true) return { reassignBlocker: REASSIGN_BLOCKER.NO_UPDATE_PRIVILEGE };
  return { reassign: { pkColumn: row.primaryKeyColumn, ...point } };
}

const tableOf = (row: ReferenceScanRow, reassignAllowed: boolean): ReferenceTable => ({
  schema: row.schema,
  table: row.table,
  ...(reassignAllowed ? reassignOf(row) : { reassignBlocker: REASSIGN_BLOCKER.NO_ADDRESS_MASTER }),
});

/** No table at all, or any table the role cannot SELECT from, blocks every deletion; an unreadable table is never read as zero references. */
export function referenceScanOf(rows: readonly ReferenceScanRow[], { reassignAllowed = true }: ReferenceScanOptions = {}): ReferenceScan {
  const tables = rows.filter((row) => row.readable).map((row) => tableOf(row, reassignAllowed));
  const unreadable = rows.filter((row) => !row.readable).map(({ schema, table }) => ({ schema, table }));
  if (rows.length === 0) return NO_REFERENCE_SCAN;
  return { tables, blockedReason: unreadable.length === 0 ? null : unreadableReasonOf(unreadable) };
}
