"use client";

import { useState } from "react";
import type { AnalyzeResponsePayload, DedupRequestPayload } from "../types";
import { analyzeDuplicates } from "./dedupClient";

/**
 * Runs the analysis on demand. Not a cached query: the request carries credentials and the answer
 * is a point-in-time view of a live database, so nothing should be shared or replayed from a cache.
 */
export function useDedupAnalysis() {
  const [data, setData] = useState<AnalyzeResponsePayload | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [resultId, setResultId] = useState(0);

  const run = (payload: DedupRequestPayload): Promise<void> => {
    setIsPending(true);
    setError(null);
    return analyzeDuplicates(payload)
      .then((response) => {
        setData(response);
        setResultId((previous) => previous + 1);
      })
      .catch((failure: unknown) => {
        setData(null);
        setError(failure instanceof Error ? failure : new Error("No se pudo analizar los duplicados."));
      })
      .finally(() => setIsPending(false));
  };

  return { data, error, isPending, resultId, run };
}
