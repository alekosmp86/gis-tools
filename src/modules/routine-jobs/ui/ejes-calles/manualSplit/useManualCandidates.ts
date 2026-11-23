import { useCallback, useEffect, useState } from "react";
import type { EjesMapCandidate, EjesMapFeature, EjesMapNeighbour } from "../../../jobs/ejes-calles/types";
import type { EjesGeometryMapBase } from "../../shared/clientTypes";
import { MapLoadStatus } from "../../shared/map/useOutlineMapFeatures";
import { createRoutineJobsClient } from "../../shared/routineJobsClient";

const client = createRoutineJobsClient();
const FALLBACK_ERROR = "No se pudieron cargar las geometrías del mapa.";

interface CandidateRequestKey {
  base: EjesGeometryMapBase;
  oldRef: number;
  radius: number;
  otherStreets: boolean;
  coveredBy: string[];
}

interface SettledCandidates {
  key: string;
  features: EjesMapFeature[];
  candidates: EjesMapCandidate[];
  neighbours: EjesMapNeighbour[];
  message: string | null;
}

export interface ManualCandidatesMap {
  status: MapLoadStatus;
  features: EjesMapFeature[];
  candidates: EjesMapCandidate[];
  neighbours: EjesMapNeighbour[];
  /** Names the request whose data is on screen; it changes only when new data arrives. While loading, the features and candidates are the previous ones. */
  dataKey: string;
  message: string | null;
  retry: () => void;
}

const messageOf = (error: unknown): string => (error instanceof Error && error.message !== "" ? error.message : FALLBACK_ERROR);

/**
 * The candidate new sections of one old section within the radius, with the old section's outline and its access points. Every
 * change of the request (radius, other streets, section, chosen new sections) is a new request; the result of an earlier one is never shown.
 */
export function useManualCandidates(
  base: EjesGeometryMapBase,
  oldRef: number,
  radius: number,
  otherStreets: boolean,
  coveredBy: readonly string[]
): ManualCandidatesMap {
  const requestKey = JSON.stringify({ base, oldRef, radius, otherStreets, coveredBy: [...coveredBy].sort() });
  const [settled, setSettled] = useState<SettledCandidates | null>(null);
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    const request = JSON.parse(requestKey) as CandidateRequestKey;
    let active = true;
    client
      .fetchEjesGeometryMap({
        ...request.base,
        items: [{ candidatesOf: request.oldRef, radius: request.radius, otherStreets: request.otherStreets, coveredBy: request.coveredBy }],
      })
      .then((result) => {
        if (active) setSettled({ key: requestKey, ...result, message: null });
      })
      .catch((error: unknown) => {
        if (active) setSettled({ key: requestKey, features: [], candidates: [], neighbours: [], message: messageOf(error) });
      });
    return () => {
      active = false;
    };
  }, [requestKey, attempt]);

  const retry = useCallback(() => {
    setSettled(null);
    setAttempt((count) => count + 1);
  }, []);

  const current = settled !== null && settled.key === requestKey ? settled : null;
  const dataKey = settled?.key ?? "";
  if (current === null) {
    return {
      status: MapLoadStatus.LOADING,
      features: settled?.features ?? [],
      candidates: settled?.candidates ?? [],
      neighbours: settled?.neighbours ?? [],
      dataKey,
      message: null,
      retry,
    };
  }
  if (current.message !== null) {
    return { status: MapLoadStatus.ERROR, features: [], candidates: [], neighbours: [], dataKey, message: current.message, retry };
  }
  return {
    status: MapLoadStatus.READY,
    features: current.features,
    candidates: current.candidates,
    neighbours: current.neighbours,
    dataKey,
    message: null,
    retry,
  };
}
