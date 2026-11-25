import { plannedEjesStepLabels } from "../../../jobs/ejes-ide/domain/plannedSteps";
import type { EjesRunSnapshot } from "./ejesIdeRunStore";

/** The steps the checklist shows: the job's own once it reports them, else the planned dry-run list of a started plan. */
export const ejesIdeChecklistStepsOf = (snapshot: EjesRunSnapshot): readonly string[] | undefined => {
  if (snapshot.job?.steps?.length) return snapshot.job.steps;
  return snapshot.plan ? plannedEjesStepLabels() : undefined;
};
