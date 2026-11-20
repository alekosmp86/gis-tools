import React from "react";
import { Route } from "lucide-react";
import type { EjesRemovalRow } from "../../../jobs/ejes-calles/types";
import type { TableColumn } from "../../shared/ReportParts";
import { ShowOnMapButton } from "../../shared/map/ShowOnMapButton";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { REMOVAL_COLUMNS } from "../ejesReportColumns";

/** The held removal columns; with `onResolve`, a first column opens the map where its replacement is chosen (a row with no reftramo has none). */
export const removalColumnsOf = (onResolve?: (row: EjesRemovalRow) => void): TableColumn<EjesRemovalRow>[] =>
  onResolve === undefined
    ? REMOVAL_COLUMNS
    : [
        {
          header: EJES_MANUAL_SPLIT_TEXT.COLUMN_MAP,
          cell: (row) =>
            row.ref === "" ? null : (
              <ShowOnMapButton label={EJES_MANUAL_SPLIT_TEXT.RESOLVE} icon={Route} onShow={() => onResolve(row)} />
            ),
        },
        ...REMOVAL_COLUMNS,
      ];
