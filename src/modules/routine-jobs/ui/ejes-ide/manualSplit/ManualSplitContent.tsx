"use client";

import React, { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { MANUAL_CANDIDATE_RADIUS_M, MANUAL_SPLIT_PIECES_LIMIT } from "../../../jobs/ejes-ide/constants";
import type { EjesRemovalRow } from "../../../jobs/ejes-ide/types";
import type { EjesGeometryMapBase } from "../shared/ejesIdeClientTypes";
import { OutlineMapBody } from "../../shared/map/OutlineMapBody";
import { MapLoadStatus } from "../../shared/map/useOutlineMapFeatures";
import { textOrNoData } from "../../shared/reportFormat";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { ManualCandidateList } from "./ManualCandidateList";
import { ManualNeighbourList } from "./ManualNeighbourList";
import { ManualSplitControls } from "./ManualSplitControls";
import { ManualSplitFooter } from "./ManualSplitFooter";
import { ManualSplitMap } from "./ManualSplitMap";
import { useManualCandidates } from "./useManualCandidates";
import { canApplyOf, canChooseMore, chosenCandidatesOf, manualSplitMapOf, oldLengthOf, pointSummaryOf, sortedCandidatesOf } from "./manualSplitView";
import styles from "./manualSplit.module.css";

const ICON_SIZE = 15;

/** The stored partners that leave the ticked ones when "Marcar cubiertos" replaces them: they are released on apply, as an untick releases them. */
const releasedOnTickAllOf = (mergeRefs: readonly string[], coveredRefs: readonly string[], storedMergeRefs: readonly string[]): string[] => {
  const covered = new Set(coveredRefs);
  const stored = new Set(storedMergeRefs);
  return mergeRefs.filter((ref) => !covered.has(ref) && stored.has(ref));
};

export interface ManualSplitContentProps {
  row: EjesRemovalRow;
  base: EjesGeometryMapBase;
  /** The new sections already chosen for this old section; the choice starts from them. */
  storedRefs: readonly string[];
  /** The old sections already merged with this one into its stored new section; the merge starts from them. */
  storedMergeRefs: readonly string[];
  ignored: boolean;
  onApply: (newRefs: string[], released: string[]) => void;
  onApplyMerge: (newRefs: string[], oldRefs: string[], released: string[]) => void;
  onIgnore: () => void;
}

/** The resolution of one held removal: the candidates and the neighbours on the map and in the checklists, the search controls, the apply and the ignore. */
export function ManualSplitContent({ row, base, storedRefs, storedMergeRefs, ignored, onApply, onApplyMerge, onIgnore }: ManualSplitContentProps) {
  const [selectedRefs, setSelectedRefs] = useState<string[]>([...storedRefs]);
  const [mergeRefs, setMergeRefs] = useState<string[]>([...storedMergeRefs]);
  const [unticked, setUnticked] = useState<string[]>([]);
  const [radius, setRadius] = useState<number>(MANUAL_CANDIDATE_RADIUS_M);
  const [otherStreets, setOtherStreets] = useState<boolean>(false);
  const [shownRef, setShownRef] = useState<string>(row.ref);
  if (shownRef !== row.ref) {
    setShownRef(row.ref);
    setSelectedRefs([...storedRefs]);
    setMergeRefs([...storedMergeRefs]);
    setUnticked([]);
    setRadius(MANUAL_CANDIDATE_RADIUS_M);
    setOtherStreets(false);
  }
  const map = useManualCandidates(base, Number(row.ref), radius, otherStreets, selectedRefs);
  const [widenedRef, setWidenedRef] = useState<string | null>(null);
  if (map.status === MapLoadStatus.READY && map.candidates.length === 0 && !otherStreets && widenedRef !== row.ref) {
    setWidenedRef(row.ref);
    setOtherStreets(true);
  }
  const chosen = chosenCandidatesOf(map.candidates, selectedRefs);
  const tickedRefs = useMemo(() => {
    const neighbourRefs = new Set(map.neighbours.map((neighbour) => neighbour.ref));
    return mergeRefs.filter((ref) => neighbourRefs.has(ref));
  }, [mergeRefs, map.neighbours]);
  const mergeMode = tickedRefs.length > 0;
  const mergedOldCount = mergeMode ? tickedRefs.length + 1 : 0;
  const collection = useMemo(
    () => manualSplitMapOf(map.features, map.candidates, selectedRefs, map.neighbours, tickedRefs, mergeMode),
    [map.features, map.candidates, map.neighbours, selectedRefs, tickedRefs, mergeMode]
  );
  const oldLength = oldLengthOf(map.features);
  const pointSummary = useMemo(
    () => pointSummaryOf(map.features, map.candidates, selectedRefs, mergeMode),
    [map.features, map.candidates, selectedRefs, mergeMode]
  );

  const toggleRef = (ref: string) =>
    setSelectedRefs((current) => {
      if (current.includes(ref)) return current.filter((selected) => selected !== ref);
      return canChooseMore(current.length) ? [...current, ref] : current;
    });

  const toggleNeighbour = (ref: string) => {
    const ticking = !mergeRefs.includes(ref);
    setMergeRefs((current) => (current.includes(ref) ? current.filter((ticked) => ticked !== ref) : [...current, ref]));
    setUnticked((current) => (ticking ? current.filter((released) => released !== ref) : [...current, ref]));
  };

  const tickAllNeighbours = () => {
    const coveredRefs = map.neighbours.filter((neighbour) => neighbour.covered === true).map((neighbour) => neighbour.ref);
    setUnticked((current) => [...current, ...releasedOnTickAllOf(mergeRefs, coveredRefs, storedMergeRefs)]);
    setMergeRefs(coveredRefs);
  };

  const clearSelection = () => {
    setSelectedRefs([]);
    setMergeRefs([]);
    setUnticked([...storedMergeRefs]);
  };

  const applyChoice = () => {
    const storedMerged = new Set(storedMergeRefs);
    const ticked = new Set(tickedRefs);
    const released = unticked.filter((ref) => storedMerged.has(ref) && !ticked.has(ref));
    if (mergedOldCount === 0) {
      onApply(chosen.map((candidate) => candidate.ref), released);
      return;
    }
    if (chosen.length > 0) onApplyMerge(chosen.map((candidate) => candidate.ref), [row.ref, ...tickedRefs], released);
  };

  const mapArea = (): React.ReactNode => {
    const loading = map.status === MapLoadStatus.LOADING;
    if (loading && map.features.length === 0) {
      return <p className={styles.status} role="status">{EJES_MANUAL_SPLIT_TEXT.LOADING}</p>;
    }
    if (map.status === MapLoadStatus.ERROR) {
      return (
        <div className={styles.error}>
          <AlertMessage type={AlertType.ERROR} text={map.message ?? EJES_MANUAL_SPLIT_TEXT.LOAD_FAILED} />
          <Button variant={ButtonVariant.SECONDARY} onClick={map.retry}>
            <RotateCcw size={ICON_SIZE} />
            <span>{EJES_MANUAL_SPLIT_TEXT.RETRY}</span>
          </Button>
        </div>
      );
    }
    return (
      <ManualSplitMap
        collection={collection}
        viewKey={map.dataKey}
        loading={loading}
        onToggleCandidate={toggleRef}
        onToggleNeighbour={toggleNeighbour}
      />
    );
  };

  const details = (
    <section className={styles.details} aria-live="polite">
      <p className={styles.hint}>{EJES_MANUAL_SPLIT_TEXT.FACTS(textOrNoData(row.idcalle), row.points)}</p>
      <p className={styles.hint}>{EJES_MANUAL_SPLIT_TEXT.HELP}</p>
      {map.status === MapLoadStatus.READY && (
        <>
          <ManualCandidateList candidates={sortedCandidatesOf(map.candidates)} chosenRefs={selectedRefs} onToggle={toggleRef} />
          <ManualNeighbourList
            neighbours={map.neighbours}
            mergeRefs={tickedRefs}
            onToggle={toggleNeighbour}
            onTickAll={tickAllNeighbours}
            refreshing={map.refreshing}
          />
          <ManualSplitFooter
            chosen={chosen}
            selectedCount={selectedRefs.length + tickedRefs.length}
            oldLength={oldLength}
            pointSummary={pointSummary}
            mergedOldCount={mergedOldCount}
            canApply={canApplyOf(chosen.length)}
            ignored={ignored}
            onApply={applyChoice}
            allSelected={selectedRefs.length >= Math.min(map.candidates.length, MANUAL_SPLIT_PIECES_LIMIT)}
            onClear={clearSelection}
            onSelectAll={() => setSelectedRefs(sortedCandidatesOf(map.candidates).slice(0, MANUAL_SPLIT_PIECES_LIMIT).map((candidate) => candidate.ref))}
            onIgnore={onIgnore}
          />
        </>
      )}
    </section>
  );

  return (
    <OutlineMapBody
      subject={row}
      notice={null}
      aside={
        <ManualSplitControls
          radius={radius}
          onRadius={setRadius}
          otherStreets={otherStreets}
          onOtherStreets={setOtherStreets}
        />
      }
      renderMap={mapArea}
      renderDetails={() => details}
    />
  );
}
