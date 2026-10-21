import { StageStatus, type StageOutcome } from "../../shared/domain/stageContract";
import { REQUIRED_LAYER_IDS, type SigraLayerId } from "../constants";
import { LayerLoadStatus, type LayerLoadResult, type SigraPlan } from "../types";
import { SIGRA_LAYERS, getSigraLayer } from "./layerRegistry";

/**
 * State of the "Capas SIGRA" stage: which layers are selected, the last plan, the last run and which
 * layers were really loaded in this session. Pure and free of React, so the rule that only a real,
 * successful load of both required layers finishes the stage is testable without a browser.
 */

export const SigraFlowPhase = {
  PLANNING: "PLANNING",
  READY: "READY",
  RUNNING: "RUNNING",
  PLAN_FAILED: "PLAN_FAILED",
} as const;

export type SigraFlowPhase = (typeof SigraFlowPhase)[keyof typeof SigraFlowPhase];

export interface SigraFlowState {
  readonly phase: SigraFlowPhase;
  readonly selection: ReadonlyArray<SigraLayerId>;
  readonly plan: SigraPlan | null;
  readonly results: ReadonlyArray<LayerLoadResult>;
  readonly lastRunDryRun: boolean | null;
  /** The last real, successful load of each layer in this session; a dry run or a failure never touches it. */
  readonly loaded: Readonly<Partial<Record<SigraLayerId, LayerLoadResult>>>;
  readonly error: string | null;
}

export const SigraFlowActionType = {
  TOGGLE_LAYER: "TOGGLE_LAYER",
  SELECT_ALL: "SELECT_ALL",
  SELECT_REQUIRED_ONLY: "SELECT_REQUIRED_ONLY",
  PLAN_REQUESTED: "PLAN_REQUESTED",
  PLAN_SUCCEEDED: "PLAN_SUCCEEDED",
  PLAN_FAILED: "PLAN_FAILED",
  RUN_REQUESTED: "RUN_REQUESTED",
  RUN_LAYER_DONE: "RUN_LAYER_DONE",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_FAILED: "RUN_FAILED",
  RESET: "RESET",
} as const;

export type SigraFlowAction =
  | { readonly type: typeof SigraFlowActionType.TOGGLE_LAYER; readonly layerId: SigraLayerId }
  | { readonly type: typeof SigraFlowActionType.SELECT_ALL }
  | { readonly type: typeof SigraFlowActionType.SELECT_REQUIRED_ONLY }
  | { readonly type: typeof SigraFlowActionType.PLAN_REQUESTED }
  | { readonly type: typeof SigraFlowActionType.PLAN_SUCCEEDED; readonly plan: SigraPlan }
  | { readonly type: typeof SigraFlowActionType.PLAN_FAILED; readonly error: string }
  | { readonly type: typeof SigraFlowActionType.RUN_REQUESTED; readonly dryRun: boolean }
  | {
      readonly type: typeof SigraFlowActionType.RUN_LAYER_DONE;
      readonly result: LayerLoadResult;
      readonly dryRun: boolean;
    }
  | { readonly type: typeof SigraFlowActionType.RUN_FINISHED }
  | { readonly type: typeof SigraFlowActionType.RUN_FAILED; readonly error: string }
  | { readonly type: typeof SigraFlowActionType.RESET };

const ALL_LAYER_IDS: ReadonlyArray<SigraLayerId> = SIGRA_LAYERS.map((layer) => layer.id);
const SUCCESS_HEADLINE = "Capas SIGRA actualizadas";
const FAILURE_HEADLINE = "Capas SIGRA con errores";
const NO_PREVIOUS_COUNT = "sin dato";

function inRegistryOrder(layerIds: ReadonlyArray<SigraLayerId>): SigraLayerId[] {
  return ALL_LAYER_IDS.filter((layerId) => layerIds.includes(layerId));
}

export function createInitialSigraFlow(): SigraFlowState {
  return {
    phase: SigraFlowPhase.PLANNING,
    selection: inRegistryOrder(REQUIRED_LAYER_IDS),
    plan: null,
    results: [],
    lastRunDryRun: null,
    loaded: {},
    error: null,
  };
}

function toggleLayer(state: SigraFlowState, layerId: SigraLayerId): SigraFlowState {
  if (state.phase === SigraFlowPhase.RUNNING || getSigraLayer(layerId).required) return state;
  const selection = state.selection.includes(layerId)
    ? state.selection.filter((selected) => selected !== layerId)
    : inRegistryOrder([...state.selection, layerId]);
  return { ...state, selection };
}

function selectLayers(state: SigraFlowState, layerIds: ReadonlyArray<SigraLayerId>): SigraFlowState {
  return state.phase === SigraFlowPhase.RUNNING ? state : { ...state, selection: inRegistryOrder(layerIds) };
}

function startRun(state: SigraFlowState, dryRun: boolean): SigraFlowState {
  if (!canRunSelection(state)) return state;
  return { ...state, phase: SigraFlowPhase.RUNNING, lastRunDryRun: dryRun, error: null, results: [] };
}

function recordLoaded(
  loaded: SigraFlowState["loaded"],
  results: ReadonlyArray<LayerLoadResult>
): SigraFlowState["loaded"] {
  const entries = results.filter((result) => result.status === LayerLoadStatus.LOADED);
  return { ...loaded, ...Object.fromEntries(entries.map((result) => [result.layerId, result])) };
}

function recordLayerDone(state: SigraFlowState, result: LayerLoadResult, dryRun: boolean): SigraFlowState {
  return {
    ...state,
    lastRunDryRun: dryRun,
    results: [...state.results, result],
    loaded: dryRun ? state.loaded : recordLoaded(state.loaded, [result]),
  };
}

function finishLayerRun(state: SigraFlowState): SigraFlowState {
  return state.phase === SigraFlowPhase.RUNNING ? { ...state, phase: SigraFlowPhase.READY, error: null } : state;
}

export function sigraFlowReducer(state: SigraFlowState, action: SigraFlowAction): SigraFlowState {
  switch (action.type) {
    case SigraFlowActionType.TOGGLE_LAYER:
      return toggleLayer(state, action.layerId);
    case SigraFlowActionType.SELECT_ALL:
      return selectLayers(state, ALL_LAYER_IDS);
    case SigraFlowActionType.SELECT_REQUIRED_ONLY:
      return selectLayers(state, REQUIRED_LAYER_IDS);
    case SigraFlowActionType.PLAN_REQUESTED:
      return { ...state, phase: SigraFlowPhase.PLANNING, error: null };
    case SigraFlowActionType.PLAN_SUCCEEDED:
      return { ...state, phase: SigraFlowPhase.READY, plan: action.plan, error: null };
    case SigraFlowActionType.PLAN_FAILED:
      return { ...state, phase: SigraFlowPhase.PLAN_FAILED, error: action.error };
    case SigraFlowActionType.RUN_REQUESTED:
      return startRun(state, action.dryRun);
    case SigraFlowActionType.RUN_LAYER_DONE:
      return recordLayerDone(state, action.result, action.dryRun);
    case SigraFlowActionType.RUN_FINISHED:
      return finishLayerRun(state);
    case SigraFlowActionType.RUN_FAILED:
      return {
        ...state,
        phase: SigraFlowPhase.READY,
        error: action.error,
      };
    case SigraFlowActionType.RESET:
      return createInitialSigraFlow();
  }
}

export function requiredLayersLoaded(state: SigraFlowState): boolean {
  return REQUIRED_LAYER_IDS.every((layerId) => state.loaded[layerId] !== undefined);
}

export function canRunSelection(state: SigraFlowState): boolean {
  const { plan } = state;
  if (state.phase !== SigraFlowPhase.READY || plan === null || state.selection.length === 0) return false;
  return state.selection.every((layerId) => plan.layers.some((layer) => layer.layerId === layerId && layer.canLoad));
}

export interface SigraStageProgress {
  readonly status: StageStatus;
  readonly outcome?: StageOutcome;
}

function describeLoaded(state: SigraFlowState): StageOutcome {
  const lines = ALL_LAYER_IDS.flatMap((layerId) => {
    const result = state.loaded[layerId];
    if (result === undefined) return [];
    const previous = result.previousCount ?? NO_PREVIOUS_COUNT;
    const final = result.finalCount ?? NO_PREVIOUS_COUNT;
    return [`${getSigraLayer(layerId).label}: ${final} registros (antes ${previous})`];
  });
  return { headline: SUCCESS_HEADLINE, lines };
}

function failureLines(state: SigraFlowState): string[] {
  if (state.error !== null) return [state.error];
  return state.results.flatMap((result) =>
    result.status === LayerLoadStatus.FAILED || result.status === LayerLoadStatus.REJECTED_VALIDATION
      ? [`${getSigraLayer(result.layerId).label}: ${result.message}`]
      : []
  );
}

/** Only a real load counts: a dry run, or a failed plan, never moves the stage off pending. */
export function stageProgressOf(state: SigraFlowState): SigraStageProgress {
  if (state.phase === SigraFlowPhase.RUNNING) return { status: StageStatus.BUSY };
  if (requiredLayersLoaded(state)) return { status: StageStatus.DONE, outcome: describeLoaded(state) };
  if (state.lastRunDryRun !== false || state.phase === SigraFlowPhase.PLAN_FAILED) {
    return { status: StageStatus.PENDING };
  }
  const lines = failureLines(state);
  return lines.length === 0
    ? { status: StageStatus.PENDING }
    : { status: StageStatus.FAILED, outcome: { headline: FAILURE_HEADLINE, lines } };
}
