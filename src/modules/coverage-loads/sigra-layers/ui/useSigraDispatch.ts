"use client";

import { useEffect, useRef, useState } from "react";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import {
  createInitialSigraFlow,
  sigraFlowReducer,
  stageProgressOf,
  type SigraFlowAction,
  type SigraFlowState,
} from "../domain/sigraFlow";

function reportedChange(previous: SigraFlowState, next: SigraFlowState): boolean {
  return JSON.stringify(stageProgressOf(previous)) !== JSON.stringify(stageProgressOf(next));
}

/**
 * The flow state plus a dispatch whose identity never changes, so async work can keep using it.
 * The workflow shell is told about a change of stage progress from here, in the same step that
 * causes it, and not from an effect.
 */
export function useSigraDispatch(onStatusChange: StagePanelProps["onStatusChange"]) {
  const [state, setState] = useState(createInitialSigraFlow);
  const latest = useRef(state);
  const publish = useRef(onStatusChange);

  useEffect(() => {
    publish.current = onStatusChange;
  });

  const [dispatch] = useState(() => (action: SigraFlowAction): SigraFlowState => {
    const previous = latest.current;
    const next = sigraFlowReducer(previous, action);
    if (next === previous) return previous;
    latest.current = next;
    setState(next);
    if (reportedChange(previous, next)) {
      const { status, outcome } = stageProgressOf(next);
      publish.current(status, outcome);
    }
    return next;
  });

  return { state, dispatch, current: () => latest.current };
}
