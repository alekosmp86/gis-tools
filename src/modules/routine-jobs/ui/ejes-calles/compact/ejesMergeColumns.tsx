import React from "react";
import type { EjesMergeRow } from "../../../jobs/ejes-calles/types";
import type { TableColumn } from "../../shared/ReportParts";
import { textOrNoData } from "../../shared/reportFormat";
import { EjesDetailCell } from "./EjesDetailCell";
import { EjesRefCell } from "./EjesRefCell";
import { EjesRefsCell } from "./EjesRefsCell";
import { EJES_COMPACT_TEXT } from "./ejesCompactTexts";
import { geometryFactsOf } from "./ejesDetailFacts";

/** The columns of a merge row: the new reftramo, the removed ones behind a count, the points, and the technical details. */
export const mergeColumnsOf = (onShowOnMap?: (row: EjesMergeRow) => void): TableColumn<EjesMergeRow>[] => [
  {
    header: EJES_COMPACT_TEXT.MERGE_TRACE,
    cell: (row) => (
      <EjesRefCell
        primary={row.newRef}
        secondary={EJES_COMPACT_TEXT.STREET(textOrNoData(row.idcalle))}
        onShowOnMap={onShowOnMap === undefined ? undefined : () => onShowOnMap(row)}
      />
    ),
  },
  {
    header: EJES_COMPACT_TEXT.MERGE_PIECES,
    cell: (row) => <EjesRefsCell label={EJES_COMPACT_TEXT.OLD_COUNT(row.oldRefs.length)} refs={row.oldRefs} />,
  },
  { header: EJES_COMPACT_TEXT.POINTS, cell: (row) => String(row.points) },
  {
    header: EJES_COMPACT_TEXT.DETAIL,
    cell: (row) => <EjesDetailCell ariaLabel={`${EJES_COMPACT_TEXT.SHOW_DETAIL} de ${row.newRef}`} facts={geometryFactsOf(row)} />,
  },
];
