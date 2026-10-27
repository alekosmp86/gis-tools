import type { RunSnapshot } from "./jobRunStore";
import { RunPhase } from "./jobRunStore";
import type { MonthlyStage } from "./monthlyCartoStages";

export const StageStatus = {
  PENDING: "pending",
  DONE: "done",
  FAILED: "failed",
} as const;

export type StageStatus = (typeof StageStatus)[keyof typeof StageStatus];

export type StageOutcomes = Partial<Record<MonthlyStage, StageStatus>>;

export const statusOf = (outcomes: StageOutcomes, stage: MonthlyStage): StageStatus => outcomes[stage] ?? StageStatus.PENDING;

/** Only a finished real run counts: dry runs and runs in progress leave the stage pending. */
export const statusOfRun = (snapshot: RunSnapshot<unknown, { dryRun: boolean }>): StageStatus => {
  if (snapshot.plan === undefined || snapshot.plan.dryRun) return StageStatus.PENDING;
  if (snapshot.phase === RunPhase.DONE) return StageStatus.DONE;
  if (snapshot.phase === RunPhase.FAILED || snapshot.phase === RunPhase.UNKNOWN) return StageStatus.FAILED;
  return StageStatus.PENDING;
};
