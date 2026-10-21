import type { SigraLayerId } from "../constants";
import { SigraFlowActionType, type SigraFlowAction } from "../domain/sigraFlow";
import type { SigraLoadAnswer } from "../types";

export type LayerLoadAnswer = SigraLoadAnswer;

export interface LoadLayersDependencies {
  readonly runLoad: (layerIds: ReadonlyArray<SigraLayerId>, dryRun: boolean) => Promise<LayerLoadAnswer>;
  readonly isCurrent: () => boolean;
  readonly dispatch: (action: SigraFlowAction) => unknown;
}

/**
 * One request per layer, strictly in order. A layer that failed or was rejected is a normal
 * answer; a request error propagates. Returns false, without dispatching, once the run became stale.
 */
export async function loadLayersInOrder(
  layerIds: ReadonlyArray<SigraLayerId>,
  dryRun: boolean,
  dependencies: LoadLayersDependencies
): Promise<boolean> {
  const [layerId, ...rest] = layerIds;
  if (layerId === undefined) return true;
  const answer = await dependencies.runLoad([layerId], dryRun);
  if (!dependencies.isCurrent()) return false;
  for (const result of answer.results) {
    dependencies.dispatch({ type: SigraFlowActionType.RUN_LAYER_DONE, result, dryRun: answer.dryRun });
  }
  return loadLayersInOrder(rest, dryRun, dependencies);
}
