import { useMemo } from "react";
import type { PadronGeometryChange } from "../jobs/actualizar-padron/types";
import { PAIR_LIST_LIMIT } from "../jobs/shared/limits";
import {
  acceptKeySetOf,
  acceptOfGeometryChange,
  GeometryDecisionState,
  geometryDecisionStateOf,
  isDecidableGeometry,
  reviewableGeometryChangesOf,
} from "./geometryAccepts";
import { choicesWithinLimit } from "./pendingPairChoices";
import type { GeometryAcceptSelection } from "./reviewDecisions";

export function useGeometryChangesModel(allChanges: PadronGeometryChange[], selection: GeometryAcceptSelection) {
  const { accepted, submitted } = selection;
  const changes = useMemo(
    () => reviewableGeometryChangesOf(allChanges, acceptKeySetOf(accepted), acceptKeySetOf(submitted)),
    [allChanges, accepted, submitted],
  );
  const states = useMemo(() => {
    const current = acceptKeySetOf(accepted);
    const shown = acceptKeySetOf(submitted);
    return changes.map((change) => geometryDecisionStateOf(change, current, shown));
  }, [changes, accepted, submitted]);
  const acceptance = useMemo(() => {
    const open = changes.flatMap((change, index) => {
      const accept = states[index] === GeometryDecisionState.PENDING ? acceptOfGeometryChange(change) : null;
      return accept === null ? [] : [accept];
    });
    return { open: open.length, ...choicesWithinLimit(open, accepted, PAIR_LIST_LIMIT) };
  }, [changes, states, accepted]);
  const decidable = changes.filter((change, index) => isDecidableGeometry(states[index], change)).length;
  const acceptedListed = states.filter((state) => state === GeometryDecisionState.ACCEPTED).length;
  return { changes, states, acceptance, decidable, acceptedListed };
}
