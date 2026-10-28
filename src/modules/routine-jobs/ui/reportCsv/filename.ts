import type { MonthlyStage } from "../monthlyCartoStages";

const FILENAME_PREFIX = "carto";
const CSV_EXTENSION = "csv";
const MODE_SEGMENT = { DRY_RUN: "simulacion", REAL: "real" } as const;
const PAD_WIDTH = 2;

const pad = (value: number): string => String(value).padStart(PAD_WIDTH, "0");

const stampOf = (instant: Date): string => {
  const date = `${instant.getFullYear()}${pad(instant.getMonth() + 1)}${pad(instant.getDate())}`;
  const time = `${pad(instant.getHours())}${pad(instant.getMinutes())}${pad(instant.getSeconds())}`;
  return `${date}-${time}`;
};

export const reportCsvFilename = (stageSlug: MonthlyStage, dryRun: boolean, generatedAt: Date): string =>
  `${[FILENAME_PREFIX, stageSlug, dryRun ? MODE_SEGMENT.DRY_RUN : MODE_SEGMENT.REAL, stampOf(generatedAt)].join("-")}.${CSV_EXTENSION}`;
