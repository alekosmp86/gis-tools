import { useCallback, useEffect, useRef, useState } from "react";
import { SPLIT_POINTS_PAGE_LIMIT, SPLIT_REVIEW_GONE_MESSAGE } from "../../../jobs/ejes-calles/constants";
import type { EjesSplitPointsPage } from "../../../jobs/ejes-calles/types";
import type { EjesSplitPointsBase } from "../../shared/clientTypes";
import { createRoutineJobsClient } from "../../shared/routineJobsClient";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";

const client = createRoutineJobsClient();

export const SplitPointsStatus = {
  LOADING: "LOADING",
  READY: "READY",
  ERROR: "ERROR",
} as const;

export type SplitPointsStatus = (typeof SplitPointsStatus)[keyof typeof SplitPointsStatus];

export interface SplitPointsLoad {
  status: SplitPointsStatus;
  page: EjesSplitPointsPage | null;
  message: string | null;
  retry: () => void;
}

/** Reads every page of the review points of one split: the next page starts where the loaded points end. */
async function readAllPoints(
  base: EjesSplitPointsBase,
  oldRef: string,
  collected: EjesSplitPointsPage | null = null
): Promise<EjesSplitPointsPage> {
  const offset = collected === null ? 0 : collected.points.length;
  const page = await client.fetchEjesSplitPoints({ ...base, oldRef, offset, limit: SPLIT_POINTS_PAGE_LIMIT });
  const merged: EjesSplitPointsPage =
    collected === null ? page : { ...collected, total: page.total, points: [...collected.points, ...page.points] };
  const complete = page.points.length === 0 || merged.points.length >= page.total;
  return complete ? merged : readAllPoints(base, oldRef, merged);
}

const messageOf = (error: unknown): string => {
  if (!(error instanceof Error) || error.message === "") return EJES_SPLIT_REVIEW_TEXT.LOAD_FAILED;
  return error.message === SPLIT_REVIEW_GONE_MESSAGE ? EJES_SPLIT_REVIEW_TEXT.ANALYSIS_CHANGED : error.message;
};

/**
 * The review points of one split, all loaded. The base is read through a ref, so a new object with the same connection starts no
 * second read; `oldRef` and the base's key decide when the points are read again, and `retry` reads them again.
 */
export function useEjesSplitPoints(oldRef: string | null, base: EjesSplitPointsBase | null, baseKey: string): SplitPointsLoad {
  const [load, setLoad] = useState<{ status: SplitPointsStatus; page: EjesSplitPointsPage | null; message: string | null }>({
    status: SplitPointsStatus.LOADING,
    page: null,
    message: null,
  });
  const [attempt, setAttempt] = useState<number>(0);
  const baseRef = useRef<EjesSplitPointsBase | null>(base);

  useEffect(() => {
    baseRef.current = base;
  }, [base]);

  useEffect(() => {
    const current = baseRef.current;
    if (oldRef === null || current === null) return;
    let cancelled = false;
    setLoad({ status: SplitPointsStatus.LOADING, page: null, message: null });
    readAllPoints(current, oldRef)
      .then((page) => {
        if (!cancelled) setLoad({ status: SplitPointsStatus.READY, page, message: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ status: SplitPointsStatus.ERROR, page: null, message: messageOf(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [oldRef, baseKey, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return { ...load, retry };
}
