"use client";

import { useReducer } from "react";
import type { StageOutcome, StageStatus } from "../../shared/domain/stageContract";
import type { ConnectionField, ProfileValues } from "../../shared/domain/connectionState";
import {
  canContinue,
  canSkipStage,
  canUnskipStage,
  createInitialWorkflow,
  isAnyStageBusy,
  WorkflowActionType,
  workflowReducer,
} from "../domain/workflowState";
import type { LoadType, StageIdsByLoadType } from "../domain/loadType";

/** Binds the workflow reducer to the stage ids of each load type and exposes ready-made actions. */
export function useCoverageWorkflow(stageIdsByLoadType: StageIdsByLoadType) {
  const [state, dispatch] = useReducer(workflowReducer, stageIdsByLoadType, createInitialWorkflow);

  const publishStageStatus = (stageId: string, status: StageStatus, outcome?: StageOutcome) =>
    dispatch({ type: WorkflowActionType.STAGE_STATUS, stageId, status, outcome });

  return {
    state,
    canContinue: canContinue(state),
    isAnyStageBusy: isAnyStageBusy(state),
    canSkip: (stageId: string) => canSkipStage(state, stageId),
    canUnskip: (stageId: string) => canUnskipStage(state, stageId),
    selectLoadType: (loadType: LoadType) => dispatch({ type: WorkflowActionType.SELECT_LOAD_TYPE, loadType }),
    editLoadType: () => dispatch({ type: WorkflowActionType.EDIT_LOAD_TYPE }),
    setConnectionField: (field: ConnectionField, value: string) =>
      dispatch({ type: WorkflowActionType.SET_CONNECTION_FIELD, field, value }),
    applyProfile: (values: ProfileValues) => dispatch({ type: WorkflowActionType.APPLY_PROFILE, values }),
    confirmConnection: () => dispatch({ type: WorkflowActionType.CONTINUE }),
    editConnection: () => dispatch({ type: WorkflowActionType.EDIT_CONNECTION }),
    selectStage: (stageId: string) => dispatch({ type: WorkflowActionType.SELECT_STAGE, stageId }),
    skipStage: (stageId: string) => dispatch({ type: WorkflowActionType.SKIP_STAGE, stageId }),
    unskipStage: (stageId: string) => dispatch({ type: WorkflowActionType.UNSKIP_STAGE, stageId }),
    goToResult: () => dispatch({ type: WorkflowActionType.GO_TO_RESULT }),
    backToStages: () => dispatch({ type: WorkflowActionType.BACK_TO_STAGES }),
    publishStageStatus,
  };
}

