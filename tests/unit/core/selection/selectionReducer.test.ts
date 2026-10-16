import { describe, it, expect } from "vitest";
import {
  EMPTY_SELECTION,
  clearSelection,
  countSelectedIn,
  deselectMany,
  pruneTo,
  resolveCheckState,
  selectMany,
  toggleSelection,
} from "@/core/selection/selectionReducer";
import { DEFAULT_SELECT_ALL } from "@/core/selection/selectionDefaults";
import { SelectionCheckState } from "@/core/types/selection";

const set = (...ids: string[]) => new Set(ids);

describe("selectionDefaults", () => {
  it("should default to selecting everything selectable", () => {
    expect(DEFAULT_SELECT_ALL).toBe(true);
  });
});

describe("toggleSelection", () => {
  it("should add an id that is not selected", () => {
    const current = set("a");
    const next = toggleSelection(current, "b");
    expect([...next].sort()).toEqual(["a", "b"]);
  });

  it("should remove an id that is selected", () => {
    const next = toggleSelection(set("a", "b"), "a");
    expect([...next]).toEqual(["b"]);
  });

  it("should not mutate the input set", () => {
    const current = set("a");
    toggleSelection(current, "b");
    toggleSelection(current, "a");
    expect([...current]).toEqual(["a"]);
  });

  it("should always return a new reference", () => {
    const current = set("a");
    expect(toggleSelection(current, "a")).not.toBe(current);
    expect(toggleSelection(current, "z")).not.toBe(current);
  });

  it("should add to an empty selection", () => {
    expect([...toggleSelection(EMPTY_SELECTION, "x")]).toEqual(["x"]);
  });
});

describe("selectMany", () => {
  it("should add all new ids", () => {
    const next = selectMany(set("a"), ["b", "c"]);
    expect([...next].sort()).toEqual(["a", "b", "c"]);
  });

  it("should return the same reference when every id is already selected", () => {
    const current = set("a", "b");
    expect(selectMany(current, ["a", "b"])).toBe(current);
  });

  it("should return the same reference for an empty id list", () => {
    const current = set("a");
    expect(selectMany(current, [])).toBe(current);
  });

  it("should return a new set when only some ids are new", () => {
    const current = set("a");
    const next = selectMany(current, ["a", "b"]);
    expect(next).not.toBe(current);
    expect(next.has("b")).toBe(true);
    expect(current.has("b")).toBe(false);
  });

  it("should tolerate duplicate ids in the input", () => {
    const next = selectMany(EMPTY_SELECTION, ["a", "a", "a"]);
    expect(next.size).toBe(1);
  });
});

describe("deselectMany", () => {
  it("should remove the given ids", () => {
    const next = deselectMany(set("a", "b", "c"), ["a", "c"]);
    expect([...next]).toEqual(["b"]);
  });

  it("should return the same reference when none of the ids are selected", () => {
    const current = set("a");
    expect(deselectMany(current, ["x", "y"])).toBe(current);
  });

  it("should return the same reference for an empty id list", () => {
    const current = set("a");
    expect(deselectMany(current, [])).toBe(current);
  });

  it("should not mutate the input set", () => {
    const current = set("a", "b");
    deselectMany(current, ["a"]);
    expect(current.size).toBe(2);
  });

  it("should ignore unselected ids mixed with selected ones", () => {
    const next = deselectMany(set("a", "b"), ["a", "zzz"]);
    expect([...next]).toEqual(["b"]);
  });
});

describe("clearSelection", () => {
  it("should return the same reference when already empty", () => {
    const empty = set();
    expect(clearSelection(empty)).toBe(empty);
    expect(clearSelection(EMPTY_SELECTION)).toBe(EMPTY_SELECTION);
  });

  it("should return the shared EMPTY_SELECTION when non-empty", () => {
    expect(clearSelection(set("a"))).toBe(EMPTY_SELECTION);
  });
});

describe("pruneTo", () => {
  it("should drop ids that are not allowed", () => {
    const next = pruneTo(set("a", "b", "c"), set("a", "c", "d"));
    expect([...next].sort()).toEqual(["a", "c"]);
  });

  it("should return the same reference when every id is allowed", () => {
    const current = set("a", "b");
    expect(pruneTo(current, set("a", "b", "c"))).toBe(current);
  });

  it("should return the same reference for an empty selection", () => {
    const current = set();
    expect(pruneTo(current, set("a"))).toBe(current);
  });

  it("should return an empty set when nothing is allowed", () => {
    const next = pruneTo(set("a", "b"), set());
    expect(next.size).toBe(0);
  });
});

describe("countSelectedIn", () => {
  it("should count only ids that are selected", () => {
    expect(countSelectedIn(set("a", "c"), ["a", "b", "c", "d"])).toBe(2);
  });

  it("should return 0 for an empty id list", () => {
    expect(countSelectedIn(set("a"), [])).toBe(0);
  });

  it("should return 0 for an empty selection", () => {
    expect(countSelectedIn(EMPTY_SELECTION, ["a", "b"])).toBe(0);
  });
});

describe("resolveCheckState", () => {
  it("should be NONE when nothing is selected", () => {
    expect(resolveCheckState(0, 10)).toBe(SelectionCheckState.NONE);
  });

  it("should be NONE when total is 0, even with a selected count", () => {
    expect(resolveCheckState(0, 0)).toBe(SelectionCheckState.NONE);
    expect(resolveCheckState(3, 0)).toBe(SelectionCheckState.NONE);
  });

  it("should be SOME for 1 of many", () => {
    expect(resolveCheckState(1, 10)).toBe(SelectionCheckState.SOME);
  });

  it("should be SOME for all-but-one", () => {
    expect(resolveCheckState(9, 10)).toBe(SelectionCheckState.SOME);
  });

  it("should be ALL when selected equals total", () => {
    expect(resolveCheckState(10, 10)).toBe(SelectionCheckState.ALL);
    expect(resolveCheckState(1, 1)).toBe(SelectionCheckState.ALL);
  });

  it("should be ALL when selected exceeds total", () => {
    expect(resolveCheckState(11, 10)).toBe(SelectionCheckState.ALL);
  });
});

describe("large selections", () => {
  const ids = Array.from({ length: 100_000 }, (_, i) => `id-${i}`);

  it("should select, count, deselect and prune 100k ids correctly", () => {
    const all = selectMany(EMPTY_SELECTION, ids);
    expect(all.size).toBe(100_000);
    expect(countSelectedIn(all, ids)).toBe(100_000);
    expect(resolveCheckState(countSelectedIn(all, ids), ids.length)).toBe(SelectionCheckState.ALL);

    const half = deselectMany(all, ids.slice(0, 50_000));
    expect(half.size).toBe(50_000);
    expect(resolveCheckState(half.size, ids.length)).toBe(SelectionCheckState.SOME);

    const pruned = pruneTo(all, new Set(ids.slice(0, 10)));
    expect(pruned.size).toBe(10);

    expect(selectMany(all, ids)).toBe(all);
    expect(clearSelection(all)).toBe(EMPTY_SELECTION);
  });
});
