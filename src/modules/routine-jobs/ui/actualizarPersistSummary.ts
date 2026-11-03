import type { ActualizarTargetReport } from "../jobs/actualizar-padron/types";

export type PersistCounts = Pick<ActualizarTargetReport, "inserted" | "pairsApplied" | "updated" | "removed" | "reassigned">;

const countTextOf = (count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`;

const reassignedTextOf = (reassigned: number): string =>
  reassigned > 0 ? `, ${countTextOf(reassigned, "dirección reasignada", "direcciones reasignadas")}` : "";

/** The planned writes of an analysis, in the words of the persist panel. */
export const persistSummaryOf = (counts: PersistCounts): string =>
  `Se aplicarán: ${countTextOf(counts.inserted, "padrón nuevo", "padrones nuevos")}, ${countTextOf(counts.pairsApplied, "par actualizado", "pares actualizados")}, ${countTextOf(counts.updated, "geometría actualizada", "geometrías actualizadas")}, ${countTextOf(counts.removed ?? 0, "padrón eliminado", "padrones eliminados")}${reassignedTextOf(counts.reassigned ?? 0)}.`;
