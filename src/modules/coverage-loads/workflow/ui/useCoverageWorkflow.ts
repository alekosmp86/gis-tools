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

/** Binds the workflow reducer to the list of stage ids and exposes ready-made actions. */
export function useCoverageWorkflow(stageIds: ReadonlyArray<string>) {
  const [state, dispatch] = useReducer(workflowReducer, stageIds, createInitialWorkflow);

  const publishStageStatus = (stageId: string, status: StageStatus, outcome?: StageOutcome) =>
    dispatch({ type: WorkflowActionType.STAGE_STATUS, stageId, status, outcome });

  return {
    state,
    canContinue: canContinue(state),
    isAnyStageBusy: isAnyStageBusy(state),
    canSkip: (stageId: string) => canSkipStage(state, stageId),
    canUnskip: (stageId: string) => canUnskipStage(state, stageId),
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

