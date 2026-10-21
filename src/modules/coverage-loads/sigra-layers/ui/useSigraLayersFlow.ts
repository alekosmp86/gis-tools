"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import type { ConnectionPayload } from "../../types";
import type { SigraLayerId } from "../constants";
import { canRunSelection, SigraFlowActionType, type SigraFlowAction } from "../domain/sigraFlow";
import { fetchSigraPlan, runSigraLoad, SigraRequestError } from "./sigraLayersClient";
import { loadLayersInOrder } from "./loadLayersInOrder";
import { useSigraDispatch } from "./useSigraDispatch";

const UNKNOWN_FAILURE = "No se pudo completar la operación.";

type FlowDispatch = (action: SigraFlowAction) => unknown;

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : UNKNOWN_FAILURE;
}

/**
 * Every request takes a ticket; an answer whose ticket is no longer the latest (an older
 * connection or an older request) is dropped instead of overwriting newer state.
 */
function takeTicket(latestTicket: RefObject<number>): number {
  latestTicket.current += 1;
  return latestTicket.current;
}

async function planLayers(
  connection: ConnectionPayload,
  latestTicket: RefObject<number>,
  dispatch: FlowDispatch
): Promise<void> {
  const ticket = takeTicket(latestTicket);
  dispatch({ type: SigraFlowActionType.PLAN_REQUESTED });
  try {
    const plan = await fetchSigraPlan(connection);
    if (ticket === latestTicket.current) dispatch({ type: SigraFlowActionType.PLAN_SUCCEEDED, plan });
  } catch (failure: unknown) {
    if (ticket === latestTicket.current) dispatch({ type: SigraFlowActionType.PLAN_FAILED, error: toMessage(failure) });
  }
}

async function runLayers(
  connection: ConnectionPayload,
  selection: ReadonlyArray<SigraLayerId>,
  dryRun: boolean,
  latestTicket: RefObject<number>,
  dispatch: FlowDispatch
): Promise<void> {
  const ticket = takeTicket(latestTicket);
  dispatch({ type: SigraFlowActionType.RUN_REQUESTED, dryRun });
  try {
    const completed = await loadLayersInOrder(selection, dryRun, {
      runLoad: (layerIds, isDryRun) => runSigraLoad(connection, layerIds, { dryRun: isDryRun }),
      isCurrent: () => ticket === latestTicket.current,
      dispatch,
    });
    if (!completed) return;
    dispatch({ type: SigraFlowActionType.RUN_FINISHED });
    if (!dryRun) await planLayers(connection, latestTicket, dispatch);
  } catch (failure: unknown) {
    if (ticket !== latestTicket.current) return;
    dispatch({ type: SigraFlowActionType.RUN_FAILED, error: toMessage(failure) });
    if (failure instanceof SigraRequestError && failure.plan !== undefined) {
      await planLayers(connection, latestTicket, dispatch);
    }
  }
}

/**
 * Drives the "Capas SIGRA" stage. The plan is asked for on mount and whenever the confirmed
 * connection changes; a real load is followed by a new plan so the counts refresh.
 */
export function useSigraLayersFlow(
  connection: ConnectionPayload,
  connectionRevision: number,
  onStatusChange: StagePanelProps["onStatusChange"]
) {
  const { state, dispatch, current } = useSigraDispatch(onStatusChange);
  const latestTicket = useRef(0);

  useEffect(() => {
    dispatch({ type: SigraFlowActionType.RESET });
    void planLayers(connection, latestTicket, dispatch);
  }, [connection, connectionRevision, dispatch]);

  const run = (dryRun: boolean) => {
    const snapshot = current();
    if (canRunSelection(snapshot)) void runLayers(connection, snapshot.selection, dryRun, latestTicket, dispatch);
  };

  return {
    state,
    canRun: canRunSelection(state),
    refresh: () => void planLayers(connection, latestTicket, dispatch),
    toggleLayer: (layerId: SigraLayerId) => dispatch({ type: SigraFlowActionType.TOGGLE_LAYER, layerId }),
    selectAll: () => dispatch({ type: SigraFlowActionType.SELECT_ALL }),
    selectRequiredOnly: () => dispatch({ type: SigraFlowActionType.SELECT_REQUIRED_ONLY }),
    runDryRun: () => run(true),
    runLoad: () => run(false),
  };
}
