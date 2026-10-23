import type { GeometryProcessingOptions, StepTiming } from "@/core/types/geometryProcessing";

export interface StepClock {
  start(label: string): void;
  finish(): StepTiming[];
}

interface OpenStep {
  readonly label: string;
  readonly startedAt: number;
}

const elapsedMsBetween = (startedAt: number, endedAt: number): number => Math.max(0, Math.round(endedAt - startedAt));

export function createStepClock(now: () => number = () => performance.now()): StepClock {
  let timings: StepTiming[] = [];
  let openStep: OpenStep | undefined;
  let finished = false;

  const closeOpenStep = (instant: number): void => {
    if (openStep === undefined) return;
    timings.push({ label: openStep.label, ms: elapsedMsBetween(openStep.startedAt, instant) });
    openStep = undefined;
  };

  return {
    start(label) {
      const instant = now();
      if (finished) {
        timings = [];
        finished = false;
      }
      closeOpenStep(instant);
      openStep = { label, startedAt: instant };
    },
    finish() {
      if (!finished) {
        closeOpenStep(now());
        finished = true;
      }
      return [...timings];
    },
  };
}

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
