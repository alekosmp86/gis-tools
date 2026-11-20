import React from "react";
import { Route } from "lucide-react";
import type { EjesRemovalRow } from "../../../jobs/ejes-calles/types";
import type { TableColumn } from "../../shared/ReportParts";
import { ShowOnMapButton } from "../../shared/map/ShowOnMapButton";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { REMOVAL_LEADING_COLUMNS, REMOVAL_STATE_COLUMN } from "../ejesReportColumns";
import { ManualResolutionKind, resolutionTextOf, type ManualResolution } from "../manualSplit/manualResolutionView";
import styles from "./EjesCompact.module.css";

export type ManualResolutionReader = (row: EjesRemovalRow) => ManualResolution | null;

const mapColumnOf = (onResolve: (row: EjesRemovalRow) => void): TableColumn<EjesRemovalRow> => ({
  header: EJES_MANUAL_SPLIT_TEXT.COLUMN_MAP,
  cell: (row) =>
    row.ref === "" ? null : <ShowOnMapButton label={EJES_MANUAL_SPLIT_TEXT.RESOLVE} icon={Route} onShow={() => onResolve(row)} />,
});

const resolutionBadgeOf = (resolution: ManualResolution): React.ReactNode => (
  <span className={resolution.kind === ManualResolutionKind.MANUAL ? styles.resolvedBadge : styles.ignoredBadge}>
    {resolutionTextOf(resolution)}
  </span>
);

const stateColumnOf = (resolutionOf?: ManualResolutionReader): TableColumn<EjesRemovalRow> =>
  resolutionOf === undefined
    ? REMOVAL_STATE_COLUMN
    : {
        header: REMOVAL_STATE_COLUMN.header,
        cell: (row) => {
          const resolution = resolutionOf(row);
          return resolution === null ? REMOVAL_STATE_COLUMN.cell(row) : resolutionBadgeOf(resolution);
        },
      };

/** The held removal columns; with `onResolve`, a first column opens the map where its replacement is chosen (a row with no reftramo has none). With `resolutionOf`, a resolved row's last column shows its badge. */
export const removalColumnsOf = (onResolve?: (row: EjesRemovalRow) => void, resolutionOf?: ManualResolutionReader): TableColumn<EjesRemovalRow>[] => [
  ...(onResolve === undefined ? [] : [mapColumnOf(onResolve)]),
  ...REMOVAL_LEADING_COLUMNS,
  stateColumnOf(resolutionOf),
];
