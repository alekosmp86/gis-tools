"use client";

import React from "react";
import { Modal } from "@/ui-kit/components/Modal";
import type { GeometryMapBase } from "./clientTypes";
import { PadronMapBody } from "./PadronMapBody";
import { PadronReviewDecision } from "./PadronReviewDecision";
import type { PadronReview } from "./padronReviewItems";
import type { ReviewDecisions } from "./reviewDecisions";
import { ReviewNavigation } from "./ReviewNavigation";

export interface PadronMapModalProps {
  /** The rows of the table the modal was opened from and the one on screen; null while closed. */
  review: PadronReview | null;
  /** The connection of the wizard for the map; null when the wizard holds no password. */
  base: GeometryMapBase | null;
  decisions: ReviewDecisions;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

/**
 * The map of one padrón in a dialog, with the decision controls of its row and the way to the previous and next rows of the same
 * table. Mounted only while a review is open, so the dialog's behaviour starts and ends with it; moving keeps the dialog and its map.
 */
export function PadronMapModal({ review, base, decisions, onNavigate, onClose }: PadronMapModalProps) {
  if (review === null) return null;
  const item = review.items[review.index];
  if (item === undefined) return null;
  return (
    <Modal title={item.subject.title} onClose={onClose}>
      <ReviewNavigation index={review.index} total={review.items.length} onNavigate={onNavigate} />
      <PadronMapBody subject={item.subject} base={base} aside={<PadronReviewDecision item={item} decisions={decisions} />} />
    </Modal>
  );
}
