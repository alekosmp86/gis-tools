import { GEOMETRY_STATE } from "../jobs/actualizar-padron/constants";
import { pairChoiceKeyId } from "../jobs/actualizar-padron/domain/pairChoiceKey";
import type { AcceptedGeometry, PadronGeometryChange } from "../jobs/actualizar-padron/types";
import { pairChoiceKeyOf } from "./pairChoices";

export const GeometryDecisionState = {
  /** The current selection accepts the row: it is applied after the re-analysis (or already was). */
  ACCEPTED: "ACCEPTED",
  /** A pending row nobody accepted: it is not written. */
  PENDING: "PENDING",
  /** The shown run applied the row because it was accepted; the acceptance was removed since, so the re-analysis leaves it pending. */
  REJECTED: "REJECTED",
  /** Applied by the threshold: there is nothing to decide. */
  APPLIED: "APPLIED",
} as const;

export type GeometryDecisionState = (typeof GeometryDecisionState)[keyof typeof GeometryDecisionState];

export const GEOMETRY_DECISION_LABEL: Record<GeometryDecisionState, string> = {
  [GeometryDecisionState.ACCEPTED]: "Aceptada",
  [GeometryDecisionState.PENDING]: "Pendiente",
  [GeometryDecisionState.REJECTED]: "Rechazada",
  [GeometryDecisionState.APPLIED]: "Aplicada (bajo el umbral)",
};

/** The key an acceptance is sent with; null when the row lacks a field the request needs. */
export const acceptOfGeometryChange = (change: PadronGeometryChange): AcceptedGeometry | null => pairChoiceKeyOf(change);

export const acceptKeySetOf = (accepts: readonly AcceptedGeometry[]): ReadonlySet<string> => new Set(accepts.map(pairChoiceKeyId));

/** Same set of keys, order-insensitive. */
export function sameAccepts(first: readonly AcceptedGeometry[], second: readonly AcceptedGeometry[]): boolean {
  const firstKeys = acceptKeySetOf(first);
  const secondKeys = acceptKeySetOf(second);
  return firstKeys.size === secondKeys.size && [...firstKeys].every((key) => secondKeys.has(key));
}

/** The decision state of one listed row against the current and the submitted (shown run) acceptances. */
export function geometryDecisionStateOf(
  change: PadronGeometryChange,
  current: ReadonlySet<string>,
  submitted: ReadonlySet<string>
): GeometryDecisionState {
  const accept = acceptOfGeometryChange(change);
  const id = accept === null ? null : pairChoiceKeyId(accept);
  if (id !== null && current.has(id)) return GeometryDecisionState.ACCEPTED;
  if (change.state === GEOMETRY_STATE.PENDING) return GeometryDecisionState.PENDING;
  return id !== null && submitted.has(id) ? GeometryDecisionState.REJECTED : GeometryDecisionState.APPLIED;
}

/** The rows worth listing: pending ones and those the user decided. Rows applied by the threshold alone need no review. */
export function reviewableGeometryChangesOf(
  changes: readonly PadronGeometryChange[],
  current: ReadonlySet<string>,
  submitted: ReadonlySet<string>
): PadronGeometryChange[] {
  return changes.filter((change) => geometryDecisionStateOf(change, current, submitted) !== GeometryDecisionState.APPLIED);
}

/** A row the user can accept or reject: pending, or applied only because the shown run accepted it. */
export const isDecidableGeometry = (state: GeometryDecisionState, change: PadronGeometryChange): boolean =>
  acceptOfGeometryChange(change) !== null && (change.state === GEOMETRY_STATE.PENDING || state !== GeometryDecisionState.APPLIED);
