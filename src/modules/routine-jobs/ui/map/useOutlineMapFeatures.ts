import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OutlineFeature } from "./outlineTypes";

export const MapLoadStatus = {
  LOADING: "LOADING",
  READY: "READY",
  ERROR: "ERROR",
} as const;

export type MapLoadStatus = (typeof MapLoadStatus)[keyof typeof MapLoadStatus];

export interface OutlineMapFeatures {
  status: MapLoadStatus;
  features: OutlineFeature[];
  message: string | null;
  retry: () => void;
}

export type FetchOutlines<Item> = (items: Item[]) => Promise<OutlineFeature[]>;

type ItemFeature = Omit<OutlineFeature, "itemIndex">;

const FALLBACK_ERROR = "No se pudieron cargar las geometrías del mapa.";

const cacheKeyOf = <Item>(scope: string, item: Item): string => `${scope}#${JSON.stringify(item)}`;

const messageOf = (error: unknown): string => (error instanceof Error && error.message !== "" ? error.message : FALLBACK_ERROR);

/** The features of each requested item, keyed by that item: the server numbers the features by request item. */
function featuresByItem<Item>(
  scope: string,
  items: readonly Item[],
  features: readonly OutlineFeature[]
): Record<string, ItemFeature[]> {
  return Object.fromEntries(
    items.map((item, index) => [
      cacheKeyOf(scope, item),
      features.filter((feature) => feature.itemIndex === index).map(({ role, label, geometry }) => ({ role, label, geometry })),
    ])
  );
}

/**
 * The outlines of one subject, fetched lazily. Only the items not cached yet are requested, one request per change of the
 * missing items. `scope` names what the cache holds (another database or table never reuses an outline); `fetchOutlines` is
 * read through a ref, so a re-render with a new function identity starts no second request.
 */
export function useOutlineMapFeatures<Item>(
  items: readonly Item[],
  scope: string,
  fetchOutlines: FetchOutlines<Item>
): OutlineMapFeatures {
  const [cache, setCache] = useState<Record<string, ItemFeature[]>>({});
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const fetchRef = useRef(fetchOutlines);
  const requestKey = `${scope}${JSON.stringify(items)}`;
  const missingKey = JSON.stringify(items.filter((item) => cache[cacheKeyOf(scope, item)] === undefined));

  useEffect(() => {
    fetchRef.current = fetchOutlines;
  }, [fetchOutlines]);

  useEffect(() => {
    if (missingKey === "[]") return;
    const requested = JSON.parse(missingKey) as Item[];
    fetchRef
      .current(requested)
      .then((features) => {
        setCache((previous) => ({ ...previous, ...featuresByItem(scope, requested, features) }));
      })
      .catch((error: unknown) => {
        setFailure({ key: requestKey, message: messageOf(error) });
      });
    // The request depends on the scope and the missing items; `attempt` lets a retry re-run it.
  }, [missingKey, requestKey, scope, attempt]);

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
