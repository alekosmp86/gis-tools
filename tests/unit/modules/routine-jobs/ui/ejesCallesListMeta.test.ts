import { describe, expect, it } from "vitest";
import type { EjesResult } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import {
  EJES_LIST,
  EJES_LIST_INTROS,
  defaultOpenListOf,
  ejesListAnchorOf,
  stripOf,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesListMeta";
import { buildEjesReportView } from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesReportView";

type ListField =
  | "splits"
  | "merges"
  | "renumberSkipped"
  | "renumberDropped"
  | "twinUndecided"
  | "plainRemovals"
  | "keptByDiscarded"
  | "geoTwins"
  | "newStreets"
  | "attrChanges";

interface Overrides {
  counts?: Record<string, number>;
  staging?: Record<string, unknown>;
  lists?: Partial<Record<ListField, unknown[]>>;
  invalid?: unknown[];
}

const resultOf = ({ counts = {}, staging = {}, lists = {}, invalid = [] }: Overrides = {}): EjesResult =>
  ({
    dryRun: true,
    targetModified: false,
    outcomeUnknown: false,
    staging: {
      rows: 0,
      distinctRefs: 0,
      repeatedGroups: 0,
      repeatedRows: 0,
      nonIntegerRefs: 0,
      emptyGeometry: 0,
      emptyIdcalle: 0,
      damagedTextRows: 0,
      unknownTipoRows: 0,
      unknownFuenteRows: 0,
      unknownTipos: [],
      unknownFuentes: [],
      invalidGeometryRows: invalid.length,
      invalidGeometryRefs: invalid.length,
      invalidGeometries: invalid,
      ...staging,
    },
    counts: {
      newSections: 0,
      unchanged: 0,
      attr: 0,
      geom: 0,
      both: 0,
      removed: 0,
      splits: 0,
      merges: 0,
      plainRemovals: 0,
      plainHeld: 0,
      keptByDiscardedCandidate: 0,
      newStreets: 0,
      twins: 0,
      twinsUrban: 0,
      twinsRural: 0,
      twinsBoth: 0,
      twinsNeither: 0,
      twinsCrossDepartment: 0,
      twinsDrop: 0,
      twinsKeep: 0,
      twinsUndecided: 0,
      twinPicksApplied: 0,
      renumbered: 0,
      renumberedWithPoints: 0,
      renumberedPoints: 0,
      renumberedByGeometry: 0,
      renumberDroppedCandidates: 0,
      renumberSkipped: 0,
      geoTwinGroups: 0,
      geoTwinSections: 0,
      geoTwinLosersOmitted: 0,
      geoTwinLosersRemovable: 0,
      geoTwinSkippedRefs: 0,
      ...counts,
    },
    cloc: { withLocality: 0, onlyDepartment: 0, withoutCode: 0 },
    splits: [],
    merges: [],
    plainRemovals: [],
    keptByDiscarded: [],
    newStreets: [],
    attrChanges: [],
    twinUndecided: [],
    geoTwins: [],
    renumberSkipped: [],
    renumberDropped: [],
    ...lists,
    blockers: [],
    privilegeInfo: [],
    tables: {},
    stepTimings: [],
  }) as unknown as EjesResult;

const row = (n: number) => ({ ref: String(n) });

describe("stripOf", () => {
  it("should return fifteen items in the fixed order", () => {
    const strip = stripOf(resultOf());

    expect(strip).toHaveLength(15);
    expect(strip.map((item) => item.label)).toEqual([
      "Filas del archivo",
      "Calles nuevas",
      "Cambios de atributos",
      "Renumerados",
      "de ellos, eligiendo por geometría",
      "Candidatos descartados",
      "Renumerados retenidos",
      "Divididos",
      "Unidos",
      "Sin reemplazo",
      "Se conservan por candidato descartado",
      "Repetidos por localidad",
      "Varias copias sin decidir",
      "Gemelos por geometría",
      "Geometría inválida, colapsada o menor de 1 m",
    ]);
  });

  it("should map each cell to its count and list", () => {
    const strip = stripOf(
      resultOf({
        staging: { rows: 500, invalidGeometryRows: 3 },
        counts: {
          newSections: 20,
          attr: 4,
          renumbered: 5,
          renumberSkipped: 11,
          renumberDroppedCandidates: 12,
          splits: 6,
          merges: 7,
          plainRemovals: 8,
          keptByDiscardedCandidate: 3,
          twins: 9,
          twinsUndecided: 2,
          geoTwinSections: 4,
        },
      })
    );
    const byLabel = Object.fromEntries(strip.map((item) => [item.label, item]));

    expect(byLabel["Filas del archivo"]).toMatchObject({ value: 500, list: null });
    expect(byLabel["Cambios de atributos"]).toMatchObject({ value: 4, list: EJES_LIST.ATTR_CHANGES });
    expect(byLabel["Renumerados"]).toMatchObject({ value: 5, list: null });
    expect(byLabel["Renumerados retenidos"]).toMatchObject({ value: 11, list: EJES_LIST.RENUMBER_HELD });
    expect(byLabel["Candidatos descartados"]).toMatchObject({ value: 12, list: EJES_LIST.RENUMBER_DROPPED });
    expect(byLabel["Divididos"]).toMatchObject({ value: 6, list: EJES_LIST.SPLITS });
    expect(byLabel["Unidos"]).toMatchObject({ value: 7, list: EJES_LIST.MERGES });
    expect(byLabel["Sin reemplazo"]).toMatchObject({ value: 8, list: EJES_LIST.PLAIN_REMOVALS });
    expect(byLabel["Se conservan por candidato descartado"]).toMatchObject({ value: 3, list: EJES_LIST.KEPT_BY_DISCARDED });
    expect(byLabel["Repetidos por localidad"]).toMatchObject({ value: 9, list: null });
    expect(byLabel["Varias copias sin decidir"]).toMatchObject({ value: 2, list: EJES_LIST.TWIN_UNDECIDED });
    expect(byLabel["Gemelos por geometría"]).toMatchObject({ value: 4, list: EJES_LIST.GEO_TWINS });
    expect(byLabel["Geometría inválida, colapsada o menor de 1 m"]).toMatchObject({ value: 3, list: EJES_LIST.INVALID_GEOMETRIES });
  });

  it("should have no list for the count-only cells: rows, renumbered, the renumbers by geometry and the repeated-by-locality count", () => {
    const strip = stripOf(resultOf());

    expect(strip.filter((item) => item.list === null).map((item) => item.label)).toEqual([
      "Filas del archivo",
      "Renumerados",
      "de ellos, eligiendo por geometría",
      "Repetidos por localidad",
    ]);
  });

  it("should use unique keys", () => {
    const keys = stripOf(resultOf()).map((item) => item.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("should count Calles nuevas as newStreets length and link to the new streets list", () => {
    const streets = [
      { idcalle: "1", name: "A" },
      { idcalle: "2", name: "B" },
      { idcalle: "3", name: "C" },
    ];
    const result = resultOf({ counts: { newSections: 10, renumbered: 2 }, lists: { newStreets: streets } });
    const cell = stripOf(result).find((item) => item.label === "Calles nuevas");

    expect(cell).toMatchObject({ value: 3, list: EJES_LIST.NEW_STREETS });
    expect(cell?.value).toBe(result.newStreets.length);
  });

  it("should not mismatch Calles nuevas when newSections exceeds newStreets length", () => {
    const result = resultOf({ counts: { newSections: 10, renumbered: 0 }, lists: { newStreets: [{ idcalle: "1", name: "A" }] } });
    const cell = stripOf(result).find((item) => item.label === "Calles nuevas");

    expect(cell?.value).toBe(1);
    expect(cell?.list).toBe(EJES_LIST.NEW_STREETS);
  });

  it("should give zero values for an empty result", () => {
    expect(stripOf(resultOf()).every((item) => item.value === 0)).toBe(true);
  });
});

describe("defaultOpenListOf", () => {
  it("should return null when every list is empty", () => {
    expect(defaultOpenListOf(resultOf())).toBeNull();
  });

  it("should prefer the undecided copies when they have rows, even if earlier lists are non-empty", () => {
    const result = resultOf({ lists: { twinUndecided: [row(1)], splits: [row(2)], merges: [row(3)], renumberSkipped: [row(4)] } });

    expect(defaultOpenListOf(result)).toBe(EJES_LIST.TWIN_UNDECIDED);
  });

  it.each([
    ["splits", EJES_LIST.SPLITS],
    ["merges", EJES_LIST.MERGES],
    ["renumberSkipped", EJES_LIST.RENUMBER_HELD],
    ["renumberDropped", EJES_LIST.RENUMBER_DROPPED],
    ["plainRemovals", EJES_LIST.PLAIN_REMOVALS],
    ["geoTwins", EJES_LIST.GEO_TWINS],
    ["newStreets", EJES_LIST.NEW_STREETS],
    ["attrChanges", EJES_LIST.ATTR_CHANGES],
  ] as const)("should return %s when it is the only non-empty list", (field, expected) => {
    expect(defaultOpenListOf(resultOf({ lists: { [field]: [row(1)] } }))).toBe(expected);
  });

  it("should return invalid geometries when it is the only non-empty list", () => {
    expect(defaultOpenListOf(resultOf({ invalid: [row(1)] }))).toBe(EJES_LIST.INVALID_GEOMETRIES);
  });

  it("should open renumbers held back when it is the first list with rows, before plain removals", () => {
    const result = resultOf({ lists: { renumberSkipped: [row(1)], plainRemovals: [row(2)], newStreets: [row(3)] }, invalid: [row(4)] });

    expect(defaultOpenListOf(result)).toBe(EJES_LIST.RENUMBER_HELD);
  });

  it("should not open renumbers held back by default when splits or merges come before it", () => {
    expect(defaultOpenListOf(resultOf({ lists: { splits: [row(1)], renumberSkipped: [row(2)] } }))).toBe(EJES_LIST.SPLITS);
    expect(defaultOpenListOf(resultOf({ lists: { merges: [row(1)], renumberSkipped: [row(2)] } }))).toBe(EJES_LIST.MERGES);
  });

  it("should not open renumbers held back by default when the undecided copies have rows", () => {
    expect(defaultOpenListOf(resultOf({ lists: { twinUndecided: [row(1)], renumberSkipped: [row(2)] } }))).toBe(EJES_LIST.TWIN_UNDECIDED);
  });

  it("should pick the first non-empty list in order: undecided copies, divididos, unidos, retenidos, sin reemplazo, gemelos, invalid, nuevos, atributos", () => {
    const order = [
      ["twinUndecided", EJES_LIST.TWIN_UNDECIDED],
      ["splits", EJES_LIST.SPLITS],
      ["merges", EJES_LIST.MERGES],
      ["renumberSkipped", EJES_LIST.RENUMBER_HELD],
      ["plainRemovals", EJES_LIST.PLAIN_REMOVALS],
      ["geoTwins", EJES_LIST.GEO_TWINS],
    ] as const;
    let lists: Partial<Record<ListField, unknown[]>> = Object.fromEntries(order.map(([field]) => [field, [row(1)]]));

    for (const [field, expected] of order) {
      expect(defaultOpenListOf(resultOf({ lists, invalid: [row(1)] }))).toBe(expected);
      lists = Object.fromEntries(Object.entries(lists).filter(([name]) => name !== field));
    }
    expect(defaultOpenListOf(resultOf({ lists, invalid: [row(1)] }))).toBe(EJES_LIST.INVALID_GEOMETRIES);
    expect(defaultOpenListOf(resultOf({ lists: { newStreets: [row(1)], attrChanges: [row(1)] } }))).toBe(EJES_LIST.NEW_STREETS);
    expect(defaultOpenListOf(resultOf({ lists: { attrChanges: [row(1)] } }))).toBe(EJES_LIST.ATTR_CHANGES);
  });

  it("should give the held cell the count of counts.renumberSkipped, not the length of its list", () => {
    const cell = stripOf(resultOf({ counts: { renumberSkipped: 2 } })).find((item) => item.key === EJES_LIST.RENUMBER_HELD);

    expect(cell).toMatchObject({ value: 2, list: EJES_LIST.RENUMBER_HELD });
  });

  it("should ignore counts and look only at list rows", () => {
    expect(defaultOpenListOf(resultOf({ counts: { splits: 5, twinsUndecided: 5 } }))).toBeNull();
  });
});

describe("list meta constants", () => {
  it("should have an intro for every list key", () => {
    for (const key of Object.values(EJES_LIST)) expect(EJES_LIST_INTROS[key].length).toBeGreaterThan(0);
  });

  it("should build unique anchors from the key", () => {
    const anchors = Object.values(EJES_LIST).map(ejesListAnchorOf);

    expect(new Set(anchors).size).toBe(anchors.length);
    expect(ejesListAnchorOf(EJES_LIST.TWIN_UNDECIDED)).toBe("ejes-list-twinUndecided");
  });
});

describe("buildEjesReportView strip and defaultOpenList", () => {
  it("should expose the strip of the result", () => {
    const result = resultOf({ staging: { rows: 42 }, counts: { splits: 1 } });

    expect(buildEjesReportView(result).strip).toEqual(stripOf(result));
  });

  it("should expose the default open list of the result", () => {
    const withUndecided = resultOf({ lists: { twinUndecided: [row(1)], splits: [row(2)] } });
    const empty = resultOf();

    expect(buildEjesReportView(withUndecided).defaultOpenList).toBe(EJES_LIST.TWIN_UNDECIDED);
    expect(buildEjesReportView(empty).defaultOpenList).toBeNull();
  });
});
