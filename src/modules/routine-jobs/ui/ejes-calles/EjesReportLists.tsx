import React from "react";
import type { EjesMergeRow, EjesResult, EjesSplitRow } from "../../jobs/ejes-calles/types";
import type { EjesSplitPointsBase } from "../shared/clientTypes";
import { EJES_LIST, type EjesListKey } from "./ejesCallesListMeta";
import type { EjesReportView } from "./ejesCallesReportView";
import { EjesAcceptableRows } from "./EjesAcceptableRows";
import { EjesListSection } from "./EjesListSection";
import { EjesSplitsSection } from "./EjesSplitsSection";
import { EjesAcceptList, splitKeyOf, type EjesAcceptView } from "./ejesAccept";
import { acceptedCountTextOf } from "./ejesAcceptTexts";
import { mergeColumnsOf } from "./compact/ejesMergeColumns";
import { splitColumnsOf } from "./compact/ejesSplitColumns";
import {
  ATTR_COLUMNS,
  INVALID_GEOMETRY_COLUMNS,
  REMOVAL_COLUMNS,
  RENUMBER_HELD_COLUMNS,
  RENUMBERED_COLUMNS,
  STREET_COLUMNS,
  TWIN_COLUMNS,
} from "./ejesReportColumns";
import type { EjesMapSubject } from "./ejesMapSubject";
import { RowsTable } from "../shared/ReportParts";
import styles from "./EjesReport.module.css";

export interface EjesReportListsProps {
  result: EjesResult;
  view: EjesReportView;
  openLists: ReadonlySet<EjesListKey>;
  onToggle: (list: EjesListKey, open: boolean) => void;
  onShowOnMap: (subjects: EjesMapSubject[], index: number) => void;
  subjects: Record<"splits" | "merges" | "twins" | "renumbered", EjesMapSubject[]>;
  /** Absent on a read-only report (a real-run result): merges and removals then have no accept controls. */
  accept?: EjesAcceptView;
  /** The connection and tables of the wizard for the split review; null while the wizard holds no password. */
  splitBase?: EjesSplitPointsBase | null;
}

export const EjesReportLists: React.FC<EjesReportListsProps> = ({
  result,
  view,
  openLists,
  onToggle,
  onShowOnMap,
  subjects,
  accept,
  splitBase = null,
}) => {
  const section = (key: EjesListKey, rowCount: number, body: React.ReactNode, badge?: string) =>
    rowCount > 0 && (
      <EjesListSection
        listKey={key}
        summary={view.summaries[key]}
        badge={badge}
        open={openLists.has(key)}
        onToggle={(open) => onToggle(key, open)}
      >
        {body}
      </EjesListSection>
    );
  const badgeOf = (list: EjesAcceptList, total: number): string | undefined =>
    accept === undefined ? undefined : acceptedCountTextOf(accept.keys[list].length, total);
  const showSplit = (row: EjesSplitRow): void => onShowOnMap(subjects.splits, result.splits.indexOf(row));
  const showMerge = (row: EjesMergeRow): void => onShowOnMap(subjects.merges, result.merges.indexOf(row));
  return (
    <div className={styles.lists}>
      {section(
        EJES_LIST.SPLITS,
        result.splits.length,
        accept === undefined ? (
          <RowsTable columns={splitColumnsOf(showSplit)} rows={result.splits} rowKey={splitKeyOf} />
        ) : (
          <EjesSplitsSection rows={result.splits} total={result.counts.splits} accept={accept} splitBase={splitBase} onShowOnMap={showSplit} />
        )
      )}
      {section(
        EJES_LIST.MERGES,
        result.merges.length,
        accept === undefined ? (
          <RowsTable columns={mergeColumnsOf(showMerge)} rows={result.merges} rowKey={(row) => row.newRef} />
        ) : (
          <EjesAcceptableRows
            list={EjesAcceptList.MERGES}
            rows={result.merges}
            total={result.counts.merges}
            columns={mergeColumnsOf(showMerge)}
            rowKey={(row) => row.newRef}
            accept={accept}
          />
        ),
        badgeOf(EjesAcceptList.MERGES, result.counts.merges)
      )}
      {section(
        EJES_LIST.RENUMBERED,
        result.renumbered.length,
        <RowsTable
          columns={RENUMBERED_COLUMNS}
          rows={result.renumbered}
          rowKey={(row) => row.oldRef}
          onShowOnMap={(row) => onShowOnMap(subjects.renumbered, result.renumbered.indexOf(row))}
        />
      )}
      {section(
        EJES_LIST.RENUMBER_HELD,
        result.renumberSkipped.length,
        <RowsTable columns={RENUMBER_HELD_COLUMNS} rows={result.renumberSkipped} rowKey={(row) => `${row.oldRef}|${row.newRef}`} />
      )}
      {section(
        EJES_LIST.TWINS,
        result.twins.length,
        <RowsTable columns={TWIN_COLUMNS} rows={result.twins} rowKey={(row) => row.ref} onShowOnMap={(row) => onShowOnMap(subjects.twins, result.twins.indexOf(row))} />
      )}
      {section(
        EJES_LIST.PLAIN_REMOVALS,
        result.plainRemovals.length,
        accept === undefined ? (
          <RowsTable columns={REMOVAL_COLUMNS} rows={result.plainRemovals} rowKey={(row) => row.ref} />
        ) : (
          <EjesAcceptableRows
            list={EjesAcceptList.PLAIN_REMOVALS}
            rows={result.plainRemovals}
            total={result.counts.plainRemovals}
            columns={REMOVAL_COLUMNS}
            rowKey={(row) => row.ref}
            acceptable={(row) => row.ref !== ""}
            accept={accept}
          />
        ),
        badgeOf(EjesAcceptList.PLAIN_REMOVALS, result.counts.plainRemovals)
      )}
      {section(
        EJES_LIST.INVALID_GEOMETRIES,
        result.staging.invalidGeometries.length,
        <RowsTable
          columns={INVALID_GEOMETRY_COLUMNS}
          rows={result.staging.invalidGeometries}
          rowKey={(row) => `${row.ref}|${row.localidad}|${row.departamento}`}
        />
      )}
      {section(
        EJES_LIST.NEW_STREETS,
        result.newStreets.length,
        <RowsTable columns={STREET_COLUMNS} rows={result.newStreets} rowKey={(row) => `${row.idcalle}|${row.name}`} />
      )}
      {section(EJES_LIST.ATTR_CHANGES, view.attrRows.length, <RowsTable columns={ATTR_COLUMNS} rows={view.attrRows} rowKey={(row) => row.ref} />)}
    </div>
  );
};
