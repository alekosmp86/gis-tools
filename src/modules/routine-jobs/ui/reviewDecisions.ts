import type { AcceptedGeometry, PairChoice } from "../jobs/actualizar-padron/types";
import type { PairChoiceSelection } from "./PairChoiceGroups";

/**
 * The accepted pending geometries (AP-100). `accepted` is the current selection and `submitted` the one sent with the shown run.
 * Without the callbacks (a real-run result, or Actualizar geometrías off) the decisions are read-only.
 */
export interface GeometryAcceptSelection {
  accepted: readonly AcceptedGeometry[];
  submitted: readonly AcceptedGeometry[];
  onAcceptMany?: (accepts: AcceptedGeometry[]) => void;
  onRejectMany?: (accepts: AcceptedGeometry[]) => void;
}

/** Everything the decision controls of the map modal read and change, live from the wizard state. */
export interface ReviewDecisions {
  pairs: PairChoiceSelection;
  unappliedChoices: readonly PairChoice[];
  geometries: GeometryAcceptSelection;
  /** Why the geometries cannot be accepted here; null when they can. */
  geometryLockReason: string | null;
}

/** The submitted acceptances shown read-only. */
export const readOnlyAcceptsOf = (submitted: readonly AcceptedGeometry[]): GeometryAcceptSelection => ({ accepted: submitted, submitted });
