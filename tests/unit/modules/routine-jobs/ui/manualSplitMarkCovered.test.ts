import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EjesMapCandidate, EjesMapFeature, EjesMapNeighbour, EjesRemovalRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import type { EjesGeometryMapBase } from "@/modules/routine-jobs/ui/shared/clientTypes";
import { MapLoadStatus } from "@/modules/routine-jobs/ui/shared/map/useOutlineMapFeatures";
import type { ManualCandidatesMap } from "@/modules/routine-jobs/ui/ejes-calles/manualSplit/useManualCandidates";
import { ManualNeighbourList } from "@/modules/routine-jobs/ui/ejes-calles/manualSplit/ManualNeighbourList";
import { ManualSplitContent, type ManualSplitContentProps } from "@/modules/routine-jobs/ui/ejes-calles/manualSplit/ManualSplitContent";
import { ManualSplitFooter } from "@/modules/routine-jobs/ui/ejes-calles/manualSplit/ManualSplitFooter";

/** The react state hooks of the content, replaced by a slot-based runtime: no DOM lib is installed, so the element tree is read directly. */
const runtime = vi.hoisted(() => {
  const slots: unknown[] = [];
  const depSlots: Array<readonly unknown[] | undefined> = [];
  let index = 0;
  let dirty = false;
  const sameDeps = (left: readonly unknown[] | undefined, right: readonly unknown[]): boolean =>
    left !== undefined && left.length === right.length && left.every((value, position) => Object.is(value, right[position]));
  return {
    reset() {
      slots.length = 0;
      depSlots.length = 0;
      index = 0;
      dirty = false;
    },
    begin() {
      index = 0;
    },
    takeDirty(): boolean {
      const was = dirty;
      dirty = false;
      return was;
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
    useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
      const slot = index++;
      if (!sameDeps(depSlots[slot], deps)) {
        slots[slot] = factory();
        depSlots[slot] = deps;
      }
      return slots[slot] as T;
    },
  };
});

const state = vi.hoisted(() => ({ map: null as unknown as ManualCandidatesMap }));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: runtime.useState,
  useMemo: runtime.useMemo,
}));

vi.mock("@/modules/routine-jobs/ui/ejes-calles/manualSplit/useManualCandidates", () => ({
  useManualCandidates: () => state.map,
}));

vi.mock("@/modules/routine-jobs/ui/ejes-calles/manualSplit/ManualSplitMap", () => ({
  ManualSplitMap: () => null,
}));

vi.mock("@/modules/routine-jobs/ui/shared/map/OutlineMapBody", () => ({
  OutlineMapBody: () => null,
}));

const ROW = { ref: "6900", idcalle: "14", points: 2 } as unknown as EjesRemovalRow;
const BASE = { connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "pw" }, tables: {} } as unknown as EjesGeometryMapBase;

const OLD_FEATURE: EjesMapFeature = {
  itemIndex: 0,
  role: "old",
  label: "6900",
  geometry: { type: "LineString", coordinates: [[-56.1, -34.9], [-56.0, -34.9]] },
};

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

const mapWith = (neighbours: EjesMapNeighbour[]): ManualCandidatesMap => ({
  status: MapLoadStatus.READY,
  features: [OLD_FEATURE],
  candidates: [CANDIDATE],
  neighbours,
  dataKey: "k",
  refreshing: false,
  message: null,
  retry: () => undefined,
});

interface ContentSetup {
  neighbours: EjesMapNeighbour[];
  storedMergeRefs: string[];
}

const propsOf = (setup: ContentSetup, onApplyMerge = vi.fn(), onApply = vi.fn()): ManualSplitContentProps => {
  state.map = mapWith(setup.neighbours);
  return {
    row: ROW,
    base: BASE,
    storedRefs: ["6001"],
    storedMergeRefs: setup.storedMergeRefs,
    ignored: false,
    onApply,
    onApplyMerge,
    onIgnore: () => undefined,
  };
};

/** The content rendered with the current state until stable; returns its details, where the footer and the neighbour list sit. */
function detailsOf(props: ManualSplitContentProps): React.ReactNode {
  let element!: React.ReactElement<{ renderDetails: () => React.ReactNode }>;
  for (let pass = 0; pass < 25; pass++) {
    runtime.begin();
    element = ManualSplitContent(props) as React.ReactElement<{ renderDetails: () => React.ReactNode }>;
    if (!runtime.takeDirty()) break;
  }
  return element.props.renderDetails();
}

/** The first element of `type` in a tree of rendered elements, searched through the children. */
function findElement<P>(node: React.ReactNode, type: React.ElementType): React.ReactElement<P> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement<P>(child, type);
      if (found !== null) return found;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  if (node.type === type) return node as React.ReactElement<P>;
  return findElement<P>((node.props as { children?: React.ReactNode }).children, type);
}

const footerOf = (props: ManualSplitContentProps) => {
  const footer = findElement<React.ComponentProps<typeof ManualSplitFooter>>(detailsOf(props), ManualSplitFooter);
  if (footer === null) throw new Error("the footer is not rendered");
  return footer.props;
};

const neighboursOf = (props: ManualSplitContentProps) => {
  const list = findElement<React.ComponentProps<typeof ManualNeighbourList>>(detailsOf(props), ManualNeighbourList);
  if (list === null) throw new Error("the neighbour list is not rendered");
  return list.props;
};

describe("Marcar cubiertos releases its dropped partners on apply (manual split)", () => {
  beforeEach(() => {
    runtime.reset();
  });

  it("should release a stored partner that Marcar cubiertos drops, on apply", () => {
    const onApplyMerge = vi.fn();
    const props = propsOf({ neighbours: [neighbour("7001", false), neighbour("7002", true)], storedMergeRefs: ["7001"] }, onApplyMerge);

    neighboursOf(props).onTickAll();
    footerOf(props).onApply();

    expect(onApplyMerge).toHaveBeenCalledWith(["6001"], ["6900", "7002"], ["7001"]);
  });

  it("should not release anything before the choice is applied", () => {
    const onApplyMerge = vi.fn();
    const props = propsOf({ neighbours: [neighbour("7001", false), neighbour("7002", true)], storedMergeRefs: ["7001"] }, onApplyMerge);

    neighboursOf(props).onTickAll();

    expect(onApplyMerge).not.toHaveBeenCalled();
  });

  it("should not release a partner that was never stored, even when Marcar cubiertos drops it", () => {
    const onApplyMerge = vi.fn();
    const props = propsOf({ neighbours: [neighbour("7005", false), neighbour("7002", true)], storedMergeRefs: [] }, onApplyMerge);

    neighboursOf(props).onToggle("7005");
    neighboursOf(props).onTickAll();
    footerOf(props).onApply();

    expect(onApplyMerge).toHaveBeenCalledWith(["6001"], ["6900", "7002"], []);
  });

  it("should not release a stored partner that Marcar cubiertos keeps covered", () => {
    const onApplyMerge = vi.fn();
    const props = propsOf({ neighbours: [neighbour("7002", true)], storedMergeRefs: ["7002"] }, onApplyMerge);

    neighboursOf(props).onTickAll();
    footerOf(props).onApply();

    expect(onApplyMerge).toHaveBeenCalledWith(["6001"], ["6900", "7002"], []);
  });
});
