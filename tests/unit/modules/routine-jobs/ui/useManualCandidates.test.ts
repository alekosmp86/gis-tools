import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EjesMapCandidate, EjesMapFeature, EjesMapNeighbour } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import type { EjesGeometryMapBase } from "@/modules/routine-jobs/ui/shared/clientTypes";
import { MapLoadStatus } from "@/modules/routine-jobs/ui/shared/map/useOutlineMapFeatures";
import { useManualCandidates, type ManualCandidatesMap } from "@/modules/routine-jobs/ui/ejes-calles/manualSplit/useManualCandidates";

/** No DOM/renderHook lib installed: the react hooks are replaced by a slot-based runtime that runs effects and re-renders until stable. */
const runtime = vi.hoisted(() => {
  const slots: unknown[] = [];
  const depSlots: Array<readonly unknown[] | undefined> = [];
  const cleanups: Array<(() => void) | undefined> = [];
  let index = 0;
  let dirty = false;
  let queued: Array<{ slot: number; effect: () => unknown }> = [];
  const sameDeps = (left: readonly unknown[] | undefined, right: readonly unknown[]): boolean =>
    left !== undefined && left.length === right.length && left.every((value, position) => Object.is(value, right[position]));
  const memo = <T>(factory: () => T, deps: readonly unknown[]): T => {
    const slot = index++;
    if (!sameDeps(depSlots[slot], deps)) {
      slots[slot] = factory();
      depSlots[slot] = deps;
    }
    return slots[slot] as T;
  };
  return {
    reset() {
      slots.length = 0;
      depSlots.length = 0;
      cleanups.length = 0;
      index = 0;
      dirty = false;
      queued = [];
    },
    begin() {
      index = 0;
    },
    takeDirty(): boolean {
      const was = dirty;
      dirty = false;
      return was;
    },
    takeEffects(): Array<{ slot: number; effect: () => unknown }> {
      const taken = queued;
      queued = [];
      return taken;
    },
    runEffects(effects: Array<{ slot: number; effect: () => unknown }>): void {
      for (const { slot, effect } of effects) {
        cleanups[slot]?.();
        const result = effect();
        cleanups[slot] = typeof result === "function" ? (result as () => void) : undefined;
      }
    },
    useState<T>(init: T | (() => T)) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof init === "function" ? (init as () => T)() : init;
      const set = (value: T | ((previous: T) => T)) => {
        const next = typeof value === "function" ? (value as (previous: T) => T)(slots[slot] as T) : value;
        if (!Object.is(next, slots[slot])) dirty = true;
        slots[slot] = next;
      };
      return [slots[slot] as T, set] as const;
    },
    useMemo: memo,
    useCallback<T>(callback: T, deps: readonly unknown[]): T {
      return memo(() => callback, deps);
    },
    useEffect(effect: () => unknown, deps: readonly unknown[]) {
      const slot = index++;
      if (!sameDeps(depSlots[slot], deps)) {
        depSlots[slot] = deps;
        queued.push({ slot, effect });
      }
    },
  };
});

const calls = vi.hoisted(() => ({
  requests: [] as Array<{ items: Array<{ candidatesOf: number; radius: number; otherStreets: boolean; coveredBy: string[] }> }>,
  settlers: [] as Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }>,
  fetchEjesGeometryMap: vi.fn(),
}));

vi.mock("react", () => ({
  useState: runtime.useState,
  useMemo: runtime.useMemo,
  useCallback: runtime.useCallback,
  useEffect: runtime.useEffect,
}));

vi.mock("@/modules/routine-jobs/ui/shared/routineJobsClient", () => ({
  createRoutineJobsClient: () => ({ fetchEjesGeometryMap: calls.fetchEjesGeometryMap }),
}));

const BASE = {
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "pw" },
  tables: {},
} as unknown as EjesGeometryMapBase;

const LINE = { type: "LineString" as const, coordinates: [[-56.1, -34.9], [-56.0, -34.9]] };

const FEATURE: EjesMapFeature = { itemIndex: 0, role: "old", label: "6900", geometry: LINE };

const CANDIDATE: EjesMapCandidate = {
  oldRef: "6900",
  ref: "6001",
  idcalle: "14",
  name: "CALLE",
  localities: "A",
  length: 50,
  nearLength: 40,
  coveredLength: 0,
  coveredPercent: 0,
  distance: 10,
};

const neighbour = (ref: string, covered: boolean): EjesMapNeighbour => ({ ref, idcalle: "14", length: 20, points: 1, distance: 5, covered });

interface HookArgs {
  oldRef: number;
  radius: number;
  otherStreets: boolean;
  coveredBy: string[];
}

const DEFAULT_ARGS: HookArgs = { oldRef: 6900, radius: 25, otherStreets: false, coveredBy: [] };

const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
};

/** Renders the hook with the given arguments until no state changes and no effect is left to run. */
function renderWith(args: HookArgs): ManualCandidatesMap {
  let result!: ManualCandidatesMap;
  for (let pass = 0; pass < 25; pass++) {
    runtime.begin();
    result = useManualCandidates(BASE, args.oldRef, args.radius, args.otherStreets, args.coveredBy);
    const effects = runtime.takeEffects();
    runtime.runEffects(effects);
    if (!runtime.takeDirty() && effects.length === 0) break;
  }
  return result;
}

/** Settles the pending request number `index` (0 is the first fetch) with a map of the given neighbours. */
async function settleRequest(index: number, neighbours: EjesMapNeighbour[]): Promise<void> {
  calls.settlers[index].resolve({ features: [FEATURE], candidates: [CANDIDATE], neighbours });
  await flush();
}

describe("useManualCandidates (manual split refreshing)", () => {
  beforeEach(() => {
    runtime.reset();
    calls.requests.length = 0;
    calls.settlers.length = 0;
    calls.fetchEjesGeometryMap.mockReset();
    calls.fetchEjesGeometryMap.mockImplementation(
      (request: { items: Array<{ candidatesOf: number; radius: number; otherStreets: boolean; coveredBy: string[] }> }) =>
        new Promise((resolve, reject) => {
          calls.requests.push(request);
          calls.settlers.push({ resolve, reject });
        })
    );
  });

  it("should be loading, not refreshing, until the first request settles", () => {
    const map = renderWith(DEFAULT_ARGS);

    expect(map.status).toBe(MapLoadStatus.LOADING);
    expect(map.refreshing).toBe(false);
    expect(calls.requests[0].items[0]).toEqual({ candidatesOf: 6900, radius: 25, otherStreets: false, coveredBy: [] });
  });

  it("should be ready and not refreshing once the first request settles", async () => {
    renderWith(DEFAULT_ARGS);
    await settleRequest(0, [neighbour("7002", true)]);

    const map = renderWith(DEFAULT_ARGS);

    expect(map.status).toBe(MapLoadStatus.READY);
    expect(map.refreshing).toBe(false);
    expect(map.candidates).toEqual([CANDIDATE]);
  });

  it("should be refreshing, ready and still on the previous data while only coveredBy changes", async () => {
    renderWith(DEFAULT_ARGS);
    await settleRequest(0, [neighbour("7002", false)]);

    const map = renderWith({ ...DEFAULT_ARGS, coveredBy: ["7002"] });

    expect(map.status).toBe(MapLoadStatus.READY);
    expect(map.refreshing).toBe(true);
    expect(map.candidates).toEqual([CANDIDATE]);
    expect(calls.requests[1].items[0].coveredBy).toEqual(["7002"]);
  });

  it("should stop refreshing and show the new covered flags once the coveredBy request settles", async () => {
    renderWith(DEFAULT_ARGS);
    await settleRequest(0, [neighbour("7002", false)]);
    renderWith({ ...DEFAULT_ARGS, coveredBy: ["7002"] });
    await settleRequest(1, [neighbour("7002", true)]);

    const map = renderWith({ ...DEFAULT_ARGS, coveredBy: ["7002"] });

    expect(map.refreshing).toBe(false);
    expect(map.neighbours).toEqual([neighbour("7002", true)]);
  });

  it("should not refresh when the radius changes: the map is loading again", async () => {
    renderWith(DEFAULT_ARGS);
    await settleRequest(0, [neighbour("7002", false)]);

    const map = renderWith({ ...DEFAULT_ARGS, radius: 50 });

    expect(map.status).toBe(MapLoadStatus.LOADING);
    expect(map.refreshing).toBe(false);
  });

  it("should not refresh when the old section changes: the map is loading again", async () => {
    renderWith(DEFAULT_ARGS);
    await settleRequest(0, [neighbour("7002", false)]);

    const map = renderWith({ ...DEFAULT_ARGS, oldRef: 7000, coveredBy: ["7002"] });

    expect(map.status).toBe(MapLoadStatus.LOADING);
    expect(map.refreshing).toBe(false);
  });

  it("should not send a new request when the same coveredBy arrives in another order", async () => {
    renderWith({ ...DEFAULT_ARGS, coveredBy: ["7002", "7003"] });
    await settleRequest(0, [neighbour("7002", true)]);

    const map = renderWith({ ...DEFAULT_ARGS, coveredBy: ["7003", "7002"] });

    expect(calls.requests).toHaveLength(1);
    expect(map.refreshing).toBe(false);
  });

  it("should report the failure message and no data when the request fails", async () => {
    renderWith(DEFAULT_ARGS);
    calls.settlers[0].reject(new Error("La conexión se cortó."));
    await flush();

    const map = renderWith(DEFAULT_ARGS);

    expect(map.status).toBe(MapLoadStatus.ERROR);
    expect(map.message).toBe("La conexión se cortó.");
    expect(map.refreshing).toBe(false);
  });
});
