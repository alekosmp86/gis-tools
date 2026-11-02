import { pairChoiceKeyId } from "../jobs/actualizar-padron/domain/pairChoiceKey";
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

/** The ambiguous group a listed pair is a candidate of, when it is one. */
function groupOfRow(row: PairRowView, groupsById: ReadonlyMap<string, AmbiguousGroupView>): AmbiguousGroupView | null {
  if (row.choice === null) return null;
  const group = groupsById.get(pairChoiceKeyId(row.choice));
  const oldId = row.choice.oldId;
  return group !== undefined && group.candidates.some((candidate) => candidate.oldId === oldId) ? group : null;
}

/** A pending pair gets accept and reject, an ambiguous one the radios of its group; an applied pair is shown only. */
export function pairReviewItemsOf(rows: readonly PairRowView[], groups: readonly AmbiguousGroupView[]): PadronReviewItem[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  return rows.map((row): PadronReviewItem => {
    if (row.pending) return { kind: REVIEW_KIND.PENDING_PAIR, subject: row.subject, choice: row.choice };
    const group = groupOfRow(row, groupsById);
    return group === null ? { kind: REVIEW_KIND.INFO, subject: row.subject } : ambiguousItemOf(group);
  });
}

export const missingReviewItemsOf = (rows: readonly MissingPadronView[]): PadronReviewItem[] =>
  rows.map((padron) => ({ kind: REVIEW_KIND.MISSING, subject: padron.subject, padron }));
