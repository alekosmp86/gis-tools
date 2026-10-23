import { ShpReplacePhase } from "@/core/types/shpReplace";
import { ShpReplaceRunStatus } from "@/core/services/shpReplaceRunStore";

interface ShpRunWording {
  titleByStatus: Record<ShpReplaceRunStatus, string>;
  phaseLabels: Record<ShpReplacePhase, string>;
  startingPhaseLabel: string;
  runningNotice: string;
  uploadingNotice: string;
  unmodifiedTarget: string;
  unknownOutcome: string;
}

const REPLACE_WORDING: ShpRunWording = {
  titleByStatus: {
    [ShpReplaceRunStatus.IDLE]: "Reemplazo completo",
    [ShpReplaceRunStatus.UPLOADING]: "Subiendo el archivo para el reemplazo completo",
    [ShpReplaceRunStatus.RUNNING]: "Reemplazo completo en curso",
    [ShpReplaceRunStatus.DONE]: "Reemplazo completo finalizado",
    [ShpReplaceRunStatus.FAILED]: "Reemplazo completo fallido",
  },
  phaseLabels: {
    [ShpReplacePhase.STAGING]: "Cargando registros",
    [ShpReplacePhase.PROCESSING]: "Procesando geometrías",
    [ShpReplacePhase.SWAPPING]: "Reemplazando la tabla",
    [ShpReplacePhase.FINALIZING]: "Finalizando",
  },
  startingPhaseLabel: "Iniciando reemplazo",
  runningNotice:
    "Cambiar de sección no detiene el reemplazo. Si recarga o cierra la pestaña, el servidor completa o revierte la carga, pero deja de verse su avance.",
  uploadingNotice: "Cerrar o recargar la pestaña mientras se sube el archivo cancela el reemplazo.",
  unmodifiedTarget:
    "La tabla destino no fue modificada: el reemplazo se ejecuta en una sola transacción y se revierte ante cualquier error.",
  unknownOutcome:
    "Estado desconocido: el servidor puede seguir trabajando o haber confirmado el reemplazo. Verifique el contenido de la tabla destino antes de reintentar.",
};

const ANALYSIS_WORDING: ShpRunWording = {
  titleByStatus: {
    [ShpReplaceRunStatus.IDLE]: "Análisis sin reemplazo",
    [ShpReplaceRunStatus.UPLOADING]: "Subiendo el archivo para el análisis",
    [ShpReplaceRunStatus.RUNNING]: "ANÁLISIS EN CURSO",
    [ShpReplaceRunStatus.DONE]: "Análisis (sin cambios en la tabla)",
    [ShpReplaceRunStatus.FAILED]: "Análisis fallido",
  },
  phaseLabels: {
    [ShpReplacePhase.STAGING]: "Cargando registros",
    [ShpReplacePhase.PROCESSING]: "Procesando geometrías",
    [ShpReplacePhase.SWAPPING]: "Simulando la carga en la tabla destino",
    [ShpReplacePhase.FINALIZING]: "Finalizando",
  },
  startingPhaseLabel: "Iniciando análisis",
  runningNotice:
    "Cambiar de sección no detiene el análisis. Si recarga o cierra la pestaña, el servidor lo completa o lo revierte, pero deja de verse su avance.",
  uploadingNotice: "Cerrar o recargar la pestaña mientras se sube el archivo cancela el análisis.",
  unmodifiedTarget: "La tabla destino no fue modificada.",
  unknownOutcome:
    "Estado desconocido: el servidor puede seguir analizando el archivo. El análisis no modifica la tabla destino.",
};

export const SHP_REPLACE_UPLOAD_PHASE_LABEL = "Subiendo archivo";

export const shpRunWording = (dryRun: boolean): ShpRunWording => (dryRun ? ANALYSIS_WORDING : REPLACE_WORDING);
