import { useCallback, useEffect, useMemo, useState } from "react";
import type { GeometryMapFeature, GeometryMapItem, GeometryMapRole } from "../jobs/actualizar-padron/types";
import type { GeometryMapBase } from "./clientTypes";
import { createRoutineJobsClient } from "./routineJobsClient";
import type { PadronMapSubject } from "./padronMapSubject";

export const MapLoadStatus = {
  LOADING: "LOADING",
  READY: "READY",
  ERROR: "ERROR",
} as const;

export type MapLoadStatus = (typeof MapLoadStatus)[keyof typeof MapLoadStatus];

export interface PadronMapFeatures {
  status: MapLoadStatus;
  features: GeometryMapFeature[];
  message: string | null;
  retry: () => void;
}

type ItemFeature = Omit<GeometryMapFeature, "itemIndex">;

const client = createRoutineJobsClient();
const FALLBACK_ERROR = "No se pudieron cargar las geometrías del mapa.";

/** The connection and tables name what the cache holds: another database or table never reuses an outline. */
const scopeOf = (base: GeometryMapBase): string =>
  [
    base.connection.host,
    base.connection.port,
    base.connection.db_name,
    base.connection.user,
    base.stagingSchema,
    base.stagingTable,
    base.cartoSchema,
    base.targetTable,
  ].join("|");

const cacheKeyOf = (scope: string, item: GeometryMapItem): string => `${scope}#${JSON.stringify(item)}`;

const messageOf = (error: unknown): string => (error instanceof Error && error.message !== "" ? error.message : FALLBACK_ERROR);

/** The features of each requested item, keyed by that item: the server numbers the features by request item. */
function featuresByItem(
  scope: string,
  items: readonly GeometryMapItem[],
  features: readonly GeometryMapFeature[]
): Record<string, ItemFeature[]> {
  return Object.fromEntries(
    items.map((item, index) => [
      cacheKeyOf(scope, item),
      features
        .filter((feature) => feature.itemIndex === index)
        .map(({ role, label, geometry }) => ({ role: role as GeometryMapRole, label, geometry })),
    ])
  );
}

/**
 * The outlines of one subject, fetched lazily. Only the items not cached yet are requested, one request per change of the
 * missing items. The base is compared by its serialised value, so a re-render with the same connection starts no second request.
 */
export function usePadronMapFeatures(subject: PadronMapSubject, base: GeometryMapBase): PadronMapFeatures {
  const [cache, setCache] = useState<Record<string, ItemFeature[]>>({});
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const baseKey = JSON.stringify(base);
  const scope = scopeOf(base);
  const items = subject.items;
  const requestKey = `${scope}${JSON.stringify(items)}`;
  const missingKey = JSON.stringify(items.filter((item) => cache[cacheKeyOf(scope, item)] === undefined));

  useEffect(() => {
    if (missingKey === "[]") return;
    const scopedBase = JSON.parse(baseKey) as GeometryMapBase;
    const requested = JSON.parse(missingKey) as GeometryMapItem[];
    client
      .fetchGeometryMap({ ...scopedBase, items: requested })
      .then((features) => {
        setCache((previous) => ({ ...previous, ...featuresByItem(scope, requested, features) }));
      })
      .catch((error: unknown) => {
        setFailure({ key: requestKey, message: messageOf(error) });
      });
    // The request depends on the serialised base and missing items; `attempt` lets a retry re-run it.
  }, [baseKey, missingKey, requestKey, scope, attempt]);

  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((count) => count + 1);
  }, []);

  return useMemo(() => {
    const missing = items.filter((item) => cache[cacheKeyOf(scope, item)] === undefined);
    if (missing.length > 0) {
      const failed = failure !== null && failure.key === requestKey ? failure : null;
      return failed !== null
        ? { status: MapLoadStatus.ERROR, features: [], message: failed.message, retry }
        : { status: MapLoadStatus.LOADING, features: [], message: null, retry };
    }
    const features = items.flatMap((item, index) =>
      (cache[cacheKeyOf(scope, item)] ?? []).map((feature) => ({ ...feature, itemIndex: index }))
    );
    return { status: MapLoadStatus.READY, features, message: null, retry };
  }, [items, cache, scope, failure, requestKey, retry]);
}
