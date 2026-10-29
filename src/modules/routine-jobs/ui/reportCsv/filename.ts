import type { MonthlyStage } from "../monthlyCartoStages";

const FILENAME_PREFIX = "carto";
const CSV_EXTENSION = "csv";
const MODE_SEGMENT = { DRY_RUN: "simulacion", REAL: "real" } as const;
const INCONSISTENCY_SEGMENT = "inconsistencias";
const PAD_WIDTH = 2;

export const REPORT_CSV_KIND = {
  CHANGES: "changes",
  INCONSISTENCIES: "inconsistencies",
} as const;

export type ReportCsvKind = (typeof REPORT_CSV_KIND)[keyof typeof REPORT_CSV_KIND];

const pad = (value: number): string => String(value).padStart(PAD_WIDTH, "0");

const stampOf = (instant: Date): string => {
  const date = `${instant.getFullYear()}${pad(instant.getMonth() + 1)}${pad(instant.getDate())}`;
  const time = `${pad(instant.getHours())}${pad(instant.getMinutes())}${pad(instant.getSeconds())}`;
  return `${date}-${time}`;
};

const kindSegmentsOf = (kind: ReportCsvKind): string[] => (kind === REPORT_CSV_KIND.INCONSISTENCIES ? [INCONSISTENCY_SEGMENT] : []);

export const reportCsvFilename = (
  stageSlug: MonthlyStage,
  dryRun: boolean,
  generatedAt: Date,
  kind: ReportCsvKind = REPORT_CSV_KIND.CHANGES
): string =>
  `${[FILENAME_PREFIX, stageSlug, dryRun ? MODE_SEGMENT.DRY_RUN : MODE_SEGMENT.REAL, ...kindSegmentsOf(kind), stampOf(generatedAt)].join("-")}.${CSV_EXTENSION}`;
