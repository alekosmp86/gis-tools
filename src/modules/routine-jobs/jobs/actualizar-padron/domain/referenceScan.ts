import type { ReferenceTable } from "./replacementSql";

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
}

const NO_TABLES_BLOCKED_REASON = "No se encontraron tablas que referencien padrones: no se eliminan padrones faltantes.";

export const NO_REFERENCE_SCAN: ReferenceScan = { tables: [], blockedReason: NO_TABLES_BLOCKED_REASON };

const labelOf = ({ schema, table }: ReferenceTable): string => `${schema}.${table}`;

const unreadableReasonOf = (unreadable: readonly ReferenceTable[]): string =>
  `No se pueden leer las tablas que referencian padrones (${unreadable.map(labelOf).join(", ")}): no se eliminan padrones faltantes.`;

/** No table at all, or any table the role cannot SELECT from, blocks every deletion; an unreadable table is never read as zero references. */
export function referenceScanOf(rows: readonly ReferenceScanRow[]): ReferenceScan {
  const tables = rows.filter((row) => row.readable).map(({ schema, table }) => ({ schema, table }));
  const unreadable = rows.filter((row) => !row.readable).map(({ schema, table }) => ({ schema, table }));
  if (rows.length === 0) return NO_REFERENCE_SCAN;
  return { tables, blockedReason: unreadable.length === 0 ? null : unreadableReasonOf(unreadable) };
}
