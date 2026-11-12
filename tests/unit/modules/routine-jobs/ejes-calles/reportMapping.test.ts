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

  it("should map the invalid geometry counts and rows as text (ET-18)", () => {
    const report = toEjesStagingReport({
      invalid_geometry_rows: "795",
      invalid_geometry_refs: 615,
      invalid_geometries: [{ ref: 12, idcalle: "5", localidad: "TRINIDAD", departamento: "FLORES" }],
    });

    expect(report.invalidGeometryRows).toBe(795);
    expect(report.invalidGeometryRefs).toBe(615);
    expect(report.invalidGeometries).toEqual([{ ref: "12", idcalle: "5", localidad: "TRINIDAD", departamento: "FLORES" }]);
  });

  it("should map null locality, department and idcalle of an invalid row to null", () => {
    const report = toEjesStagingReport({ invalid_geometries: [{ ref: "1", idcalle: null, localidad: null, departamento: null }] });

    expect(report.invalidGeometries).toEqual([{ ref: "1", idcalle: null, localidad: null, departamento: null }]);
  });

  it.each([[null], [undefined], ["oops"], [{}], [5]])("should map invalid_geometries %j to an empty list", (value) => {
    expect(toEjesStagingReport({ invalid_geometries: value }).invalidGeometries).toEqual([]);
  });

  it("should keep the raw counts as they are when invalid rows are reported", () => {
    const report = toEjesStagingReport({ rows: 7, distinct_refs: 5, repeated_groups: 2, invalid_geometry_rows: 3 });

    expect(report).toMatchObject({ rows: 7, distinctRefs: 5, repeatedGroups: 2, invalidGeometryRows: 3 });
  });

  it("should default to zeros and empty lists for an empty row", () => {
    const report = toEjesStagingReport({});

    expect(report.rows).toBe(0);
    expect(report.damagedTextRows).toBe(0);
    expect(report.invalidGeometryRows).toBe(0);
    expect(report.invalidGeometryRefs).toBe(0);
    expect(report.invalidGeometries).toEqual([]);
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
      twins: "6",
      twins_urban: 1,
      twins_rural: 2,
      twins_both: 3,
      twins_neither: "4",
      twins_cross_department: 5,
      twins_drop: "2",
      twins_keep: 4,
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
      twins: 6,
      twinsUrban: 1,
      twinsRural: 2,
      twinsBoth: 3,
      twinsNeither: 4,
      twinsCrossDepartment: 5,
      twinsDrop: 2,
      twinsKeep: 4,
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
    expect(analysis.twins).toEqual([]);
    expect(analysis.counts.twins).toBe(0);
    expect(analysis.counts.twinsCrossDepartment).toBe(0);
    expect(analysis.counts.twinsDrop).toBe(0);
    expect(analysis.counts.twinsKeep).toBe(0);
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

describe("toEjesAnalysis twins (ET-4)", () => {
  const twinRow = {
    ref: 1035386,
    idcalle: "72006",
    department: "FLORES",
    localities: ["FLORES RURAL", "TRINIDAD"],
    class: "BOTH",
    length: "250.25",
    urban_length: 120.5,
    rural_length: "30",
    drop_localities: ["FLORES RURAL"],
  };

  it("should map a twin row with its reftramo as text, every locality and the three lengths as numbers", () => {
    const analysis = toEjesAnalysis({ [ANALYSIS_LIST_ALIAS.TWINS]: [twinRow] });

    expect(analysis.twins).toEqual([
      {
        ref: "1035386",
        idcalle: "72006",
        department: "FLORES",
        localities: ["FLORES RURAL", "TRINIDAD"],
        class: "BOTH",
        length: 250.25,
        urbanLength: 120.5,
        ruralLength: 30,
        dropLocalities: ["FLORES RURAL"],
      },
    ]);
  });

  it.each(["URBAN", "RURAL", "BOTH", "NEITHER"])("should keep the class %s", (twinClass) => {
    expect(toEjesAnalysis({ [ANALYSIS_LIST_ALIAS.TWINS]: [{ ...twinRow, class: twinClass }] }).twins[0].class).toBe(twinClass);
  });

  it("should map null lengths, idcalle and department to null", () => {
    const [twin] = toEjesAnalysis({
      [ANALYSIS_LIST_ALIAS.TWINS]: [{ ...twinRow, idcalle: null, department: null, length: null, urban_length: null, rural_length: null }],
    }).twins;

    expect(twin).toMatchObject({ idcalle: null, department: null, length: null, urbanLength: null, ruralLength: null });
  });

  it("should map a missing or non-array localities to an empty list", () => {
    expect(toEjesAnalysis({ [ANALYSIS_LIST_ALIAS.TWINS]: [{ ...twinRow, localities: null }] }).twins[0].localities).toEqual([]);
    expect(toEjesAnalysis({ [ANALYSIS_LIST_ALIAS.TWINS]: [{ ...twinRow, localities: "x" }] }).twins[0].localities).toEqual([]);
  });

  it("should map drop_localities to dropLocalities as text, keeping their order", () => {
    const rows = [{ ...twinRow, class: "URBAN", drop_localities: ["A RURAL", 7] }];

    expect(toEjesAnalysis({ [ANALYSIS_LIST_ALIAS.TWINS]: rows }).twins[0].dropLocalities).toEqual(["A RURAL", "7"]);
  });

  it.each([[null], [undefined], ["FLORES RURAL"], [{}], [5]])("should map drop_localities %j to an empty list", (value) => {
    const rows = [{ ...twinRow, drop_localities: value }];

    expect(toEjesAnalysis({ [ANALYSIS_LIST_ALIAS.TWINS]: rows }).twins[0].dropLocalities).toEqual([]);
  });

  it("should map the twinsDrop and twinsKeep counts and keep them summing to the twins", () => {
    const { counts } = toEjesAnalysis({ twins: 6, twins_drop: 2, twins_keep: 4 });

    expect(counts.twinsDrop + counts.twinsKeep).toBe(counts.twins);
  });

  it("should keep the order of the rows", () => {
    const rows = [{ ...twinRow, ref: "3" }, { ...twinRow, ref: "1" }, { ...twinRow, ref: "2" }];

    expect(toEjesAnalysis({ [ANALYSIS_LIST_ALIAS.TWINS]: rows }).twins.map((twin) => twin.ref)).toEqual(["3", "1", "2"]);
  });

  it("should return no twin rows when the list is missing or not an array", () => {
    expect(toEjesAnalysis({}).twins).toEqual([]);
    expect(toEjesAnalysis({ [ANALYSIS_LIST_ALIAS.TWINS]: "oops" }).twins).toEqual([]);
  });
});
