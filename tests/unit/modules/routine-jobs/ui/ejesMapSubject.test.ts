import { describe, expect, it } from "vitest";
import { EJES_MAP_ITEMS_LIMIT } from "@/modules/routine-jobs/jobs/ejes-calles/domain/geometryMap";
import type { EjesMergeRow, EjesSplitRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import {
  EJES_SUBJECT_TITLE,
  subjectOfMerge,
  subjectOfSplit,
  truncationNoteOf,
} from "@/modules/routine-jobs/ui/ejesMapSubject";

const SPLIT: EjesSplitRow = {
  oldRef: "1001634",
  idcalle: "72006",
  newRefs: ["1035386", "1035387", "1035390"],
  points: 1,
  coverage: 1,
  oldLength: 1087.8,
  newLength: 1120.5,
  outsideLength: 32.7,
};

const MERGE: EjesMergeRow = {
  newRef: "1022112",
  idcalle: "63837",
  oldRefs: ["947815", "947816"],
  points: 0,
  coverage: 1,
  oldLength: 80,
  newLength: 80,
  outsideLength: 0,
};

const refsOf = (count: number): string[] => Array.from({ length: count }, (_, index) => String(2_000_000 + index));

describe("subjectOfSplit", () => {
  it("should request the old section first and then each new section", () => {
    const subject = subjectOfSplit(SPLIT);

    expect(subject.title).toBe(EJES_SUBJECT_TITLE.SPLIT);
    expect(subject.items).toEqual([{ oldRef: 1001634 }, { newRef: "1035386" }, { newRef: "1035387" }, { newRef: "1035390" }]);
  });

  it("should label each outline by its reftramo and whether it is the old or the new section", () => {
    const outlines = subjectOfSplit(SPLIT).outlines;

    expect(outlines.map((outline) => outline.label)).toEqual([
      "1001634 · anterior",
      "1035386 · nuevo",
      "1035387 · nuevo",
      "1035390 · nuevo",
    ]);
    expect(outlines.map((outline) => outline.role)).toEqual(["old", "new", "new", "new"]);
  });

  it("should keep the facts of the row", () => {
    expect(subjectOfSplit(SPLIT).facts).toEqual({
      idcalle: "72006",
      points: 1,
      coverage: 1,
      oldLength: 1087.8,
      newLength: 1120.5,
      outsideLength: 32.7,
    });
  });

  it("should keep the items and the outlines parallel", () => {
    const subject = subjectOfSplit(SPLIT);

    expect(subject.items).toHaveLength(subject.outlines.length);
  });
});

describe("subjectOfMerge", () => {
  it("should request the new section first and then each old section it replaces", () => {
    const subject = subjectOfMerge(MERGE);

    expect(subject.title).toBe(EJES_SUBJECT_TITLE.MERGE);
    expect(subject.items).toEqual([{ newRef: "1022112" }, { oldRef: 947815 }, { oldRef: 947816 }]);
    expect(subject.outlines.map((outline) => outline.role)).toEqual(["new", "old", "old"]);
  });
});

describe("request limit", () => {
  it("should show every outline and no note when the row fits in one request", () => {
    const subject = subjectOfSplit({ ...SPLIT, newRefs: refsOf(EJES_MAP_ITEMS_LIMIT - 1) });

    expect(subject.items).toHaveLength(EJES_MAP_ITEMS_LIMIT);
    expect(subject.total).toBe(EJES_MAP_ITEMS_LIMIT);
    expect(truncationNoteOf(subject)).toBeNull();
  });

  it("should cut a split at 30 outlines, keep the old section and say how many were cut", () => {
    const subject = subjectOfSplit({ ...SPLIT, newRefs: refsOf(40) });

    expect(subject.items).toHaveLength(EJES_MAP_ITEMS_LIMIT);
    expect(subject.items[0]).toEqual({ oldRef: 1001634 });
    expect(subject.total).toBe(41);
    expect(truncationNoteOf(subject)).toBe("Se muestran 30 de 41 tramos.");
  });

  it("should cut a merge at 30 outlines and keep the new section", () => {
    const subject = subjectOfMerge({ ...MERGE, oldRefs: refsOf(35) });

    expect(subject.items).toHaveLength(EJES_MAP_ITEMS_LIMIT);
    expect(subject.items[0]).toEqual({ newRef: "1022112" });
    expect(subject.outlines).toHaveLength(EJES_MAP_ITEMS_LIMIT);
    expect(truncationNoteOf(subject)).toBe("Se muestran 30 de 36 tramos.");
  });
});
