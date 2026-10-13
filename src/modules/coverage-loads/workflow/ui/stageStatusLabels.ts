import { StageStatus } from "../../shared/domain/stageContract";

export const STAGE_STATUS_LABELS: Readonly<Record<StageStatus, string>> = {
  [StageStatus.PENDING]: "Pendiente",
  [StageStatus.SKIPPED]: "Omitido",
  [StageStatus.BUSY]: "En curso",
  [StageStatus.DONE]: "Completado",
  [StageStatus.FAILED]: "Con error",
};
