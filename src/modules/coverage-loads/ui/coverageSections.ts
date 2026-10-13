import type { ComponentType } from "react";
import { IndicatorsPanel } from "../indicators/ui/IndicatorsPanel";

export const CoverageSectionId = {
  INDICATORS: "indicators",
} as const;

export type CoverageSectionId = (typeof CoverageSectionId)[keyof typeof CoverageSectionId];

export interface CoverageSection {
  readonly id: CoverageSectionId;
  readonly label: string;
  readonly Component: ComponentType;
}

/** The sections of the page, in tab order. Adding a section means adding one entry here. */
export const COVERAGE_SECTIONS: ReadonlyArray<CoverageSection> = [
  { id: CoverageSectionId.INDICATORS, label: "Indicadores LTE", Component: IndicatorsPanel },
];
