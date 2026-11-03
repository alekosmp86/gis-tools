import type { ReferenceTable } from "./replacementSql";

export const REASSIGN_BLOCKER = {
  NO_PRIMARY_KEY: "sin clave primaria de una sola columna",
  NO_GEOMETRY: "sin una única columna de geometría",
  NO_UPDATE_PRIVILEGE: "sin permiso para actualizar id_padron",
  NO_ADDRESS_MASTER: "no hay tabla de direcciones maestras",
} as const;

/** AP-110: null when the table can have its rows moved to a part; otherwise the Spanish reason. Fails closed: a table without facts is not reassignable. */
export const reassignBlockerOf = (table: ReferenceTable): string | null =>
  table.reassign === undefined ? (table.reassignBlocker ?? REASSIGN_BLOCKER.NO_PRIMARY_KEY) : null;
