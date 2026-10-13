"use client";

import React from "react";
import { CoverageConnectionForm } from "../../shared/ui/CoverageConnectionForm";
import { WorkflowPhase } from "../domain/workflowState";
import { COVERAGE_STAGES } from "./coverageStages";
import { buildStepperEntries } from "./stepperEntries";
import { StageView } from "./StageView";
import { useCoverageWorkflow } from "./useCoverageWorkflow";
import { WorkflowResultStep } from "./WorkflowResultStep";
import { WorkflowStepCard } from "./WorkflowStepCard";
import { WorkflowStepper } from "./WorkflowStepper";

const STAGE_IDS = COVERAGE_STAGES.map((stage) => stage.id);

/**
 * The workflow shell: one shared connection, independent stages that can be skipped, and a
 * combined result. Stage panels stay mounted once the connection is confirmed.
 */
export const CoverageWorkflow: React.FC = () => {
  const workflow = useCoverageWorkflow(STAGE_IDS);
  const { state } = workflow;
  const { confirmedConnection } = state;

  const stepperEntries = buildStepperEntries(state, COVERAGE_STAGES, {
    editConnection: workflow.editConnection,
    selectStage: workflow.selectStage,
    goToResult: workflow.goToResult,
  });

  return (
    <>
      <WorkflowStepper entries={stepperEntries} />
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
        COVERAGE_STAGES.map((stage) => (
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
          stages={COVERAGE_STAGES}
          progress={state.stages}
          connection={confirmedConnection}
          onBack={workflow.backToStages}
        />
      )}
    </>
  );
};
