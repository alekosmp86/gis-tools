import { coverageTextOf, metersTextOf } from "../ejesIdeReportView";
import { EJES_COMPACT_TEXT } from "./ejesCompactTexts";

export interface EjesDetailFact {
  label: string;
  value: string;
}

export interface GeometryFactsSource {
  coverage: number | null;
  oldLength: number | null;
  newLength: number | null;
  outsideLength: number | null;
}

export const geometryFactsOf = (row: GeometryFactsSource): EjesDetailFact[] => [
  { label: EJES_COMPACT_TEXT.FACT_COVERAGE, value: coverageTextOf(row.coverage) },
  { label: EJES_COMPACT_TEXT.FACT_OLD_LENGTH, value: metersTextOf(row.oldLength) },
  { label: EJES_COMPACT_TEXT.FACT_NEW_LENGTH, value: metersTextOf(row.newLength) },
  { label: EJES_COMPACT_TEXT.FACT_OUTSIDE_LENGTH, value: metersTextOf(row.outsideLength) },
];
