"use client";

import React, { useState } from "react";
import type { EjesRemovalRow, EjesResult } from "../../jobs/ejes-calles/types";
import { CollapsibleSection } from "../shared/CollapsibleSection";
import type { EjesGeometryMapBase, EjesSplitPointsBase } from "../shared/clientTypes";
import { NO_IGNORED_CHANGE, NO_IGNORED_REFS, type EjesAcceptView } from "./ejesAccept";
import { EjesMapModal, type EjesMapReview } from "./EjesMapModal";
import { subjectOfMerge, subjectOfSplit, subjectOfUndecided } from "./ejesMapSubject";
import { ejesListAnchorOf, type EjesListKey } from "./ejesCallesListMeta";
import { buildEjesReportView } from "./ejesCallesReportView";
import { EjesReportLists } from "./EjesReportLists";
import { EjesSummaryStrip } from "./EjesSummaryStrip";
import { TwinPicksPanel } from "./TwinPicksPanel";
import { ManualSplitModal } from "./manualSplit/ManualSplitModal";
import { KpiCards, OutcomeBanners, SectionTitle, TimingsSection } from "../shared/ReportParts";
import sharedStyles from "../shared/ReportShared.module.css";

const ALL_INDICATORS_TITLE = "Todos los indicadores";

function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{title}</SectionTitle>
      <ul className={sharedStyles.list}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function withListState(current: ReadonlySet<EjesListKey>, list: EjesListKey, open: boolean): Set<EjesListKey> {
  const next = new Set(current);
  if (open) next.add(list);
  else next.delete(list);
  return next;
}

export interface EjesCallesReportProps {
  result: EjesResult;
  /** The connection of the wizard for the map; null when the wizard holds no password. */
  mapBase: EjesGeometryMapBase | null;
  /** The connection and tables of the wizard for the split review; null when the wizard holds no password. */
  splitBase?: EjesSplitPointsBase | null;
  /** Absent on a read-only report: the lists then show no accept controls. */
  accept?: EjesAcceptView;
}

export const EjesCallesReport: React.FC<EjesCallesReportProps> = ({ result, mapBase, splitBase = null, accept }) => {
  const view = buildEjesReportView(result);
  const [review, setReview] = useState<EjesMapReview | null>(null);
  const [manualIndex, setManualIndex] = useState<number | null>(null);
  const resolvable = view.plainRemovalRows.filter((row) => row.ref !== "");
  const openManual = (row: EjesRemovalRow) => setManualIndex(resolvable.indexOf(row));
  const [openLists, setOpenLists] = useState<ReadonlySet<EjesListKey>>(
    () => new Set(view.defaultOpenList === null ? [] : [view.defaultOpenList])
  );
  const subjects = {
    splits: result.splits.map(subjectOfSplit),
    merges: result.merges.map(subjectOfMerge),
    twinUndecided: result.twinUndecided.map(subjectOfUndecided),
  };
  const selectList = (list: EjesListKey) => {
    const opening = !openLists.has(list);
    setOpenLists(withListState(openLists, list, opening));
    if (opening) document.getElementById(ejesListAnchorOf(list))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className={sharedStyles.report}>
      <OutcomeBanners banners={view.banners} />
      <EjesSummaryStrip items={view.strip} openLists={openLists} onSelect={selectList} />
      <TextList title="Bloqueos para la carga" items={view.blockers} />
      <TextList title="Privilegios de escritura (información del análisis)" items={view.privilegeInfo} />
      {accept !== undefined && (result.twinUndecided.length > 0 || accept.twinPicks.length > 0) && (
        <TwinPicksPanel
          picks={accept.twinPicks}
          applied={result.counts.twinPicksApplied}
          canAnalyze={accept.canAnalyzeWithPicks}
          onAnalyze={accept.onAnalyzeWithPicks}
          onRemove={(ref) => accept.onTwinPickChange({ ref, copy: null })}
        />
      )}
      <EjesReportLists
        result={result}
        view={view}
        openLists={openLists}
        onToggle={(list, open) => setOpenLists((current) => (current.has(list) === open ? current : withListState(current, list, open)))}
        onShowOnMap={(listSubjects, index) => setReview({ subjects: listSubjects, index })}
        subjects={subjects}
        accept={accept}
        splitBase={splitBase}
        onResolveRemoval={accept === undefined ? undefined : openManual}
      />
      <TextList title="Tipos de vialidad fuera de la tabla" items={view.unknownTipos} />
      <TextList title="Fuentes fuera de la tabla" items={view.unknownFuentes} />
      <CollapsibleSection summary={ALL_INDICATORS_TITLE}>
        {view.kpiGroups.map((group) => (
          <section key={group.title} className={sharedStyles.section}>
            <SectionTitle>{group.title}</SectionTitle>
            {group.kpis.length > 0 ? <KpiCards kpis={group.kpis} /> : <p>{group.emptyText}</p>}
          </section>
        ))}
      </CollapsibleSection>
      <TimingsSection timings={view.timings} totalSeconds={view.totalSeconds} />
      <EjesMapModal
        review={review}
        base={mapBase}
        accept={accept}
        onNavigate={(index) => setReview((current) => (current === null ? null : { ...current, index }))}
        onClose={() => setReview(null)}
      />
      {accept !== undefined && (
        <ManualSplitModal
          review={manualIndex === null ? null : { rows: resolvable, index: manualIndex }}
          base={mapBase}
          manualSplits={accept.manualSplits}
          ignoredRefs={accept.ignoredRefs ?? NO_IGNORED_REFS}
          onChange={accept.onManualSplitChange}
          onIgnoredChange={accept.onIgnoredRefChange ?? NO_IGNORED_CHANGE}
          onNavigate={setManualIndex}
          onClose={() => setManualIndex(null)}
        />
      )}
    </div>
  );
};
