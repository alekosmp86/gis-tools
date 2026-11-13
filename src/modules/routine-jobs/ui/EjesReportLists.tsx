import React from "react";
import type { EjesResult } from "../jobs/ejes-calles/types";
import { EJES_LIST, type EjesListKey } from "./ejesCallesListMeta";
import type { EjesReportView } from "./ejesCallesReportView";
import { EjesListSection } from "./EjesListSection";
import {
  ATTR_COLUMNS,
  INVALID_GEOMETRY_COLUMNS,
  MERGE_COLUMNS,
  REMOVAL_COLUMNS,
  RENUMBERED_COLUMNS,
  SPLIT_COLUMNS,
  STREET_COLUMNS,
  TWIN_COLUMNS,
} from "./ejesReportColumns";
import type { EjesMapSubject } from "./ejesMapSubject";
import { RowsTable } from "./ReportParts";
import styles from "./EjesReport.module.css";

export interface EjesReportListsProps {
  result: EjesResult;
  view: EjesReportView;
  openLists: ReadonlySet<EjesListKey>;
  onToggle: (list: EjesListKey, open: boolean) => void;
  onShowOnMap: (subjects: EjesMapSubject[], index: number) => void;
  subjects: Record<"splits" | "merges" | "twins" | "renumbered", EjesMapSubject[]>;
}

export const EjesReportLists: React.FC<EjesReportListsProps> = ({ result, view, openLists, onToggle, onShowOnMap, subjects }) => {
  const section = (key: EjesListKey, rowCount: number, body: React.ReactNode) =>
    rowCount > 0 && (
      <EjesListSection listKey={key} summary={view.summaries[key]} open={openLists.has(key)} onToggle={(open) => onToggle(key, open)}>
        {body}
      </EjesListSection>
    );
  return (
    <div className={styles.lists}>
      {section(
        EJES_LIST.SPLITS,
        result.splits.length,
        <RowsTable columns={SPLIT_COLUMNS} rows={result.splits} rowKey={(row) => row.oldRef} onShowOnMap={(row) => onShowOnMap(subjects.splits, result.splits.indexOf(row))} />
      )}
      {section(
        EJES_LIST.MERGES,
        result.merges.length,
        <RowsTable columns={MERGE_COLUMNS} rows={result.merges} rowKey={(row) => row.newRef} onShowOnMap={(row) => onShowOnMap(subjects.merges, result.merges.indexOf(row))} />
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
        EJES_LIST.TWINS,
        result.twins.length,
        <RowsTable columns={TWIN_COLUMNS} rows={result.twins} rowKey={(row) => row.ref} onShowOnMap={(row) => onShowOnMap(subjects.twins, result.twins.indexOf(row))} />
      )}
      {section(
        EJES_LIST.PLAIN_REMOVALS,
        result.plainRemovals.length,
        <RowsTable columns={REMOVAL_COLUMNS} rows={result.plainRemovals} rowKey={(row) => row.ref} />
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
