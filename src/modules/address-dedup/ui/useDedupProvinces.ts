"use client";

import { useRef, useState } from "react";
import type { ConnectionPayload, ProvinceOption } from "../types";
import { fetchProvinces } from "./dedupClient";

const NO_PROVINCES: ReadonlyArray<ProvinceOption> = [];

/**
 * Loads the departamentos on demand. Not a cached query: the request carries credentials and the
 * list belongs to one database. `reset` also discards a load still in flight, so a list fetched
 * for an earlier connection can never land after the connection changed.
 */
export function useDedupProvinces() {
  const [provinces, setProvinces] = useState<ReadonlyArray<ProvinceOption>>(NO_PROVINCES);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const latestRequest = useRef(0);

  const load = (connection: ConnectionPayload): Promise<void> => {
    latestRequest.current += 1;
    const requestId = latestRequest.current;
    const isCurrent = () => requestId === latestRequest.current;

    setIsLoading(true);
    setError(null);
    return fetchProvinces(connection)
      .then((response) => {
        if (isCurrent()) setProvinces(response.provinces);
      })
      .catch((failure: unknown) => {
        if (!isCurrent()) return;
        setProvinces(NO_PROVINCES);
        setError(failure instanceof Error ? failure : new Error("No se pudieron cargar los departamentos."));
      })
      .finally(() => {
        if (isCurrent()) setIsLoading(false);
      });
  };

  const reset = () => {
    latestRequest.current += 1;
    setProvinces(NO_PROVINCES);
    setError(null);
    setIsLoading(false);
  };

  return { provinces, error, isLoading, load, reset };
}
