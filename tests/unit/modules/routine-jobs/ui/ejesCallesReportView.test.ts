import { describe, expect, it } from "vitest";
import { TWIN_CLASS } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesResult, EjesTwinRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import {
  buildEjesReportView,
  coverageTextOf,
  EJES_DRY_RUN_BANNER,
  metersTextOf,
  twinCaseTextOf,
  twinDecisionTextOf,
} from "@/modules/routine-jobs/ui/ejesCallesReportView";

const COUNTS = {
  newSections: 5,
  unchanged: 80,
  attr: 2,
  geom: 3,
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
  renumbered: 2,
  renumberedWithPoints: 1,
  renumberedPoints: 5,
};

const TWIN: EjesTwinRow = {
  ref: "1035386",
  idcalle: "72006",
  department: "FLORES",
  localities: ["FLORES RURAL", "TRINIDAD"],
  class: TWIN_CLASS.BOTH,
  length: 250.25,
  urbanLength: 120.5,
  ruralLength: 30,
  dropLocalities: [],
};

const resultOf = (overrides: Partial<EjesResult> = {}): EjesResult =>
  ({
    dryRun: true,
    targetModified: false,
    outcomeUnknown: false,
    staging: {
      rows: 100,
      distinctRefs: 98,
      repeatedGroups: 1,
      repeatedRows: 2,
      nonIntegerRefs: 0,
      emptyGeometry: 0,
      emptyIdcalle: 0,
      damagedTextRows: 4,
      unknownTipoRows: 3,
      unknownFuenteRows: 1,
      unknownTipos: [
        { value: "AUTOPISTA", rows: 3 },
        { value: null, rows: 1 },
      ],
      unknownFuentes: [{ value: "XYZ", rows: 1 }],
      invalidGeometryRows: 0,
      invalidGeometryRefs: 0,
      invalidGeometries: [],
    },
    counts: COUNTS,
    cloc: { withLocality: 6, onlyDepartment: 2, withoutCode: 0 },
    splits: [],
    merges: [],
    plainRemovals: [],
    newStreets: [],
    twins: [],
    renumbered: [],
    attrChanges: [
      {
        ref: "1",
        name: "B",
        currentName: "A",
        idcalle: "1",
        currentIdcalle: "1",
        typeId: 4,
        currentTypeId: 4,
        fontId: 1,
        currentFontId: 1,
      },
    ],
    blockers: ["bloqueo uno"],
    privilegeInfo: ["falta INSERT"],
    tables: {},
    stepTimings: [
      { label: "a", ms: 1500 },
      { label: "b", ms: 500 },
    ],
    ...overrides,
  }) as unknown as EjesResult;

describe("buildEjesReportView (EJ-12)", () => {
  it("should show the dry-run banner", () => {
    const view = buildEjesReportView(resultOf());

    expect(EJES_DRY_RUN_BANNER).toBe("Análisis: no se modificó ninguna tabla.");
    expect(view.banners).toEqual([{ kind: "dryRun", text: "Análisis: no se modificó ninguna tabla." }]);
  });

  it("should expose cards for staging checks, classification and cloc counts", () => {
    const kpis = Object.fromEntries(buildEjesReportView(resultOf()).kpiGroups.flatMap((group) => group.kpis).map((kpi) => [kpi.label, kpi.value]));

    expect(kpis["Filas"]).toBe(100);
    expect(kpis["Tramos distintos"]).toBe(98);
    expect(kpis["Tramos con más de una fila"]).toBe(1);
    expect(kpis["Filas con tipo de vía desconocido"]).toBe(3);
    expect(kpis["Filas con caracteres dañados (�)"]).toBe(4);
    expect(kpis["Nuevos"]).toBe(3);
    expect(kpis["Sin cambios"]).toBe(80);
    expect(kpis["Divididos en varios nuevos"]).toBe(1);
    expect(kpis["Unidos en uno nuevo"]).toBe(1);
    expect(kpis["Sin reemplazo, se quitarían"]).toBe(1);
    expect(kpis["Sin reemplazo, con puntos de acceso: no se quitan"]).toBe(1);
    expect(kpis["Con localidad"]).toBe(6);
    expect(kpis["Solo con departamento"]).toBe(2);
  });

  it("should pass blockers and privilege information through", () => {
    const view = buildEjesReportView(resultOf());

    expect(view.blockers).toEqual(["bloqueo uno"]);
    expect(view.privilegeInfo).toEqual(["falta INSERT"]);
  });

  it("should list unknown values with row counts and sin dato for null", () => {
    const view = buildEjesReportView(resultOf());

    expect(view.unknownTipos).toEqual(["AUTOPISTA: 3 filas", "sin dato: 1 fila"]);
    expect(view.unknownFuentes).toEqual(["XYZ: 1 fila"]);
  });

  it("should summarize lists, noting a cut list", () => {
    const cut = buildEjesReportView(resultOf({ counts: { ...COUNTS, splits: 700 } }));
    const full = buildEjesReportView(resultOf({ counts: { ...COUNTS, splits: 0 } }));

    expect(cut.summaries.splits).toBe("Tramos divididos (primeras 0 de 700)");
    expect(full.summaries.splits).toBe("Tramos divididos (0)");
  });

  it("should describe attribute changes per row", () => {
    expect(buildEjesReportView(resultOf()).attrRows[0].changes).toBe("nombre");
  });

  it("should convert timings to seconds and sum them", () => {
    const view = buildEjesReportView(resultOf());

    expect(view.timings).toEqual([
      { label: "a", seconds: 1.5 },
      { label: "b", seconds: 0.5 },
    ]);
    expect(view.totalSeconds).toBe(2);
  });

  it("should handle an empty result without blockers", () => {
    const view = buildEjesReportView(resultOf({ blockers: [], privilegeInfo: [], stepTimings: [] }));

    expect(view.blockers).toEqual([]);
    expect(view.totalSeconds).toBe(0);
  });

  describe("twins (ET-6)", () => {
    it("should have a KPI group Tramos repetidos por localidad with total, the four classes and the cross-department count, in order", () => {
      const group = buildEjesReportView(resultOf()).kpiGroups.find((candidate) => candidate.title === "Tramos repetidos por localidad");

      expect(group?.kpis).toEqual([
        { label: "Total", value: 6 },
        { label: "Cerca de urbanos solamente", value: 1 },
        { label: "Cerca de rurales solamente", value: 2 },
        { label: "Cerca de ambos", value: 3 },
        { label: "Lejos de ambos", value: 4 },
        { label: "Se quitaría alguna copia", value: 2 },
        { label: "Se mantienen todas", value: 4 },
        { label: "En más de un departamento: sin regla", value: 5 },
      ]);
    });

    it("should show zeros in the KPI group when there are no twin groups", () => {
      const zero = { ...COUNTS, twins: 0, twinsUrban: 0, twinsRural: 0, twinsBoth: 0, twinsNeither: 0, twinsCrossDepartment: 0, twinsDrop: 0, twinsKeep: 0, renumbered: 0, renumberedWithPoints: 0, renumberedPoints: 0 };
      const group = buildEjesReportView(resultOf({ counts: zero })).kpiGroups.find(
        (candidate) => candidate.title === "Tramos repetidos por localidad"
      );

      expect(group?.kpis.map((kpi) => kpi.value)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("should summarize the list with the shown rows and the total, noting a cut list", () => {
      const full = buildEjesReportView(resultOf({ twins: [TWIN], counts: { ...COUNTS, twins: 1 } }));
      const cut = buildEjesReportView(resultOf({ twins: [TWIN], counts: { ...COUNTS, twins: 700 } }));

      expect(full.summaries.twins).toBe("Tramos repetidos por localidad (primero los que se deciden en el mapa) (1)");
      expect(cut.summaries.twins).toBe("Tramos repetidos por localidad (primero los que se deciden en el mapa) (primeras 1 de 700)");
    });

    it.each([
      [TWIN_CLASS.URBAN, "Cerca de padrones urbanos"],
      [TWIN_CLASS.RURAL, "Cerca de padrones rurales"],
      [TWIN_CLASS.BOTH, "Cerca de ambos: se mantienen las dos"],
      [TWIN_CLASS.NEITHER, "Lejos de padrones: sin regla"],
    ])("should describe the class %s as %s", (twinClass, text) => {
      expect(twinCaseTextOf(twinClass)).toBe(text);
    });
  });

  describe("renumbered sections (ER-4)", () => {
    const row = { oldRef: "10", newRef: "11", idcalle: "5", points: 3, oldLength: 100, newLength: 100.2, hausdorff: 0.2 };
    const kpisOf = (result: EjesResult): Record<string, number> =>
      Object.fromEntries(buildEjesReportView(result).kpiGroups.flatMap((group) => group.kpis).map((kpi) => [kpi.label, kpi.value]));

    it("should show Nuevos without the renumbered news: newSections minus renumbered", () => {
      expect(kpisOf(resultOf({ counts: { ...COUNTS, newSections: 10, renumbered: 4 } }))["Nuevos"]).toBe(6);
      expect(kpisOf(resultOf({ counts: { ...COUNTS, newSections: 10, renumbered: 0 } }))["Nuevos"]).toBe(10);
      expect(kpisOf(resultOf({ counts: { ...COUNTS, newSections: 4, renumbered: 4 } }))["Nuevos"]).toBe(0);
    });

    it("should show the three renumbered KPIs with their values", () => {
      const kpis = kpisOf(resultOf());

      expect(kpis["Renumerados (mismo trazado, otro reftramo)"]).toBe(2);
      expect(kpis["Renumerados con puntos de acceso"]).toBe(1);
      expect(kpis["Puntos de acceso que seguirían al renumerar"]).toBe(5);
    });

    it("should put the renumbered KPI in the group of current sections that no longer come in the file", () => {
      const group = buildEjesReportView(resultOf()).kpiGroups.find((candidate) =>
        candidate.kpis.some((kpi) => kpi.label === "Renumerados (mismo trazado, otro reftramo)")
      );

      expect(group?.title).toBe("Tramos actuales que ya no vienen en el archivo");
    });

    it("should leave the raw removed count as it is", () => {
      expect(kpisOf(resultOf({ counts: { ...COUNTS, removed: 4, renumbered: 2 } }))["Sin reemplazo, se quitarían"]).toBe(1);
    });

    it("should summarize the list with the shown rows and the total, noting a cut list", () => {
      expect(buildEjesReportView(resultOf({ renumbered: [row], counts: { ...COUNTS, renumbered: 1 } })).summaries.renumbered).toBe(
        "Tramos renumerados (primero los que tienen puntos de acceso) (1)"
      );
      expect(buildEjesReportView(resultOf({ renumbered: [row], counts: { ...COUNTS, renumbered: 4037 } })).summaries.renumbered).toBe(
        "Tramos renumerados (primero los que tienen puntos de acceso) (primeras 1 de 4037)"
      );
    });
  });

  describe("invalid geometries (ET-18)", () => {
    const withInvalid = (rows: number, refs: number, list: EjesResult["staging"]["invalidGeometries"] = []): EjesResult => {
      const base = resultOf();
      return { ...base, staging: { ...base.staging, invalidGeometryRows: rows, invalidGeometryRefs: refs, invalidGeometries: list } };
    };
    const kpiLabels = (result: EjesResult): string[] => buildEjesReportView(result).kpiGroups.flatMap((group) => group.kpis.map((kpi) => kpi.label));

    it("should show both invalid-geometry KPIs with their values when there are invalid rows", () => {
      const kpis = Object.fromEntries(
        buildEjesReportView(withInvalid(795, 615)).kpiGroups.flatMap((group) => group.kpis).map((kpi) => [kpi.label, kpi.value])
      );

      expect(kpis["Filas con geometría inválida (se omiten)"]).toBe(795);
      expect(kpis["Tramos con geometría inválida"]).toBe(615);
    });

    it("should show neither KPI when there are no invalid geometries", () => {
      const labels = kpiLabels(withInvalid(0, 0));

      expect(labels).not.toContain("Filas con geometría inválida (se omiten)");
      expect(labels).not.toContain("Tramos con geometría inválida");
    });

    it("should show the KPIs in the file-problems part, next to the other file problems", () => {
      const problems = buildEjesReportView(withInvalid(3, 2)).kpiGroups.find((group) => group.kpis.some((kpi) => kpi.label === "Tramos con geometría inválida"));
      const labels = problems?.kpis.map((kpi) => kpi.label) ?? [];

      expect(labels).toContain("Filas con caracteres dañados (�)");
      expect(labels).toContain("Filas con geometría inválida (se omiten)");
    });

    it("should summarize the list with the shown rows and the row total, noting a cut list", () => {
      const row = { ref: "1", idcalle: "2", localidad: "A", departamento: "B" };

      expect(buildEjesReportView(withInvalid(1, 1, [row])).summaries.invalidGeometries).toBe("Tramos con geometría inválida (se omiten) (1)");
      expect(buildEjesReportView(withInvalid(795, 615, [row])).summaries.invalidGeometries).toBe(
        "Tramos con geometría inválida (se omiten) (primeras 1 de 795)"
      );
    });

    it("should not make invalid geometries a blocker or change the other counts", () => {
      const view = buildEjesReportView(withInvalid(3, 2));

      expect(view.blockers).toEqual(["bloqueo uno"]);
    });
  });

  describe("twinDecisionTextOf (ET-11)", () => {
    it("should list the localities that would be dropped, comma separated", () => {
      expect(twinDecisionTextOf({ class: TWIN_CLASS.URBAN, dropLocalities: ["FLORES RURAL"] })).toBe("Se quitaría: FLORES RURAL");
      expect(twinDecisionTextOf({ class: TWIN_CLASS.URBAN, dropLocalities: ["A RURAL", "B RURAL"] })).toBe("Se quitaría: A RURAL, B RURAL");
    });

    it("should list the localities of a RURAL row that would be dropped", () => {
      expect(twinDecisionTextOf({ class: TWIN_CLASS.RURAL, dropLocalities: ["TRINIDAD", "MALDONADO RURAL"] })).toBe(
        "Se quitaría: TRINIDAD, MALDONADO RURAL"
      );
    });

    it("should say Se mantienen todas for a BOTH row", () => {
      expect(twinDecisionTextOf({ class: TWIN_CLASS.BOTH, dropLocalities: [] })).toBe("Se mantienen todas");
    });

    it.each([TWIN_CLASS.URBAN, TWIN_CLASS.RURAL])(
      "should say Se mantienen todas for the class %s with nothing to drop (no copy of the other kind)",
      (twinClass) => {
        expect(twinDecisionTextOf({ class: twinClass, dropLocalities: [] })).toBe("Se mantienen todas");
      }
    );

    it("should say Sin regla: se mantienen todas for a NEITHER row", () => {
      expect(twinDecisionTextOf({ class: TWIN_CLASS.NEITHER, dropLocalities: [] })).toBe("Sin regla: se mantienen todas");
    });

    it("should show the drop text before the class when the row has localities to drop", () => {
      expect(twinDecisionTextOf({ class: TWIN_CLASS.BOTH, dropLocalities: ["X RURAL"] })).toBe("Se quitaría: X RURAL");
    });
  });

  describe("coverageTextOf", () => {
    it("should round to a percent and show sin dato for null", () => {
      expect(coverageTextOf(0.956)).toBe("96%");
      expect(coverageTextOf(1)).toBe("100%");
      expect(coverageTextOf(0)).toBe("0%");
      expect(coverageTextOf(null)).toBe("sin dato");
    });
  });

  describe("metersTextOf", () => {
    it("should show one decimal and sin dato for null", () => {
      expect(metersTextOf(1087.7644)).toBe("1087.8");
      expect(metersTextOf(0)).toBe("0.0");
      expect(metersTextOf(null)).toBe("sin dato");
    });
  });
});
