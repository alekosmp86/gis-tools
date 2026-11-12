import { describe, expect, it } from "vitest";
import { ANALYSIS_LIST_ALIAS } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { toEjesAnalysis, toEjesStagingReport } from "@/modules/routine-jobs/jobs/ejes-calles/domain/reportMapping";

describe("toEjesStagingReport", () => {
  it("should map counts and unknown value lists", () => {
    const report = toEjesStagingReport({
      rows: "10",
      distinct_refs: 9,
      repeated_groups: 1,
      repeated_rows: 2,
      non_integer_refs: 0,
      empty_geometry: 3,
      empty_idcalle: 4,
      damaged_text_rows: 8,
      unknown_tipo_rows: 5,
      unknown_fuente_rows: 6,
      unknown_tipos: [{ value: "X", rows: "5" }],
      unknown_fuentes: [{ value: null, rows: 6 }],
    });

    expect(report).toMatchObject({
      rows: 10,
      distinctRefs: 9,
      repeatedGroups: 1,
      repeatedRows: 2,
      emptyGeometry: 3,
      emptyIdcalle: 4,
      damagedTextRows: 8,
    });
    expect(report.unknownTipos).toEqual([{ value: "X", rows: 5 }]);
    expect(report.unknownFuentes).toEqual([{ value: null, rows: 6 }]);
  });

  it("should default to zeros and empty lists for an empty row", () => {
    const report = toEjesStagingReport({});

    expect(report.rows).toBe(0);
    expect(report.damagedTextRows).toBe(0);
    expect(report.unknownTipos).toEqual([]);
    expect(report.unknownFuentes).toEqual([]);
  });
});

describe("toEjesAnalysis", () => {
  it("should map counts, cloc report and all lists", () => {
    const analysis = toEjesAnalysis({
      new_sections: "3",
      unchanged: 7,
      attr: 1,
      geom: 2,
      both: 1,
      removed: 4,
      splits: 1,
      merges: 1,
      plain_removals: 2,
      plain_held: 1,
      new_streets: 1,
      with_locality: 2,
      only_department: 1,
      without_code: 0,
      [ANALYSIS_LIST_ALIAS.SPLITS]: [{ old_ref: 10, idcalle: "5", new_refs: ["11", "12"], points: "3", coverage: 0.98, old_length: 100.5, new_length: "130", outside_length: 29.5 }],
      [ANALYSIS_LIST_ALIAS.MERGES]: [{ new_ref: "20", idcalle: "6", old_refs: ["21", "22"], points: 0, coverage: null, old_length: 80, new_length: 80, outside_length: 0 }],
      [ANALYSIS_LIST_ALIAS.PLAIN]: [{ ref: "30", idcalle: null, points: 2 }],
      [ANALYSIS_LIST_ALIAS.STREETS]: [
        {
          idcalle: "7",
          name: "Rivera",
          sections: 2,
          tipos: "CALLE",
          departments: "RIVERA",
          localities: "VICHADERO",
        },
      ],
      [ANALYSIS_LIST_ALIAS.ATTRS]: [
        {
          ref: "40",
          name: "A",
          current_name: "B",
          idcalle: "1",
          current_idcalle: "1",
          type_id: "4",
          current_type_id: "10",
          font_id: null,
          current_font_id: "1",
        },
      ],
    });

    expect(analysis.counts).toEqual({
      newSections: 3,
      unchanged: 7,
      attr: 1,
      geom: 2,
      both: 1,
      removed: 4,
      splits: 1,
      merges: 1,
      plainRemovals: 2,
      plainHeld: 1,
      newStreets: 1,
    });
    expect(analysis.cloc).toEqual({ withLocality: 2, onlyDepartment: 1, withoutCode: 0 });
    expect(analysis.splits).toEqual([{ oldRef: "10", idcalle: "5", newRefs: ["11", "12"], points: 3, coverage: 0.98, oldLength: 100.5, newLength: 130, outsideLength: 29.5 }]);
    expect(analysis.merges).toEqual([
      { newRef: "20", idcalle: "6", oldRefs: ["21", "22"], points: 0, coverage: null, oldLength: 80, newLength: 80, outsideLength: 0 },
    ]);
    expect(analysis.plainRemovals).toEqual([{ ref: "30", idcalle: null, points: 2 }]);
    expect(analysis.newStreets).toEqual([
      {
        idcalle: "7",
        name: "Rivera",
        shortName: "Rivera",
        sections: 2,
        tipos: "CALLE",
        departments: "RIVERA",
        localities: "VICHADERO",
      },
    ]);
    expect(analysis.attrChanges[0]).toMatchObject({
      ref: "40",
      name: "A",
      currentName: "B",
      typeId: 4,
      currentTypeId: 10,
      fontId: null,
      currentFontId: 1,
    });
  });

  it("should return empty lists and zero counts for an empty row", () => {
    const analysis = toEjesAnalysis({});

    expect(analysis.counts.newSections).toBe(0);
    expect(analysis.splits).toEqual([]);
    expect(analysis.merges).toEqual([]);
    expect(analysis.plainRemovals).toEqual([]);
    expect(analysis.newStreets).toEqual([]);
    expect(analysis.attrChanges).toEqual([]);
  });

  it("should ignore non-array new_refs and old_refs", () => {
    const analysis = toEjesAnalysis({
      [ANALYSIS_LIST_ALIAS.SPLITS]: [{ old_ref: "1", new_refs: "oops", points: 0 }],
      [ANALYSIS_LIST_ALIAS.MERGES]: [{ new_ref: "2", old_refs: null, points: 0 }],
    });

    expect(analysis.splits[0].newRefs).toEqual([]);
    expect(analysis.merges[0].oldRefs).toEqual([]);
  });
});
