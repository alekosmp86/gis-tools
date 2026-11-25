import React from "react";
import type { EjesGeoTwinRow, EjesMergeRow, EjesRemovalRow, EjesResult, EjesSplitRow, EjesTwinUndecidedRow } from "../../jobs/ejes-ide/types";
import type { EjesSplitPointsBase } from "./shared/ejesIdeClientTypes";
import { EJES_LIST, type EjesListKey } from "./ejesIdeListMeta";
import type { EjesReportView } from "./ejesIdeReportView";
import { EjesAcceptableRows } from "./EjesAcceptableRows";
import { EjesListSection } from "./EjesListSection";
import { EjesSplitsSection } from "./EjesSplitsSection";
import { TwinUndecidedSection } from "./TwinUndecidedSection";
import { EjesAcceptList, NO_IGNORED_REFS, acceptedKeysOfList, isPlainRemovalAcceptable, plainRemovalNotAcceptableText, splitKeyOf, type EjesAcceptView } from "./ejesAccept";
import { acceptedCountTextOf, EJES_MANUAL_SPLIT_TEXT } from "./ejesAcceptTexts";
import { renamedStreetKeyOf, renamedStreetRowsOf } from "./ejesRenamedStreetsView";
import { renamedStreetColumnsOf, renamedToggleDisabledOf } from "./renamedStreetColumns";
import { manualResolutionReaderOf, resolvedCountOf, resolvedPredicateOf } from "./manualSplit/manualResolutionView";
import { mergeColumnsOf } from "./compact/ejesMergeColumns";
import { splitColumnsOf } from "./compact/ejesSplitColumns";
import { GEO_TWIN_COLUMNS, GEO_TWIN_TEXT, isGeoTwinRemovable } from "./compact/ejesGeoTwinColumns";
import { ATTR_COLUMNS, HELD_RENUMBER_COLUMNS, INVALID_GEOMETRY_COLUMNS, KEPT_BY_DISCARDED_COLUMNS, REMOVAL_COLUMNS, RENAMED_STREET_COLUMNS, RENUMBER_DROPPED_COLUMNS, STREET_COLUMNS } from "./ejesReportColumns";
import { removalColumnsOf } from "./compact/ejesRemovalColumns";
import { heldRenumberKeyOf, type EjesHeldRenumberView } from "./ejesRenumberHeldView";
import { subjectOfGeoTwin, subjectOfHeldCandidates, type EjesMapSubject } from "./ejesMapSubject";
import { RowsTable } from "../shared/ReportParts";
import styles from "./EjesReport.module.css";

export interface EjesReportListsProps {
  result: EjesResult;
  view: EjesReportView;
  openLists: ReadonlySet<EjesListKey>;
  onToggle: (list: EjesListKey, open: boolean) => void;
  onShowOnMap: (subjects: EjesMapSubject[], index: number) => void;
  subjects: Record<"splits" | "merges" | "twinUndecided", EjesMapSubject[]>;
  /** Absent on a read-only report (a real-run result): merges and removals then have no accept controls. */
  accept?: EjesAcceptView;
  /** The connection and tables of the wizard for the split review; null while the wizard holds no password. */
  splitBase?: EjesSplitPointsBase | null;
  /** Opens the map where a held removal's replacement is chosen; absent on a read-only report. */
  onResolveRemoval?: (row: EjesRemovalRow) => void;
}

const ignoredRefsOf = (accept: EjesAcceptView): readonly string[] => accept.ignoredRefs ?? NO_IGNORED_REFS;

/** The "N de M resueltos" of the plain removals: N counts the listed rows the user resolved, M is every row the analysis holds. */
const plainRemovalsBadgeOf = (rows: EjesRemovalRow[], plainHeld: number, accept: EjesAcceptView | undefined): string | undefined =>
  accept === undefined
    ? undefined
    : EJES_MANUAL_SPLIT_TEXT.RESOLVED_COUNT(
        resolvedCountOf(rows, resolvedPredicateOf(accept.manualSplits, ignoredRefsOf(accept))),
        plainHeld
      );

export const EjesReportLists: React.FC<EjesReportListsProps> = ({
  result,
  view,
  openLists,
  onToggle,
  onShowOnMap,
  subjects,
  accept,
  splitBase = null,
  onResolveRemoval,
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
    accept === undefined ? undefined : acceptedCountTextOf(acceptedKeysOfList(accept.keys, list).length, total);
  const renamedStreets = renamedStreetRowsOf(result);
  const showSplit = (row: EjesSplitRow): void => onShowOnMap(subjects.splits, result.splits.indexOf(row));
  const showMerge = (row: EjesMergeRow): void => onShowOnMap(subjects.merges, result.merges.indexOf(row));
  const showHeld = (held: EjesHeldRenumberView): void =>
    onShowOnMap([subjectOfHeldCandidates(held.oldRef, held.newRefs, held.idcalle, held.points)], 0);
  const showGeoTwin = (row: EjesGeoTwinRow): void => onShowOnMap([subjectOfGeoTwin(row)], 0);
  const showUndecided = (row: EjesTwinUndecidedRow): void => onShowOnMap(subjects.twinUndecided, result.twinUndecided.indexOf(row));
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
        EJES_LIST.RENUMBER_HELD,
        result.renumberSkipped.length,
        <RowsTable columns={HELD_RENUMBER_COLUMNS} rows={view.heldRenumbers} rowKey={heldRenumberKeyOf} onShowOnMap={showHeld} />
      )}
      {section(
        EJES_LIST.RENUMBER_DROPPED,
        result.renumberDropped.length,
        <RowsTable columns={RENUMBER_DROPPED_COLUMNS} rows={result.renumberDropped} rowKey={(row) => row.ref} />
      )}
      {accept !== undefined &&
        section(
          EJES_LIST.TWIN_UNDECIDED,
          result.twinUndecided.length,
          <TwinUndecidedSection
            rows={result.twinUndecided}
            picks={accept.twinPicks}
            onChange={accept.onTwinPickChange}
            onShowOnMap={showUndecided}
          />
        )}
      {section(
        EJES_LIST.PLAIN_REMOVALS,
        view.plainRemovalRows.length,
        accept === undefined ? (
          <RowsTable columns={REMOVAL_COLUMNS} rows={view.plainRemovalRows} rowKey={(row) => row.ref} />
        ) : (
          <EjesAcceptableRows
            list={EjesAcceptList.PLAIN_REMOVALS}
            rows={view.plainRemovalRows}
            total={view.plainRemovalRows.length}
            columns={removalColumnsOf(onResolveRemoval, manualResolutionReaderOf(accept.manualSplits, ignoredRefsOf(accept)))}
            rowKey={(row) => row.ref}
            acceptable={isPlainRemovalAcceptable}
            notAcceptableText={plainRemovalNotAcceptableText}
            accept={accept}
          />
        ),
        plainRemovalsBadgeOf(view.plainRemovalRows, result.counts.plainHeld, accept)
      )}
      {section(
        EJES_LIST.KEPT_BY_DISCARDED,
        result.keptByDiscarded.length,
        <RowsTable columns={KEPT_BY_DISCARDED_COLUMNS} rows={result.keptByDiscarded} rowKey={(row) => `${row.ref}|${row.idcalle}|${row.discardedRef}`} />
      )}
      {section(
        EJES_LIST.GEO_TWINS,
        result.geoTwins.length,
        accept === undefined ? (
          <RowsTable columns={GEO_TWIN_COLUMNS} rows={result.geoTwins} rowKey={(row) => row.ref} onShowOnMap={showGeoTwin} />
        ) : (
          <EjesAcceptableRows
            list={EjesAcceptList.TWIN_REMOVALS}
            rows={result.geoTwins}
            total={result.counts.geoTwinSections}
            columns={GEO_TWIN_COLUMNS}
            rowKey={(row) => row.ref}
            acceptable={isGeoTwinRemovable}
            notAcceptableText={GEO_TWIN_TEXT.NOT_REMOVABLE}
            accept={accept}
            counterText={acceptedCountTextOf(accept.keys.twinRemovals.length, result.counts.geoTwinLosersRemovable)}
            onShowOnMap={showGeoTwin}
          />
        ),
        badgeOf(EjesAcceptList.TWIN_REMOVALS, result.counts.geoTwinLosersRemovable)
      )}
      {section(
        EJES_LIST.RENAMED_STREETS,
        renamedStreets.length,
        accept === undefined ? (
          <RowsTable columns={RENAMED_STREET_COLUMNS} rows={renamedStreets} rowKey={renamedStreetKeyOf} />
        ) : (
          <EjesAcceptableRows
            list={EjesAcceptList.RENAMED_STREETS}
            rows={renamedStreets}
            total={result.counts.renamedStreets ?? renamedStreets.length}
            columns={renamedStreetColumnsOf(accept)}
            rowKey={renamedStreetKeyOf}
            toggleDisabled={renamedToggleDisabledOf(accept)}
            accept={accept}
          />
        ),
        badgeOf(EjesAcceptList.RENAMED_STREETS, renamedStreets.length)
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
