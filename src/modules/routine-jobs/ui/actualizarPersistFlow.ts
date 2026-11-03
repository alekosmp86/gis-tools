import type { ActualizarPadronRunSnapshot, ActualizarPadronRunStore } from "./actualizarPadronRunStore";
import {
  completedAnalysisPlanIdOf,
  persistBlockedReason,
  simulationBlockingReason,
  type ActualizarWizardState,
} from "./actualizarPadronWizardState";
import { RunPhase } from "./jobRunStore";

export const REANALYZE_NOTICE = "Se volverá a analizar con su selección antes de persistir; las cifras pueden cambiar.";
export const AUTO_ANALYSIS_LABEL = "Analizando con su selección…";

export const PersistDecisionKind = {
  PERSIST_NOW: "persistNow",
  ANALYZE_THEN_PERSIST: "analyzeThenPersist",
  BLOCKED: "blocked",
} as const;

export type PersistDecision =
  | { kind: typeof PersistDecisionKind.PERSIST_NOW; planId: string }
  | { kind: typeof PersistDecisionKind.ANALYZE_THEN_PERSIST }
  | { kind: typeof PersistDecisionKind.BLOCKED; reason: string };

/** A stale selection (pair choices or accepted geometries) is the only blocker the persist answers by analyzing again; every other blocker stays. */
export function persistDecisionOf(state: ActualizarWizardState, planId: string | null): PersistDecision {
  const reason = persistBlockedReason(state, planId);
  if (reason === null && planId !== null) return { kind: PersistDecisionKind.PERSIST_NOW, planId };
  if (reason !== null && reason === simulationBlockingReason(state)) return { kind: PersistDecisionKind.ANALYZE_THEN_PERSIST };
  return { kind: PersistDecisionKind.BLOCKED, reason: reason ?? "" };
}

export const persistBlockReasonOf = (decision: PersistDecision): string | null =>
  decision.kind === PersistDecisionKind.BLOCKED ? decision.reason : null;

export const persistNoticeOf = (decision: PersistDecision): string | null =>
  decision.kind === PersistDecisionKind.ANALYZE_THEN_PERSIST ? REANALYZE_NOTICE : null;

export const AutoPersistOutcomeKind = {
  WAIT: "wait",
  PERSIST: "persist",
  STOP: "stop",
} as const;

export type AutoPersistOutcome =
  | { kind: typeof AutoPersistOutcomeKind.WAIT }
  | { kind: typeof AutoPersistOutcomeKind.PERSIST; planId: string }
  | { kind: typeof AutoPersistOutcomeKind.STOP };

const WAIT: AutoPersistOutcome = { kind: AutoPersistOutcomeKind.WAIT };
const STOP: AutoPersistOutcome = { kind: AutoPersistOutcomeKind.STOP };

const hasUnappliedDecisions = (snapshot: ActualizarPadronRunSnapshot): boolean => {
  const target = snapshot.job?.result?.target;
  return target === undefined || target.choicesUnapplied > 0 || (target.geometryAcceptsUnapplied ?? 0) > 0;
};

/** What the wizard does with the automatic analysis of a persist: wait for it, persist its plan, or stop and show its result. `previousJobId` is the job on screen when the persist was pressed. */
export function autoPersistOutcomeOf(snapshot: ActualizarPadronRunSnapshot, previousJobId: string | undefined): AutoPersistOutcome {
  switch (snapshot.phase) {
    case RunPhase.STARTING:
    case RunPhase.RUNNING:
      return WAIT;
    case RunPhase.DONE:
      return doneOutcomeOf(snapshot, previousJobId);
    default:
      return STOP;
  }
}

export interface AutoPersistController {
  /** Watches the store from the job on screen until the automatic analysis settles, then calls `onSettled` once. */
  begin(onSettled: (outcome: AutoPersistOutcome) => void): void;
  cancel(): void;
}

export function createAutoPersistController(store: Pick<ActualizarPadronRunStore, "getSnapshot" | "subscribe">): AutoPersistController {
  let unsubscribe: (() => void) | null = null;
  const cancel = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };
  return {
    cancel,
    begin(onSettled) {
      cancel();
      const previousJobId = store.getSnapshot().jobId;
      unsubscribe = store.subscribe(() => {
        const outcome = autoPersistOutcomeOf(store.getSnapshot(), previousJobId);
        if (outcome.kind === AutoPersistOutcomeKind.WAIT) return;
        cancel();
        onSettled(outcome);
      });
    },
  };
}

function doneOutcomeOf(snapshot: ActualizarPadronRunSnapshot, previousJobId: string | undefined): AutoPersistOutcome {
  if (snapshot.jobId === previousJobId) return WAIT;
  const planId = completedAnalysisPlanIdOf(snapshot);
  if (planId === null || hasUnappliedDecisions(snapshot)) return STOP;
  return { kind: AutoPersistOutcomeKind.PERSIST, planId };
}
