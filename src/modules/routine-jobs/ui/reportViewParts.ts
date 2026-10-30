import type { StepTiming } from "../jobs/cargar-padrones/types";
import type { ReportBannerView, TimingItemView } from "./ReportParts";

const MS_PER_SECOND = 1000;

export interface OutcomeTexts {
  unknown: string;
  dryRun: string;
  done: string;
}

export interface RunOutcome {
  dryRun: boolean;
  outcomeUnknown: boolean;
  modified: boolean;
}

export function outcomeBannersOf({ dryRun, outcomeUnknown, modified }: RunOutcome, texts: OutcomeTexts): ReportBannerView[] {
  const banners: ReportBannerView[] = [];
  if (outcomeUnknown) banners.push({ kind: "unknown", text: texts.unknown });
  if (dryRun) banners.push({ kind: "dryRun", text: texts.dryRun });
  else if (modified) banners.push({ kind: "done", text: texts.done });
  return banners;
}

/** The list summary shows the real count and says when the list shows only its first rows. */
export const listSummaryOf = (label: string, shown: number, total: number): string =>
  shown < total ? `${label} (primeras ${shown} de ${total})` : `${label} (${total})`;

export function timingsViewOf(stepTimings: readonly StepTiming[]): { timings: TimingItemView[]; totalSeconds: number } {
  const timings = stepTimings.map((timing) => ({ label: timing.label, seconds: timing.ms / MS_PER_SECOND }));
  return { timings, totalSeconds: timings.reduce((total, timing) => total + timing.seconds, 0) };
}
