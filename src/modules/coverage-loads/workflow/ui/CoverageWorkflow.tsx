"use client";

import React from "react";
import { CoverageConnectionForm } from "../../shared/ui/CoverageConnectionForm";
import { LOAD_TYPE_STAGE_IDS, stagesForLoadType } from "../domain/loadType";
import { WorkflowPhase } from "../domain/workflowState";
import { COVERAGE_STAGES } from "./coverageStages";
import { LoadTypeStep } from "./LoadTypeStep";
import { buildStepperEntries } from "./stepperEntries";
import { StageView } from "./StageView";
import { useCoverageWorkflow } from "./useCoverageWorkflow";
import { WorkflowResultStep } from "./WorkflowResultStep";
import { WorkflowStepCard } from "./WorkflowStepCard";
import { WorkflowStepper } from "./WorkflowStepper";

/**
 * The workflow shell: a load type, one shared connection, the independent stages of that type
 * (which can be skipped) and a combined result. The panels of the chosen type stay mounted once
 * the connection is confirmed.
 */
export const CoverageWorkflow: React.FC = () => {
  const workflow = useCoverageWorkflow(LOAD_TYPE_STAGE_IDS);
  const { state } = workflow;
  const { confirmedConnection } = state;
  const chosenStages = stagesForLoadType(COVERAGE_STAGES, state.stageIdsByLoadType, state.loadType);

  const stepperEntries = buildStepperEntries(state, COVERAGE_STAGES, {
    editLoadType: workflow.editLoadType,
    editConnection: workflow.editConnection,
    selectStage: workflow.selectStage,
    goToResult: workflow.goToResult,
  });

  return (
    <>
      <WorkflowStepper entries={stepperEntries} />
      {state.phase === WorkflowPhase.LOAD_TYPE && (
        <LoadTypeStep selected={state.loadType} onSelect={workflow.selectLoadType} />
      )}
      {state.phase === WorkflowPhase.CONNECTION && (
        <WorkflowStepCard title="Conexión a la base de datos">
          <CoverageConnectionForm
            connection={state.connection}
            canSubmit={workflow.canContinue}
            onFieldChange={workflow.setConnectionField}
            onProfileLoaded={workflow.applyProfile}
            onSubmit={workflow.confirmConnection}
          />
        </WorkflowStepCard>
      )}
      {confirmedConnection &&
        chosenStages.map((stage) => (
          <StageView
            key={stage.id}
            stage={stage}
            status={state.stages[stage.id].status}
            isActive={state.phase === WorkflowPhase.STAGES && state.activeStageId === stage.id}
            canSkip={workflow.canSkip(stage.id)}
            canUnskip={workflow.canUnskip(stage.id)}
            connection={confirmedConnection}
            connectionRevision={state.connectionRevision}
            onStatusChange={workflow.publishStageStatus}
            onSkip={workflow.skipStage}
            onUnskip={workflow.unskipStage}
          />
        ))}
      {confirmedConnection && state.phase === WorkflowPhase.RESULT && (
        <WorkflowResultStep
          stages={chosenStages}
          progress={state.stages}
          connection={confirmedConnection}
          onBack={workflow.backToStages}
        />
      )}
    </>
  );
};
