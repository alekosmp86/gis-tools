import type { ActualizarTargetReport } from "../jobs/actualizar-padron/types";

export type PersistCounts = Pick<ActualizarTargetReport, "inserted" | "pairsApplied" | "updated">;

const countTextOf = (count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`;

/** The planned writes of an analysis, in the words of the persist panel. */
export const persistSummaryOf = (counts: PersistCounts): string =>
  `Se aplicarán: ${countTextOf(counts.inserted, "padrón nuevo", "padrones nuevos")}, ${countTextOf(counts.pairsApplied, "par actualizado", "pares actualizados")}, ${countTextOf(counts.updated, "geometría actualizada", "geometrías actualizadas")}.`;
