import type { ConnectionPayload } from "../../types";
import {
  INITIAL_CONNECTION,
  isConnectionComplete,
  isSameConnection,
  withConnectionField,
  withProfileValues,
  type ConnectionField,
  type ProfileValues,
} from "../../shared/domain/connectionState";
import { StageStatus, type StageOutcome } from "../../shared/domain/stageContract";
import type { LoadType, StageIdsByLoadType } from "./loadType";

/**
 * State of the multi-stage workflow: a load type, one shared connection, then the independent
 * stages of that type that can be done in any order or skipped, then a combined result. Pure and
 * free of React.
 */

export const WorkflowPhase = {
  LOAD_TYPE: "LOAD_TYPE",
  CONNECTION: "CONNECTION",
  STAGES: "STAGES",
  RESULT: "RESULT",
} as const;

export type WorkflowPhase = (typeof WorkflowPhase)[keyof typeof WorkflowPhase];

export interface StageProgress {
  readonly status: StageStatus;
  readonly outcome: StageOutcome | null;
}

export interface WorkflowState {
  readonly phase: WorkflowPhase;
  /** The chosen type of load; `null` until the first choice. */
  readonly loadType: LoadType | null;
  readonly stageIdsByLoadType: StageIdsByLoadType;
  /** The connection being edited in the form. */
  readonly connection: ConnectionPayload;
  /** The connection the stages work against; `null` until the first confirmation. */
  readonly confirmedConnection: ConnectionPayload | null;
  /** Grows each time a confirmation changed the connection, so stages discard stale work. */
  readonly connectionRevision: number;
  readonly activeStageId: string;
  readonly stages: Readonly<Record<string, StageProgress>>;
}

export const WorkflowActionType = {
  SELECT_LOAD_TYPE: "SELECT_LOAD_TYPE",
  EDIT_LOAD_TYPE: "EDIT_LOAD_TYPE",
  SET_CONNECTION_FIELD: "SET_CONNECTION_FIELD",
  APPLY_PROFILE: "APPLY_PROFILE",
  CONTINUE: "CONTINUE",
  EDIT_CONNECTION: "EDIT_CONNECTION",
  SELECT_STAGE: "SELECT_STAGE",
  SKIP_STAGE: "SKIP_STAGE",
  UNSKIP_STAGE: "UNSKIP_STAGE",
  STAGE_STATUS: "STAGE_STATUS",
  GO_TO_RESULT: "GO_TO_RESULT",
  BACK_TO_STAGES: "BACK_TO_STAGES",
} as const;

export type WorkflowAction =
  | { readonly type: typeof WorkflowActionType.SELECT_LOAD_TYPE; readonly loadType: LoadType }
  | { readonly type: typeof WorkflowActionType.EDIT_LOAD_TYPE }
  | {
      readonly type: typeof WorkflowActionType.SET_CONNECTION_FIELD;
      readonly field: ConnectionField;
      readonly value: string;
    }
  | { readonly type: typeof WorkflowActionType.APPLY_PROFILE; readonly values: ProfileValues }
  | { readonly type: typeof WorkflowActionType.SELECT_STAGE; readonly stageId: string }
  | { readonly type: typeof WorkflowActionType.SKIP_STAGE; readonly stageId: string }
  | { readonly type: typeof WorkflowActionType.UNSKIP_STAGE; readonly stageId: string }
  | {
      readonly type: typeof WorkflowActionType.STAGE_STATUS;
      readonly stageId: string;
      readonly status: StageStatus;
      readonly outcome?: StageOutcome;
    }
  | { readonly type: typeof WorkflowActionType.CONTINUE }
  | { readonly type: typeof WorkflowActionType.EDIT_CONNECTION }
  | { readonly type: typeof WorkflowActionType.GO_TO_RESULT }
  | { readonly type: typeof WorkflowActionType.BACK_TO_STAGES };

const PENDING_PROGRESS: StageProgress = { status: StageStatus.PENDING, outcome: null };

function allStageIds(stageIdsByLoadType: StageIdsByLoadType): string[] {
  return Object.values(stageIdsByLoadType).flat();
}

function pendingStages(stageIdsByLoadType: StageIdsByLoadType): Record<string, StageProgress> {
  return Object.fromEntries(allStageIds(stageIdsByLoadType).map((stageId) => [stageId, PENDING_PROGRESS]));
}

/** Stage ids of the chosen type; empty while no type is chosen. */
function chosenStageIds(state: WorkflowState): ReadonlyArray<string> {
  return state.loadType === null ? [] : state.stageIdsByLoadType[state.loadType];
}

/** Starts at the type choice; the first stage of the first type is active until a type is chosen. */
export function createInitialWorkflow(stageIdsByLoadType: StageIdsByLoadType): WorkflowState {
  return {
    phase: WorkflowPhase.LOAD_TYPE,
    loadType: null,
    stageIdsByLoadType,
    connection: INITIAL_CONNECTION,
    confirmedConnection: null,
    connectionRevision: 0,
    activeStageId: allStageIds(stageIdsByLoadType)[0],
    stages: pendingStages(stageIdsByLoadType),
  };
}

export function canContinue(state: WorkflowState): boolean {
  return (
    state.phase === WorkflowPhase.CONNECTION && state.loadType !== null && isConnectionComplete(state.connection)
  );
}

export function isAnyStageBusy(state: WorkflowState): boolean {
  return Object.values(state.stages).some((progress) => progress.status === StageStatus.BUSY);
}

export function canSkipStage(state: WorkflowState, stageId: string): boolean {
  const status = state.stages[stageId]?.status;
  return status !== undefined && status !== StageStatus.BUSY && status !== StageStatus.DONE && status !== StageStatus.SKIPPED;
}

export function canUnskipStage(state: WorkflowState, stageId: string): boolean {
  return state.stages[stageId]?.status === StageStatus.SKIPPED;
}

/** Choosing another type drops the progress of the old one; choosing the same type again keeps it. */
function selectLoadType(state: WorkflowState, loadType: LoadType): WorkflowState {
  if (state.phase !== WorkflowPhase.LOAD_TYPE) return state;
  const phase = state.confirmedConnection === null ? WorkflowPhase.CONNECTION : WorkflowPhase.STAGES;
  const connection = state.confirmedConnection ?? state.connection;
  if (loadType === state.loadType) return { ...state, phase, connection };
  return {
    ...state,
    phase,
    connection,
    loadType,
    activeStageId: state.stageIdsByLoadType[loadType][0],
    stages: pendingStages(state.stageIdsByLoadType),
  };
}

function reopenLoadType(state: WorkflowState): WorkflowState {
  if (state.phase === WorkflowPhase.LOAD_TYPE || isAnyStageBusy(state)) return state;
  return { ...state, phase: WorkflowPhase.LOAD_TYPE };
}

function editConnection(state: WorkflowState, connection: ConnectionPayload): WorkflowState {
  return state.phase === WorkflowPhase.CONNECTION ? { ...state, connection } : state;
}

/** Confirming a different connection bumps the revision: stage work was computed against the old database. */
function confirmConnection(state: WorkflowState): WorkflowState {
  if (!canContinue(state)) return state;
  const changed =
    state.confirmedConnection !== null && !isSameConnection(state.confirmedConnection, state.connection);
  return {
    ...state,
    phase: WorkflowPhase.STAGES,
    confirmedConnection: state.connection,
    connectionRevision: changed ? state.connectionRevision + 1 : state.connectionRevision,
  };
}

function reopenConnection(state: WorkflowState): WorkflowState {
  if (state.phase === WorkflowPhase.CONNECTION || state.phase === WorkflowPhase.LOAD_TYPE || isAnyStageBusy(state)) {
    return state;
  }
  return { ...state, phase: WorkflowPhase.CONNECTION };
}

function selectStage(state: WorkflowState, stageId: string): WorkflowState {
  const isStagePhase = state.phase === WorkflowPhase.STAGES || state.phase === WorkflowPhase.RESULT;
  if (!isStagePhase || !chosenStageIds(state).includes(stageId)) return state;
  return { ...state, phase: WorkflowPhase.STAGES, activeStageId: stageId };
}

function setStageProgress(state: WorkflowState, stageId: string, progress: StageProgress): WorkflowState {
  return { ...state, stages: { ...state.stages, [stageId]: progress } };
}

/** The next stage of the chosen type that still has work to do, searching after `stageId` and then from the start. */
function nextOpenStageId(state: WorkflowState, stageId: string): string | null {
  const ids = chosenStageIds(state);
  const start = ids.indexOf(stageId);
  const ordered = [...ids.slice(start + 1), ...ids.slice(0, start)];
  return ordered.find((id) => state.stages[id].status === StageStatus.PENDING) ?? null;
}

/** Skipping the stage on screen moves straight to the next one that is still open. */
function skipStage(state: WorkflowState, stageId: string): WorkflowState {
  if (!canSkipStage(state, stageId)) return state;
  const skipped = setStageProgress(state, stageId, { status: StageStatus.SKIPPED, outcome: null });
  if (state.activeStageId !== stageId) return skipped;
  const next = nextOpenStageId(skipped, stageId);
  return next === null ? skipped : { ...skipped, activeStageId: next };
}

function unskipStage(state: WorkflowState, stageId: string): WorkflowState {
  return canUnskipStage(state, stageId) ? setStageProgress(state, stageId, PENDING_PROGRESS) : state;
}

/** A skipped stage keeps its panel mounted but is not working, so what it publishes is ignored. */
function publishStageStatus(
  state: WorkflowState,
  stageId: string,
  status: StageStatus,
  outcome: StageOutcome | undefined
): WorkflowState {
  const current = state.stages[stageId];
  if (current === undefined || current.status === StageStatus.SKIPPED) return state;
  return setStageProgress(state, stageId, { status, outcome: outcome ?? null });
}

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case WorkflowActionType.SELECT_LOAD_TYPE:
      return selectLoadType(state, action.loadType);
    case WorkflowActionType.EDIT_LOAD_TYPE:
      return reopenLoadType(state);
    case WorkflowActionType.SET_CONNECTION_FIELD:
      return editConnection(state, withConnectionField(state.connection, action.field, action.value));
    case WorkflowActionType.APPLY_PROFILE:
      return editConnection(state, withProfileValues(state.connection, action.values));
    case WorkflowActionType.CONTINUE:
      return confirmConnection(state);
    case WorkflowActionType.EDIT_CONNECTION:
      return reopenConnection(state);
    case WorkflowActionType.SELECT_STAGE:
      return selectStage(state, action.stageId);
    case WorkflowActionType.SKIP_STAGE:
      return skipStage(state, action.stageId);
    case WorkflowActionType.UNSKIP_STAGE:
      return unskipStage(state, action.stageId);
    case WorkflowActionType.STAGE_STATUS:
      return publishStageStatus(state, action.stageId, action.status, action.outcome);
    case WorkflowActionType.GO_TO_RESULT:
      return state.phase === WorkflowPhase.STAGES ? { ...state, phase: WorkflowPhase.RESULT } : state;
    case WorkflowActionType.BACK_TO_STAGES:
      return state.phase === WorkflowPhase.RESULT ? { ...state, phase: WorkflowPhase.STAGES } : state;
  }
}
