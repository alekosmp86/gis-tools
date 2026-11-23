"use client";

import React, { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { MANUAL_CANDIDATE_RADIUS_M, MANUAL_SPLIT_PIECES_LIMIT } from "../../../jobs/ejes-calles/constants";
import type { EjesRemovalRow } from "../../../jobs/ejes-calles/types";
import type { EjesGeometryMapBase } from "../../shared/clientTypes";
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
import { canApplyOf, canChooseMore, chosenCandidatesOf, manualSplitMapOf, oldLengthOf, sortedCandidatesOf } from "./manualSplitView";
import styles from "./manualSplit.module.css";

const ICON_SIZE = 15;

export interface ManualSplitContentProps {
  row: EjesRemovalRow;
  base: EjesGeometryMapBase;
  /** The new sections already chosen for this old section; the choice starts from them. */
  storedRefs: readonly string[];
  /** The old sections already merged with this one into its stored new section; the merge starts from them. */
  storedMergeRefs: readonly string[];
  ignored: boolean;
  onApply: (newRefs: string[]) => void;
  onApplyMerge: (newRefs: string[], oldRefs: string[]) => void;
  onIgnore: () => void;
}

/** The resolution of one held removal: the candidates and the neighbours on the map and in the checklists, the search controls, the apply and the ignore. */
export function ManualSplitContent({ row, base, storedRefs, storedMergeRefs, ignored, onApply, onApplyMerge, onIgnore }: ManualSplitContentProps) {
  const [selectedRefs, setSelectedRefs] = useState<string[]>([...storedRefs]);
  const [mergeRefs, setMergeRefs] = useState<string[]>([...storedMergeRefs]);
  const [radius, setRadius] = useState<number>(MANUAL_CANDIDATE_RADIUS_M);
  const [otherStreets, setOtherStreets] = useState<boolean>(false);
  const [shownRef, setShownRef] = useState<string>(row.ref);
  if (shownRef !== row.ref) {
    setShownRef(row.ref);
    setSelectedRefs([...storedRefs]);
    setMergeRefs([...storedMergeRefs]);
    setRadius(MANUAL_CANDIDATE_RADIUS_M);
    setOtherStreets(false);
  }
  const map = useManualCandidates(base, Number(row.ref), radius, otherStreets);
  const chosen = chosenCandidatesOf(map.candidates, selectedRefs);
  const tickedRefs = useMemo(
    () => mergeRefs.filter((ref) => map.neighbours.some((neighbour) => neighbour.ref === ref)),
    [mergeRefs, map.neighbours]
  );
  const mergedOldCount = tickedRefs.length === 0 ? 0 : tickedRefs.length + 1;
  const collection = useMemo(
    () => manualSplitMapOf(map.features, map.candidates, selectedRefs, map.neighbours, tickedRefs),
    [map.features, map.candidates, map.neighbours, selectedRefs, tickedRefs]
  );
  const oldLength = oldLengthOf(map.features);

  const toggleRef = (ref: string) =>
    setSelectedRefs((current) => {
      if (current.includes(ref)) return current.filter((selected) => selected !== ref);
      return canChooseMore(current.length) ? [...current, ref] : current;
    });

  const toggleNeighbour = (ref: string) =>
    setMergeRefs((current) => (current.includes(ref) ? current.filter((ticked) => ticked !== ref) : [...current, ref]));

  const clearSelection = () => {
    setSelectedRefs([]);
    setMergeRefs([]);
  };

  const applyChoice = () => {
    if (mergedOldCount === 0) {
      onApply(chosen.map((candidate) => candidate.ref));
      return;
    }
    if (chosen.length > 0) onApplyMerge(chosen.map((candidate) => candidate.ref), [row.ref, ...tickedRefs]);
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
          <ManualNeighbourList neighbours={map.neighbours} mergeRefs={tickedRefs} onToggle={toggleNeighbour} />
          <ManualSplitFooter
            chosen={chosen}
            selectedCount={selectedRefs.length + mergeRefs.length}
            oldLength={oldLength}
            mergedOldCount={mergedOldCount}
            canApply={canApplyOf(chosen.length, mergedOldCount)}
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
