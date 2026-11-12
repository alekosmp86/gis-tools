import { describe, expect, it } from "vitest";
import { EJES_MAP_ITEMS_LIMIT } from "@/modules/routine-jobs/jobs/ejes-calles/domain/geometryMap";
import { getDiscrepancyColor, getDiscrepancyLabel } from "@/core/constants/mapConstants";
import type { EjesMergeRow, EjesSplitRow, EjesTwinRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import {
  EJES_SUBJECT_TITLE,
  subjectOfMerge,
  subjectOfSplit,
  subjectOfTwin,
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
  it("should request the old sections first and the new section last, so it is drawn on top", () => {
    const subject = subjectOfMerge(MERGE);

    expect(subject.title).toBe(EJES_SUBJECT_TITLE.MERGE);
    expect(subject.items).toEqual([{ oldRef: 947815 }, { oldRef: 947816 }, { newRef: "1022112" }]);
    expect(subject.outlines.map((outline) => outline.role)).toEqual(["old", "old", "new"]);
  });

  it("should type the outlines as old and new sections, not as padrones", () => {
    expect(subjectOfMerge(MERGE).outlines.map((outline) => outline.mapType)).toEqual([
      "TRAMO_ANTERIOR",
      "TRAMO_ANTERIOR",
      "TRAMO_NUEVO",
    ]);
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
    expect(subject.items[EJES_MAP_ITEMS_LIMIT - 1]).toEqual({ newRef: "1022112" });
    expect(subject.outlines).toHaveLength(EJES_MAP_ITEMS_LIMIT);
    expect(truncationNoteOf(subject)).toBe("Se muestran 30 de 36 tramos.");
  });
});

const TWIN: EjesTwinRow = {
  ref: "1035386",
  idcalle: "72006",
  department: "FLORES",
  localities: ["FLORES RURAL", "TRINIDAD"],
  class: "BOTH",
  length: 250.25,
  urbanLength: 120.5,
  ruralLength: 30,
};

describe("subjectOfTwin (ET-8)", () => {
  it("should list the urban zone, then the rural zone, then the section last so it is drawn on top", () => {
    const subject = subjectOfTwin(TWIN);

    expect(subject.title).toBe(EJES_SUBJECT_TITLE.TWIN);
    expect(subject.title).toBe("Tramo repetido por localidad");
    expect(subject.items).toEqual([
      { zoneOf: "1035386", type: "URBANO" },
      { zoneOf: "1035386", type: "RURAL" },
      { newRef: "1035386" },
    ]);
    expect(subject.outlines.map((outline) => outline.role)).toEqual(["zone", "zone", "new"]);
  });

  it("should label the zones Padrones urbanos cercanos and Padrones rurales cercanos and the section reftramo · nuevo", () => {
    expect(subjectOfTwin(TWIN).outlines.map((outline) => outline.label)).toEqual([
      "Padrones urbanos cercanos",
      "Padrones rurales cercanos",
      "1035386 · nuevo",
    ]);
  });

  it("should type the zones as urban and rural zone and the section as the new section", () => {
    expect(subjectOfTwin(TWIN).outlines.map((outline) => outline.mapType)).toEqual([
      "PADRON_ZONA_URBANA",
      "PADRON_ZONA_RURAL",
      "TRAMO_NUEVO",
    ]);
  });

  it("should give the zones and the section colours distinct from each other and from the old section", () => {
    const colours = ["PADRON_ZONA_URBANA", "PADRON_ZONA_RURAL", "TRAMO_NUEVO", "TRAMO_ANTERIOR"].map((type) => getDiscrepancyColor(type));

    expect(new Set(colours).size).toBe(4);
    expect(getDiscrepancyLabel("PADRON_ZONA_URBANA")).toBe("Padrones urbanos cercanos");
    expect(getDiscrepancyLabel("PADRON_ZONA_RURAL")).toBe("Padrones rurales cercanos");
  });

  it("should list a zone only when its length near is greater than zero", () => {
    const ruralOnly = subjectOfTwin({ ...TWIN, class: "RURAL", urbanLength: 0 });
    const urbanOnly = subjectOfTwin({ ...TWIN, class: "URBAN", ruralLength: 0 });

    expect(ruralOnly.items).toEqual([{ zoneOf: "1035386", type: "RURAL" }, { newRef: "1035386" }]);
    expect(urbanOnly.items).toEqual([{ zoneOf: "1035386", type: "URBANO" }, { newRef: "1035386" }]);
  });

  it("should list only the section when no length is near, including null lengths", () => {
    const none = subjectOfTwin({ ...TWIN, class: "NEITHER", urbanLength: 0, ruralLength: 0 });
    const unknown = subjectOfTwin({ ...TWIN, class: "NEITHER", urbanLength: null, ruralLength: null });

    expect(none.items).toEqual([{ newRef: "1035386" }]);
    expect(unknown.items).toEqual([{ newRef: "1035386" }]);
    expect(none.outlines.map((outline) => outline.role)).toEqual(["new"]);
  });

  it("should list a zone with a tiny positive length near", () => {
    expect(subjectOfTwin({ ...TWIN, urbanLength: 0.01, ruralLength: 0 }).items).toHaveLength(2);
  });

  it("should keep the items and the outlines parallel and show no cut note", () => {
    const subject = subjectOfTwin(TWIN);

    expect(subject.items).toHaveLength(subject.outlines.length);
    expect(subject.total).toBe(3);
    expect(truncationNoteOf(subject)).toBeNull();
  });

  it("should carry the twin facts and the idcalle and section length in the row facts", () => {
    const subject = subjectOfTwin(TWIN);

    expect(subject.twin).toEqual({
      department: "FLORES",
      localities: ["FLORES RURAL", "TRINIDAD"],
      twinClass: "BOTH",
      length: 250.25,
      urbanLength: 120.5,
      ruralLength: 30,
    });
    expect(subject.facts.idcalle).toBe("72006");
    expect(subject.facts.newLength).toBe(250.25);
  });

  it("should leave split and merge subjects without twin facts", () => {
    expect(subjectOfSplit(SPLIT).twin).toBeUndefined();
    expect(subjectOfMerge(MERGE).twin).toBeUndefined();
  });

  it("should not put a zone item into a split or a merge", () => {
    const items = [...subjectOfSplit(SPLIT).items, ...subjectOfMerge(MERGE).items];

    expect(items.some((item) => "zoneOf" in item)).toBe(false);
  });
});
