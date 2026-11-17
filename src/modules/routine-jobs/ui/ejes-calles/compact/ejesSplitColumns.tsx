import React from "react";
import type { EjesSplitRow } from "../../../jobs/ejes-calles/types";
import type { TableColumn } from "../../shared/ReportParts";
import { textOrNoData } from "../../shared/reportFormat";
import { NO_REFTRAMO_TEXT } from "../ejesLoadTexts";
import { EjesDetailCell } from "./EjesDetailCell";
import { EjesPointsCell } from "./EjesPointsCell";
import { EjesRefCell } from "./EjesRefCell";
import { EjesRefsCell } from "./EjesRefsCell";
import { EJES_COMPACT_TEXT } from "./ejesCompactTexts";
import { geometryFactsOf } from "./ejesDetailFacts";

const oldRefTextOf = (row: EjesSplitRow): string => (row.oldRef === "" ? NO_REFTRAMO_TEXT : row.oldRef);

/** The columns of a split row: the removed reftramo, the new pieces, the points, an optional status, and the technical details. */
export const splitColumnsOf = (
  onShowOnMap?: (row: EjesSplitRow) => void,
  statusCell?: (row: EjesSplitRow) => React.ReactNode
): TableColumn<EjesSplitRow>[] => {
  const columns: TableColumn<EjesSplitRow>[] = [
    {
      header: EJES_COMPACT_TEXT.SPLIT_TRACE,
      cell: (row) => (
        <EjesRefCell
          primary={oldRefTextOf(row)}
          secondary={EJES_COMPACT_TEXT.STREET(textOrNoData(row.idcalle))}
          onShowOnMap={onShowOnMap === undefined ? undefined : () => onShowOnMap(row)}
        />
      ),
    },
    { header: EJES_COMPACT_TEXT.SPLIT_PIECES, cell: (row) => <EjesRefsCell label={EJES_COMPACT_TEXT.PIECE_COUNT(row.newRefs.length)} refs={row.newRefs} /> },
    { header: EJES_COMPACT_TEXT.POINTS, cell: (row) => <EjesPointsCell row={row} /> },
  ];
  if (statusCell !== undefined) columns.push({ header: EJES_COMPACT_TEXT.STATUS, cell: statusCell });
  columns.push({
    header: EJES_COMPACT_TEXT.DETAIL,
    cell: (row) => (
      <EjesDetailCell
        ariaLabel={`${EJES_COMPACT_TEXT.SHOW_DETAIL} de ${oldRefTextOf(row)}`}
        facts={[
          { label: EJES_COMPACT_TEXT.FACT_REFTRAMO_POINTS, value: String(row.refPoints) },
          { label: EJES_COMPACT_TEXT.FACT_ID_POINTS, value: String(row.points - row.refPoints) },
          ...geometryFactsOf(row),
        ]}
      />
    ),
  });
  return columns;
};
