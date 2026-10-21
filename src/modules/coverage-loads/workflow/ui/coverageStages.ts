import type { ComponentType } from "react";
import { Cable, MapPinned, Signal, type LucideIcon } from "lucide-react";
import type { ConnectionPayload } from "../../types";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import { AvanceFtthPanel } from "../../avance-ftth/ui/AvanceFtthPanel";
import { AvanceReportDownloads } from "../../avance-ftth/ui/ReportDownloads";
import { IndicatorsPanel } from "../../indicators/ui/IndicatorsPanel";
import { ReportDownloads } from "../../indicators/ui/ReportDownloads";
import { ShpPanel } from "../../shp/ui/ShpPanel";

import { CoverageStageId } from "../domain/coverageStageId";

export { CoverageStageId };

export interface CoverageStage {
  readonly id: string;
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly Panel: ComponentType<StagePanelProps>;
  /** Extra content for the combined result; it only needs the confirmed connection. */
  readonly ResultExtras?: ComponentType<{ connection: ConnectionPayload }>;
}

/** The stages of the workflow, in default order. Adding a stage means adding one entry here. */
export const COVERAGE_STAGES: ReadonlyArray<CoverageStage> = [
  {
    id: CoverageStageId.INDICATORS,
    label: "Indicadores LTE",
    Icon: Signal,
    Panel: IndicatorsPanel,
    ResultExtras: ReportDownloads,
  },
  { id: CoverageStageId.SHP, label: "Cargas SHP", Icon: MapPinned, Panel: ShpPanel },
  {
    id: CoverageStageId.AVANCE_FTTH,
    label: "Avance FTTH",
    Icon: Cable,
    Panel: AvanceFtthPanel,
    ResultExtras: AvanceReportDownloads,
  },
];
