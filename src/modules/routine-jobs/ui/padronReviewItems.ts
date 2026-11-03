import type { PadronGeometryChange, PairChoice } from "../jobs/actualizar-padron/types";
import type { PairRowView } from "./actualizarPadronReportView";
import type { MissingPadronView } from "./missingPadronView";
import type { AmbiguousGroupView } from "./pairChoices";
import { subjectOfAmbiguousGroup, subjectOfGeometryChange, type PadronMapSubject } from "./padronMapSubject";

export const REVIEW_KIND = {
  GEOMETRY: "GEOMETRY",
  PENDING_PAIR: "PENDING_PAIR",
  AMBIGUOUS: "AMBIGUOUS",
  MISSING: "MISSING",
  INFO: "INFO",
} as const;

/** One row of a review table opened in the map modal: its map subject and what the decision controls of its kind need. */
export type PadronReviewItem =
  | { kind: typeof REVIEW_KIND.GEOMETRY; subject: PadronMapSubject; change: PadronGeometryChange }
  | { kind: typeof REVIEW_KIND.PENDING_PAIR; subject: PadronMapSubject; choice: PairChoice | null }
  | { kind: typeof REVIEW_KIND.AMBIGUOUS; subject: PadronMapSubject; group: AmbiguousGroupView }
  | { kind: typeof REVIEW_KIND.MISSING; subject: PadronMapSubject; padron: MissingPadronView }
  | { kind: typeof REVIEW_KIND.INFO; subject: PadronMapSubject };

/** The items of the table the modal was opened from, in table order, and the one on screen. */
export interface PadronReview {
  items: PadronReviewItem[];
  index: number;
}

export type OpenReview = (items: PadronReviewItem[], index: number) => void;

export const geometryReviewItemsOf = (changes: readonly PadronGeometryChange[]): PadronReviewItem[] =>
  changes.map((change) => ({ kind: REVIEW_KIND.GEOMETRY, subject: subjectOfGeometryChange(change), change }));

const ambiguousItemOf = (group: AmbiguousGroupView): PadronReviewItem => ({
  kind: REVIEW_KIND.AMBIGUOUS,
  subject: subjectOfAmbiguousGroup(group),
  group,
});

export const groupReviewItemsOf = (groups: readonly AmbiguousGroupView[]): PadronReviewItem[] => groups.map(ambiguousItemOf);

/** The pending pairs of the list the modal was opened from: each gets accept and reject. A row that is not pending is shown only. */
export const pairReviewItemsOf = (rows: readonly PairRowView[]): PadronReviewItem[] =>
  rows.map(
    (row): PadronReviewItem =>
      row.pending ? { kind: REVIEW_KIND.PENDING_PAIR, subject: row.subject, choice: row.choice } : { kind: REVIEW_KIND.INFO, subject: row.subject },
  );

export const missingReviewItemsOf = (rows: readonly MissingPadronView[]): PadronReviewItem[] =>
  rows.map((padron) => ({ kind: REVIEW_KIND.MISSING, subject: padron.subject, padron }));
