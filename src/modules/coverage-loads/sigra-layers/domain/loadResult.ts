import {
  LayerLoadStatus,
  LayerLoadStep,
  type LayerLoadResult,
  type LoadOutcome,
  type LoadProgress,
} from "../types";
import type { SigraLayerId } from "../constants";
import { evaluateLoad } from "./validation";

const STEP_LABELS: Readonly<Record<LayerLoadStep, string>> = {
  [LayerLoadStep.WFS]: "la descarga desde el WFS",
  [LayerLoadStep.INSERT]: "la preparación de la tabla temporal",
  [LayerLoadStep.VALIDATION]: "la validación",
  [LayerLoadStep.SWAP]: "el reemplazo de la tabla",
};

export function newProgress(): LoadProgress {
  return { downloaded: 0, staged: 0, previousCount: null, finalCount: null };
}

export function loadedOutcome(progress: LoadProgress): LoadOutcome {
  return {
    status: LayerLoadStatus.LOADED,
    step: null,
    message: `Capa cargada: ${progress.finalCount} registros insertados (antes: ${progress.previousCount}).`,
  };
}

export function dryRunOutcome(progress: LoadProgress): LoadOutcome {
  const verdict = evaluateLoad({ stagedCount: progress.staged, finalCount: progress.previousCount ?? 0 });
  return {
    status: LayerLoadStatus.DRY_RUN_OK,
    step: null,
    message: `Prueba sin guardar correcta. ${verdict.message} No se modificó ninguna tabla.`,
  };
}

export function rejectedOutcome(verdictMessage: string): LoadOutcome {
  return { status: LayerLoadStatus.REJECTED_VALIDATION, step: LayerLoadStep.VALIDATION, message: verdictMessage };
}

export function failedOutcome(step: LayerLoadStep | null, detail: string): LoadOutcome {
  const where = step === null ? "No se pudo iniciar la carga" : `La carga falló en ${STEP_LABELS[step]}`;
  return { status: LayerLoadStatus.FAILED, step, message: `${where}: ${detail}` };
}

export function buildLayerResult(
  layerId: SigraLayerId,
  outcome: LoadOutcome,
  progress: LoadProgress,
  elapsedMs: number,
  auditWarning: string | null,
): LayerLoadResult {
  const unchanged = outcome.status === LayerLoadStatus.LOADED ? progress.finalCount : progress.previousCount;
  return {
    layerId,
    status: outcome.status,
    downloaded: progress.downloaded,
    staged: progress.staged,
    duplicatesIgnored: progress.downloaded - progress.staged,
    previousCount: progress.previousCount,
    finalCount: unchanged,
    elapsedMs,
    step: outcome.step,
    message: outcome.message,
    auditWarning,
  };
}
