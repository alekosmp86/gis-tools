import { formatNumber } from "@/core/common/ValueFormatter";
import { LayerLoadStatus, type LayerLoadResult } from "../types";
import shared from "./SigraShared.module.css";

export const DELTA_PLACEHOLDER = "—";

export function deltaClassName(delta: number | null): string {
  if (delta === null || delta === 0) return "";
  return delta > 0 ? shared.positive : shared.negative;
}

export function formatDelta(delta: number | null): string {
  if (delta === null) return DELTA_PLACEHOLDER;
  return delta > 0 ? `+${formatNumber(delta)}` : formatNumber(delta);
}

export function layerDelta(rowCount: number | null, wfsCount: number | null): number | null {
  if (rowCount === null || wfsCount === null) return null;
  return wfsCount - rowCount;
}

export function hasProblem(result: LayerLoadResult): boolean {
  return result.status === LayerLoadStatus.FAILED || result.status === LayerLoadStatus.REJECTED_VALIDATION;
}

export function resultDelta(result: LayerLoadResult, dryRun: boolean): number | null {
  if (hasProblem(result)) return null;
  const after = dryRun ? result.staged : result.finalCount;
  if (result.previousCount === null || after === null) return null;
  return after - result.previousCount;
}
