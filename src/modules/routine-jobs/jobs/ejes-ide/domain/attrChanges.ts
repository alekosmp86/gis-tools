import type { EjesAttrRow } from "../types";

const CHANGED_FIELD = {
  NAME: "nombre",
  IDCALLE: "idcalle",
  TYPE: "tipo de vialidad",
  FONT: "fuente",
} as const;

export function ejesAttrChangesOf(row: EjesAttrRow): string[] {
  const changes: string[] = [];
  if (row.name !== row.currentName) changes.push(CHANGED_FIELD.NAME);
  if (row.idcalle !== row.currentIdcalle) changes.push(CHANGED_FIELD.IDCALLE);
  if (row.typeId !== row.currentTypeId) changes.push(CHANGED_FIELD.TYPE);
  if (row.fontId !== row.currentFontId) changes.push(CHANGED_FIELD.FONT);
  return changes;
}
