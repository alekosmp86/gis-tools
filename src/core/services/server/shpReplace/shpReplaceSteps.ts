import type { GeometryProcessingOptions } from "@/core/types/geometryProcessing";

export const ProcessingStep = {
  CONVERT: "Convirtiendo geometrías",
  REPAIR: "Reparando geometrías",
  UNIFY: "Unificando por clave",
  REPAIR_UNIFIED: "Reparando geometrías unificadas",
  VALIDITY: "Revisando validez de geometrías",
  OVERLAPS: "Buscando solapes",
} as const;

export const SwapStep = {
  LOCK: "Bloqueando la tabla destino",
  DELETE: "Eliminando registros actuales",
  INSERT: "Insertando registros nuevos",
} as const;

export const FinalizeStep = {
  ADJUST_SEQUENCES: "Ajustando secuencias",
  COMMIT: "Confirmando la transacción",
  ANALYZE: "Actualizando estadísticas",
} as const;

export const SWAP_STEP_PLAN: readonly string[] = [SwapStep.LOCK, SwapStep.DELETE, SwapStep.INSERT];

export const FINALIZE_STEP_PLAN: readonly string[] = [
  FinalizeStep.ADJUST_SEQUENCES,
  FinalizeStep.COMMIT,
  FinalizeStep.ANALYZE,
];

export function buildProcessingStepPlan(processing: GeometryProcessingOptions): readonly string[] {
  const repair = processing.repair.enabled;
  const unify = processing.unify.enabled;
  return [
    ProcessingStep.CONVERT,
    ...(repair ? [ProcessingStep.REPAIR] : []),
    ...(unify ? [ProcessingStep.UNIFY] : []),
    ...(repair && unify ? [ProcessingStep.REPAIR_UNIFIED] : []),
    ProcessingStep.VALIDITY,
    ...(processing.overlaps.enabled ? [ProcessingStep.OVERLAPS] : []),
  ];
}
