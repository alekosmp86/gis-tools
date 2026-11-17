"use client";

import React, { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Modal } from "@/ui-kit/components/Modal";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { EjesSplitPointsPage, EjesSplitReviewPoint, EjesSplitRow } from "../../../jobs/ejes-calles/types";
import type { EjesSplitPointsBase } from "../../shared/clientTypes";
import { ReviewNavigation } from "../../shared/map/ReviewNavigation";
import { isSplitAcceptable, pointReviewCountOf, type EjesAcceptView } from "../ejesAccept";
import { EjesSplitPointMap } from "./EjesSplitPointMap";
import { EjesSplitPointPanel } from "./EjesSplitPointPanel";
import { EjesSplitReviewFooter } from "./EjesSplitReviewFooter";
import { ReasonFilterSelect } from "./ReasonFilterSelect";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import { filterPointsByReason, REASON_FILTER, splitPointMapOf, type ReasonFilter } from "./ejesSplitReviewView";
import { SplitPointsStatus, useEjesSplitPoints } from "./useEjesSplitPoints";
import { useSplitChoices } from "./useSplitChoices";
import styles from "./EjesSplitReview.module.css";

const ICON_SIZE = 15;
const NO_POINTS: EjesSplitReviewPoint[] = [];

export interface EjesSplitReviewModalProps {
  split: EjesSplitRow;
  /** The connection, tables and dry run of the wizard; null while the wizard holds no password. */
  base: EjesSplitPointsBase | null;
  accept: EjesAcceptView;
  onClose: () => void;
}

/**
 * The review of one split: its stored review points one at a time, with their candidate pieces, the map and the bulk suggestion. The
 * choices live in the accept state of the wizard, so a closed modal keeps them; the split is accepted from here or from its list row.
 */
export function EjesSplitReviewModal({ split, base, accept, onClose }: EjesSplitReviewModalProps) {
  const baseKey = base === null ? "" : JSON.stringify(base);
  const load = useEjesSplitPoints(split.oldRef === "" ? null : split.oldRef, base, baseKey);
  const [reason, setReason] = useState<ReasonFilter>(REASON_FILTER.ALL);
  const [index, setIndex] = useState<number>(0);
  const [mapOpen, setMapOpen] = useState<boolean>(false);
  const page = load.page;
  const points = page?.points ?? NO_POINTS;
  const listed = useMemo(() => filterPointsByReason(points, reason), [points, reason]);
  const countMismatch = page !== null && page.total !== pointReviewCountOf(split);
  const choices = useSplitChoices(split, accept, points, countMismatch);
  const safeIndex = Math.min(index, Math.max(0, listed.length - 1));
  const current: EjesSplitReviewPoint | undefined = listed[safeIndex];
  const acceptable = isSplitAcceptable(split, choices.chosenByPoint.size);

  const changeReason = (next: ReasonFilter) => {
    setReason(next);
    setIndex(0);
  };

  const renderPoints = (loaded: EjesSplitPointsPage) => (
    <>
      {countMismatch && <AlertMessage type={AlertType.WARNING} text={EJES_SPLIT_REVIEW_TEXT.COUNT_MISMATCH} />}
      {loaded.addressIssues.length > 0 && (
        <p className={styles.note}>{`${EJES_SPLIT_REVIEW_TEXT.ADDRESS_NOTE_PREFIX}${loaded.addressIssues.join(" ")}`}</p>
      )}
      <div className={styles.filters}>
        <ReasonFilterSelect value={reason} onChange={changeReason} />
      </div>
      {listed.length === 0 ? (
        <p className={styles.notice}>{EJES_SPLIT_REVIEW_TEXT.EMPTY}</p>
      ) : (
        <ReviewNavigation index={safeIndex} total={listed.length} onNavigate={setIndex} />
      )}
      {current !== undefined && (
        <EjesSplitPointPanel
          point={current}
          chosenRef={choices.chosenByPoint.get(current.pointId)}
          disabled={choices.choiceBlocked(current)}
          mapOpen={mapOpen}
          onChoose={(newRef) => choices.chooseCandidate(current, newRef)}
          onToggleMap={() => setMapOpen((open) => !open)}
        />
      )}
      {mapOpen && current !== undefined && (
        <EjesSplitPointMap
          collection={splitPointMapOf(loaded, split.oldRef, current, choices.chosenByPoint.get(current.pointId))}
        />
      )}
      <EjesSplitReviewFooter
        suggestedCount={choices.suggestedCount}
        acceptable={acceptable}
        accepted={choices.accepted}
        note={choices.note}
        onAcceptSuggested={choices.acceptSuggested}
        onToggleSplit={choices.toggleSplit}
      />
    </>
  );

  const renderBody = () => {
    if (base === null) return <p className={styles.notice}>{EJES_SPLIT_REVIEW_TEXT.NO_PASSWORD}</p>;
    if (split.oldRef === "") return <p className={styles.notice}>{EJES_SPLIT_REVIEW_TEXT.NO_REFTRAMO}</p>;
    if (load.status === SplitPointsStatus.LOADING) {
      return <p className={styles.notice} role="status">{EJES_SPLIT_REVIEW_TEXT.LOADING}</p>;
    }
    if (load.status === SplitPointsStatus.ERROR || page === null) {
      return (
        <div className={styles.body}>
          <AlertMessage type={AlertType.ERROR} text={load.message ?? EJES_SPLIT_REVIEW_TEXT.LOAD_FAILED} />
          <div>
            <Button variant={ButtonVariant.SECONDARY} onClick={load.retry}>
              <RotateCcw size={ICON_SIZE} />
              <span>{EJES_SPLIT_REVIEW_TEXT.RETRY}</span>
            </Button>
          </div>
        </div>
      );
    }
    return renderPoints(page);
  };

  return (
    <Modal title={EJES_SPLIT_REVIEW_TEXT.MODAL_TITLE} onClose={onClose}>
      <div className={styles.body}>
        <p className={styles.intro}>{EJES_SPLIT_REVIEW_TEXT.HEADING(split.oldRef, split.idcalle)}</p>
        <p className={styles.progress}>{EJES_SPLIT_REVIEW_TEXT.PROGRESS(choices.chosenByPoint.size, pointReviewCountOf(split))}</p>
        {renderBody()}
      </div>
    </Modal>
  );
}
