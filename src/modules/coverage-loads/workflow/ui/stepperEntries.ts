import { PlugZap, ClipboardList, type LucideIcon } from "lucide-react";
import { StageStatus } from "../../shared/domain/stageContract";
import { WorkflowPhase, type WorkflowState } from "../domain/workflowState";
import type { CoverageStage } from "./coverageStages";
import { STAGE_STATUS_LABELS } from "./stageStatusLabels";

export const StepperTone = {
  IDLE: "IDLE",
  DONE: "DONE",
  SKIPPED: "SKIPPED",
  BUSY: "BUSY",
} as const;

export type StepperTone = (typeof StepperTone)[keyof typeof StepperTone];

export interface StepperEntry {
  readonly key: string;
  readonly title: string;
  readonly caption: string;
  readonly Icon: LucideIcon;
  readonly isActive: boolean;
  readonly tone: StepperTone;
  /** `null` while the step cannot be opened (the connection is not confirmed yet, is being edited, or a stage is busy). */
  readonly select: (() => void) | null;
}

export interface StepperActions {
  readonly editConnection: () => void;
  readonly selectStage: (stageId: string) => void;
  readonly goToResult: () => void;
}

const CONNECTION_KEY = "connection";
const RESULT_KEY = "result";

function toneOf(status: StageStatus): StepperTone {
  switch (status) {
    case StageStatus.DONE:
      return StepperTone.DONE;
    case StageStatus.SKIPPED:
      return StepperTone.SKIPPED;
    case StageStatus.BUSY:
      return StepperTone.BUSY;
    default:
      return StepperTone.IDLE;
  }
}

function buildConnectionEntry(state: WorkflowState, actions: StepperActions): StepperEntry {
  const isEditing = state.phase === WorkflowPhase.CONNECTION;
  const isConfirmed = state.confirmedConnection !== null && !isEditing;
  const isAnyStageBusy = Object.values(state.stages).some((stage) => stage.status === StageStatus.BUSY);
  return {
    key: CONNECTION_KEY,
    title: "Conexión",
    caption: isConfirmed ? "Confirmada" : "Base de datos",
    Icon: PlugZap,
    isActive: isEditing,
    tone: isConfirmed ? StepperTone.DONE : StepperTone.IDLE,
    select: isEditing || isAnyStageBusy ? null : actions.editConnection,
  };
}

function buildStageEntry(state: WorkflowState, stage: CoverageStage, actions: StepperActions): StepperEntry {
  const { status } = state.stages[stage.id];
  const isOpenable = state.phase !== WorkflowPhase.CONNECTION;
  return {
    key: stage.id,
    title: stage.label,
    caption: STAGE_STATUS_LABELS[status],
    Icon: stage.Icon,
    isActive: state.phase === WorkflowPhase.STAGES && state.activeStageId === stage.id,
    tone: toneOf(status),
    select: isOpenable ? () => actions.selectStage(stage.id) : null,
  };
}

function buildResultEntry(state: WorkflowState, actions: StepperActions): StepperEntry {
  return {
    key: RESULT_KEY,
    title: "Resultado",
    caption: "Resumen y reportes",
    Icon: ClipboardList,
    isActive: state.phase === WorkflowPhase.RESULT,
    tone: StepperTone.IDLE,
    select: state.phase === WorkflowPhase.STAGES ? actions.goToResult : null,
  };
}

/** The stepper: Conexión, one entry per stage, then Resultado. */
export function buildStepperEntries(
  state: WorkflowState,
  stages: ReadonlyArray<CoverageStage>,
  actions: StepperActions
): ReadonlyArray<StepperEntry> {
  return [
    buildConnectionEntry(state, actions),
    ...stages.map((stage) => buildStageEntry(state, stage, actions)),
    buildResultEntry(state, actions),
  ];
}
