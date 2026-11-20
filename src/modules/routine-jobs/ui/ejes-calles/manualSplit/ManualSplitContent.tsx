"use client";

import React, { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { MANUAL_CANDIDATE_RADIUS_M } from "../../../jobs/ejes-calles/constants";
import type { EjesRemovalRow } from "../../../jobs/ejes-calles/types";
import type { EjesGeometryMapBase } from "../../shared/clientTypes";
import { OutlineMapBody } from "../../shared/map/OutlineMapBody";
import { MapLoadStatus } from "../../shared/map/useOutlineMapFeatures";
import { textOrNoData } from "../../shared/reportFormat";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { ManualCandidateList } from "./ManualCandidateList";
import { ManualSplitControls } from "./ManualSplitControls";
import { ManualSplitFooter } from "./ManualSplitFooter";
import { ManualSplitMap } from "./ManualSplitMap";
import { useManualCandidates } from "./useManualCandidates";
import { canChooseMore, chosenCandidatesOf, manualSplitMapOf, oldLengthOf, sortedCandidatesOf } from "./manualSplitView";
import styles from "./manualSplit.module.css";

const ICON_SIZE = 15;

export interface ManualSplitContentProps {
  row: EjesRemovalRow;
  base: EjesGeometryMapBase;
  /** The new sections already chosen for this old section; the choice starts from them. */
  storedRefs: readonly string[];
  onApply: (newRefs: string[]) => void;
}

/** The resolution of one held removal: the candidates on the map and in the checklist, the search controls and the apply. */
export function ManualSplitContent({ row, base, storedRefs, onApply }: ManualSplitContentProps) {
  const [selectedRefs, setSelectedRefs] = useState<string[]>([...storedRefs]);
  const [radius, setRadius] = useState<number>(MANUAL_CANDIDATE_RADIUS_M);
  const [otherStreets, setOtherStreets] = useState<boolean>(false);
  const map = useManualCandidates(base, Number(row.ref), radius, otherStreets);
  const chosen = chosenCandidatesOf(map.candidates, selectedRefs);
  const collection = useMemo(
    () => manualSplitMapOf(map.features, map.candidates, selectedRefs),
    [map.features, map.candidates, selectedRefs]
  );
  const oldLength = oldLengthOf(map.features);

  const toggleRef = (ref: string) =>
    setSelectedRefs((current) => {
      if (current.includes(ref)) return current.filter((selected) => selected !== ref);
      return canChooseMore(current.length) ? [...current, ref] : current;
    });

  const mapArea = (): React.ReactNode => {
    if (map.status === MapLoadStatus.LOADING) {
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
    return <ManualSplitMap collection={collection} viewKey={`${row.ref}|${radius}|${otherStreets}|${map.candidates.length}`} onToggleCandidate={toggleRef} />;
  };

  const details = (
    <section className={styles.details} aria-live="polite">
      <p className={styles.hint}>{EJES_MANUAL_SPLIT_TEXT.FACTS(textOrNoData(row.idcalle), row.points)}</p>
      <p className={styles.hint}>{EJES_MANUAL_SPLIT_TEXT.HELP}</p>
      {map.status === MapLoadStatus.READY && (
        <>
          <ManualCandidateList candidates={sortedCandidatesOf(map.candidates)} chosenRefs={selectedRefs} onToggle={toggleRef} />
          <ManualSplitFooter
            chosen={chosen}
            selectedCount={selectedRefs.length}
            oldLength={oldLength}
            onApply={() => onApply(chosen.map((candidate) => candidate.ref))}
            onClear={() => setSelectedRefs([])}
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
