import { ClipboardList, ListChecks, PlugZap, type LucideIcon } from "lucide-react";
import { StageStatus } from "../../shared/domain/stageContract";
import { LOAD_TYPE_LABELS, stagesForLoadType } from "../domain/loadType";
import { isAnyStageBusy, isStageLocked, WorkflowPhase, type WorkflowState } from "../domain/workflowState";
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
  /** `null` while the step cannot be opened (an earlier choice is being made or edited, or a stage is busy). */
  readonly select: (() => void) | null;
}

export interface StepperActions {
  readonly editLoadType: () => void;
  readonly editConnection: () => void;
  readonly selectStage: (stageId: string) => void;
  readonly goToResult: () => void;
}

const LOAD_TYPE_KEY = "load-type";
const CONNECTION_KEY = "connection";
const RESULT_KEY = "result";
const LOCKED_CAPTION = "Bloqueado";

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

function buildLoadTypeEntry(state: WorkflowState, actions: StepperActions): StepperEntry {
  const isChoosing = state.phase === WorkflowPhase.LOAD_TYPE;
  const isChosen = state.loadType !== null && !isChoosing;
  return {
    key: LOAD_TYPE_KEY,
    title: "Tipo de carga",
    caption: state.loadType === null ? "Qué se va a cargar" : LOAD_TYPE_LABELS[state.loadType],
    Icon: ListChecks,
    isActive: isChoosing,
    tone: isChosen ? StepperTone.DONE : StepperTone.IDLE,
    select: isChoosing || isAnyStageBusy(state) ? null : actions.editLoadType,
  };
}

function buildConnectionEntry(state: WorkflowState, actions: StepperActions): StepperEntry {
  const isEditing = state.phase === WorkflowPhase.CONNECTION;
  const isConfirmed = state.confirmedConnection !== null && !isEditing;
  const isBlocked = isEditing || state.phase === WorkflowPhase.LOAD_TYPE || isAnyStageBusy(state);
  return {
    key: CONNECTION_KEY,
    title: "Conexión",
    caption: isConfirmed ? "Confirmada" : "Base de datos",
    Icon: PlugZap,
    isActive: isEditing,
    tone: isConfirmed ? StepperTone.DONE : StepperTone.IDLE,
    select: isBlocked ? null : actions.editConnection,
  };
}

function buildStageEntry(state: WorkflowState, stage: CoverageStage, actions: StepperActions): StepperEntry {
  const { status } = state.stages[stage.id];
  const isOpenable = state.phase === WorkflowPhase.STAGES || state.phase === WorkflowPhase.RESULT;
  const isBlocked = status === StageStatus.PENDING && isStageLocked(state, stage.id);
  return {
    key: stage.id,
    title: stage.label,
    caption: isBlocked ? LOCKED_CAPTION : STAGE_STATUS_LABELS[status],
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

/** The stepper: Tipo de carga, Conexión, one entry per stage of the chosen type, then Resultado. */
export function buildStepperEntries(
  state: WorkflowState,
  stages: ReadonlyArray<CoverageStage>,
  actions: StepperActions
): ReadonlyArray<StepperEntry> {
  return [
    buildLoadTypeEntry(state, actions),
    buildConnectionEntry(state, actions),
    ...stagesForLoadType(stages, state.stageIdsByLoadType, state.loadType).map((stage) => buildStageEntry(state, stage, actions)),
    buildResultEntry(state, actions),
  ];
}
