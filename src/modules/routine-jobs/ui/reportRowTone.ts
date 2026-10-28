const ReportRowTone = {
  ATTENTION: "attention",
  NEUTRAL: "neutral",
  ZERO: "zero",
} as const;

export type ReportRowTone = (typeof ReportRowTone)[keyof typeof ReportRowTone];

export const reportRowToneOf = (value: number, isNeutral: boolean): ReportRowTone => {
  if (value === 0) return ReportRowTone.ZERO;
  return isNeutral ? ReportRowTone.NEUTRAL : ReportRowTone.ATTENTION;
};
