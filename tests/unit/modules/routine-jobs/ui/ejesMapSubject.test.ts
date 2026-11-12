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

const COPIES = [
  { newRef: "1035386", locality: "FLORES RURAL" },
  { newRef: "1035386", locality: "TRINIDAD" },
];

const TWIN: EjesTwinRow = {
  ref: "1035386",
  idcalle: "72006",
  department: "FLORES",
  localities: ["FLORES RURAL", "TRINIDAD"],
  class: "BOTH",
  length: 250.25,
  urbanLength: 120.5,
  ruralLength: 30,
  dropLocalities: [],
};

describe("subjectOfTwin (ET-8)", () => {
  it("should list the urban zone, then the rural zone, then one entry per copy so the copies are drawn on top", () => {
    const subject = subjectOfTwin(TWIN);

    expect(subject.title).toBe(EJES_SUBJECT_TITLE.TWIN);
    expect(subject.title).toBe("Tramo repetido por localidad");
    expect(subject.items).toEqual([
      { zoneOf: "1035386", type: "URBANO" },
      { zoneOf: "1035386", type: "RURAL" },
      { newRef: "1035386", locality: "FLORES RURAL" },
      { newRef: "1035386", locality: "TRINIDAD" },
    ]);
    expect(subject.outlines.map((outline) => outline.role)).toEqual(["zone", "zone", "new", "new"]);
  });

  it("should label the zones Padrones urbanos cercanos and Padrones rurales cercanos and each copy reftramo · locality (se queda)", () => {
    expect(subjectOfTwin(TWIN).outlines.map((outline) => outline.label)).toEqual([
      "Padrones urbanos cercanos",
      "Padrones rurales cercanos",
      "1035386 · FLORES RURAL (se queda)",
      "1035386 · TRINIDAD (se queda)",
    ]);
  });

  it("should type the zones as urban and rural zone and the copies by their decision", () => {
    expect(subjectOfTwin(TWIN).outlines.map((outline) => outline.mapType)).toEqual([
      "PADRON_ZONA_URBANA",
      "PADRON_ZONA_RURAL",
      "TRAMO_SE_QUEDA",
      "TRAMO_SE_QUEDA",
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

    expect(ruralOnly.items).toEqual([{ zoneOf: "1035386", type: "RURAL" }, ...COPIES]);
    expect(urbanOnly.items).toEqual([{ zoneOf: "1035386", type: "URBANO" }, ...COPIES]);
  });

  it("should list only the copies when no length is near, including null lengths", () => {
    const none = subjectOfTwin({ ...TWIN, class: "NEITHER", urbanLength: 0, ruralLength: 0 });
    const unknown = subjectOfTwin({ ...TWIN, class: "NEITHER", urbanLength: null, ruralLength: null });

    expect(none.items).toEqual(COPIES);
    expect(unknown.items).toEqual(COPIES);
    expect(none.outlines.map((outline) => outline.role)).toEqual(["new", "new"]);
  });

  it("should list a zone with a tiny positive length near", () => {
    expect(subjectOfTwin({ ...TWIN, urbanLength: 0.01, ruralLength: 0 }).items).toHaveLength(1 + COPIES.length);
  });

  it("should keep the items and the outlines parallel and show no cut note", () => {
    const subject = subjectOfTwin(TWIN);

    expect(subject.items).toHaveLength(subject.outlines.length);
    expect(subject.total).toBe(4);
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
      dropLocalities: [],
    });
    expect(subject.facts.idcalle).toBe("72006");
    expect(subject.facts.newLength).toBe(250.25);
  });

  it("should carry the localities to drop in the twin facts", () => {
    const subject = subjectOfTwin({ ...TWIN, class: "URBAN", ruralLength: 0, dropLocalities: ["FLORES RURAL"] });

    expect(subject.twin?.dropLocalities).toEqual(["FLORES RURAL"]);
    expect(subject.twin?.twinClass).toBe("URBAN");
  });

  it("should label a copy as se queda or se quitaría by dropLocalities", () => {
    const subject = subjectOfTwin({ ...TWIN, class: "URBAN", urbanLength: 5, ruralLength: 0, dropLocalities: ["FLORES RURAL"] });
    const copies = subject.outlines.filter((outline) => outline.role === "new");

    expect(copies.map((outline) => outline.label)).toEqual([
      "1035386 · FLORES RURAL (se quitaría)",
      "1035386 · TRINIDAD (se queda)",
    ]);
    expect(copies.map((outline) => outline.dropped)).toEqual([true, false]);
    expect(copies.map((outline) => outline.locality)).toEqual(["FLORES RURAL", "TRINIDAD"]);
  });

  it("should order the copies by locality name, not by the order the row lists them", () => {
    const subject = subjectOfTwin({ ...TWIN, localities: ["TRINIDAD", "B", "A"] });
    const copies = subject.items.filter((item) => item.locality !== undefined);

    expect(copies.map((item) => item.locality)).toEqual(["A", "B", "TRINIDAD"]);
  });

  it("should type a copy by its decision: TRAMO_SE_QUITA when dropped and TRAMO_SE_QUEDA when kept", () => {
    const subject = subjectOfTwin({ ...TWIN, class: "URBAN", ruralLength: 0, dropLocalities: ["FLORES RURAL"] });
    const copies = subject.outlines.filter((outline) => outline.role === "new");

    expect(copies.map((outline) => [outline.locality, outline.mapType])).toEqual([
      ["FLORES RURAL", "TRAMO_SE_QUITA"],
      ["TRINIDAD", "TRAMO_SE_QUEDA"],
    ]);
  });

  it("should list the dropped copies before the kept ones, each group by locality name, so the kept ones are drawn on top", () => {
    const subject = subjectOfTwin({
      ...TWIN,
      urbanLength: 0,
      ruralLength: 0,
      localities: ["D", "A", "C", "B"],
      dropLocalities: ["D", "B"],
    });

    expect(subject.items.map((item) => item.locality)).toEqual(["B", "D", "A", "C"]);
    expect(subject.outlines.map((outline) => outline.dropped)).toEqual([true, true, false, false]);
  });

  it("should keep the zones before every copy even when a copy is dropped", () => {
    const subject = subjectOfTwin({ ...TWIN, dropLocalities: ["TRINIDAD"] });

    expect(subject.outlines.map((outline) => outline.role)).toEqual(["zone", "zone", "new", "new"]);
  });

  it("should keep every copy item as {newRef, locality} with 32 localities, cutting at 30 with the note", () => {
    const localities = Array.from({ length: 32 }, (_, index) => `LOC ${String(index).padStart(2, "0")}`);
    const subject = subjectOfTwin({ ...TWIN, urbanLength: 0, ruralLength: 0, localities });

    expect(subject.items).toHaveLength(EJES_MAP_ITEMS_LIMIT);
    expect(subject.total).toBe(32);
    expect(truncationNoteOf(subject)).toBe("Se muestran 30 de 32 tramos.");
    expect(subject.items.every((item) => Object.keys(item).sort().join() === "locality,newRef")).toBe(true);
  });

  it("should cut the whole subject, zones plus copies, at 30 entries and say how many were cut", () => {
    const localities = Array.from({ length: 35 }, (_, index) => `LOC ${String(index).padStart(2, "0")}`);
    const subject = subjectOfTwin({ ...TWIN, localities });

    expect(subject.items).toHaveLength(EJES_MAP_ITEMS_LIMIT);
    expect(subject.outlines).toHaveLength(EJES_MAP_ITEMS_LIMIT);
    expect(subject.total).toBe(37);
    expect(truncationNoteOf(subject)).toBe("Se muestran 30 de 37 tramos.");
    expect(subject.items.slice(0, 2)).toEqual([
      { zoneOf: "1035386", type: "URBANO" },
      { zoneOf: "1035386", type: "RURAL" },
    ]);
  });

  it("should give every copy item a locality and the same reftramo", () => {
    const copies = subjectOfTwin(TWIN).items.filter((item) => item.newRef !== undefined);

    expect(copies.every((item) => item.newRef === "1035386" && typeof item.locality === "string")).toBe(true);
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
