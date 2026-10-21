import { LayerLoadStatus, LayerLoadStep } from "../types";

const STATUS_LABELS: Readonly<Record<LayerLoadStatus, string>> = {
  [LayerLoadStatus.LOADED]: "Cargada",
  [LayerLoadStatus.DRY_RUN_OK]: "Prueba correcta",
  [LayerLoadStatus.REJECTED_VALIDATION]: "Rechazada por validación",
  [LayerLoadStatus.FAILED]: "Con error",
};

const STEP_LABELS: Readonly<Record<LayerLoadStep, string>> = {
  [LayerLoadStep.WFS]: "Descarga SIGRA",
  [LayerLoadStep.INSERT]: "Inserción",
  [LayerLoadStep.VALIDATION]: "Validación",
  [LayerLoadStep.SWAP]: "Reemplazo de la tabla",
};

const CONNECTION_STEP_LABEL = "Conexión";

export function describeLayerStatus(status: LayerLoadStatus): string {
  return STATUS_LABELS[status];
}

/** A failure without a step happened before any step started: reaching the database. */
export function describeLayerStep(step: LayerLoadStep | null): string {
  return step === null ? CONNECTION_STEP_LABEL : STEP_LABELS[step];
}
