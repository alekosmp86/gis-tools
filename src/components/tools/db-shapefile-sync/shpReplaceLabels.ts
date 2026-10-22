import { ShpReplacePhase } from "@/core/types/shpReplace";
import { ShpReplaceRunStatus } from "@/core/services/shpReplaceRunStore";

export const SHP_REPLACE_PHASE_LABELS: Record<ShpReplacePhase, string> = {
  [ShpReplacePhase.STAGING]: "Cargando registros",
  [ShpReplacePhase.SWAPPING]: "Reemplazando la tabla",
  [ShpReplacePhase.FINALIZING]: "Finalizando",
};

export const SHP_REPLACE_TITLE_BY_STATUS: Record<ShpReplaceRunStatus, string> = {
  [ShpReplaceRunStatus.IDLE]: "Reemplazo completo",
  [ShpReplaceRunStatus.UPLOADING]: "Subiendo el archivo para el reemplazo completo",
  [ShpReplaceRunStatus.RUNNING]: "Reemplazo completo en curso",
  [ShpReplaceRunStatus.DONE]: "Reemplazo completo finalizado",
  [ShpReplaceRunStatus.FAILED]: "Reemplazo completo fallido",
};

export const SHP_REPLACE_STARTING_PHASE_LABEL = "Iniciando reemplazo";
export const SHP_REPLACE_UPLOAD_PHASE_LABEL = "Subiendo archivo";
