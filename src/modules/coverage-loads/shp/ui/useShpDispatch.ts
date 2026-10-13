"use client";

import { useEffect, useRef, useState } from "react";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import { shpFlowReducer, type ShpAction } from "../domain/shpFlowReducer";
import { INITIAL_SHP_FLOW, type ShpFlowState } from "../domain/shpFlowState";
import { reportShpStage } from "../domain/shpStageReport";

function reportedChange(previous: ShpFlowState, next: ShpFlowState): boolean {
  return reportShpStage(previous).status !== reportShpStage(next).status || previous.status?.state !== next.status?.state;
}

/**
 * The flow state plus a dispatch whose identity never changes, so async work and the poll can keep
 * using it. The workflow shell is told about a change of stage status from here, in the same step
 * that causes it, and not from an effect.
 */
export function useShpDispatch(onStatusChange: StagePanelProps["onStatusChange"]) {
  const [state, setState] = useState(INITIAL_SHP_FLOW);
  const latest = useRef(INITIAL_SHP_FLOW);
  const publish = useRef(onStatusChange);

  useEffect(() => {
    publish.current = onStatusChange;
  });

  const [dispatch] = useState(() => (action: ShpAction) => {
    const previous = latest.current;
    const next = shpFlowReducer(previous, action);
    if (next === previous) return;
    latest.current = next;
    setState(next);
    if (!reportedChange(previous, next)) return;
    const report = reportShpStage(next);
    publish.current(report.status, report.outcome ?? undefined);
  });

  return { state, dispatch };
}
