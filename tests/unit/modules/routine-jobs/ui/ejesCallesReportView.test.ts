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
  twinRowCaseTextOf,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesReportView";

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
  keptByDiscardedCandidate: 0,
  newStreets: 1,
  twins: 6,
  twinsUrban: 1,
  twinsRural: 2,
  twinsBoth: 3,
  twinsNeither: 4,
  twinsCrossDepartment: 5,
  twinsDrop: 2,
  twinsKeep: 4,
  twinsUndecided: 0,
  twinPicksApplied: 0,
  twinsDefaulted: 2,
  renumbered: 2,
  renumberedWithPoints: 1,
  renumberedPoints: 5,
  renumberedByGeometry: 0,
  renumberDroppedCandidates: 0,
  renumberSkipped: 0,
  splitPointsTotal: 0,
  splitPointsAuto: 0,
  splitPointsReview: 0,
  splitPointsNoGeometry: 0,
  splitPointsFar: 0,
  geoTwinGroups: 0,
  geoTwinSections: 0,
  geoTwinLosersOmitted: 0,
  geoTwinLosersRemovable: 0,
  geoTwinSkippedRefs: 0,
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
  insideLocalities: [],
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
    twinUndecided: [],
    geoTwins: [],
    renumbered: [],
    renumberSkipped: [],
    renumberDropped: [],
    keptByDiscarded: [],
    fingerprint: { rows: 100, digest: "9f8e7d6c5b4a" },
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

  it("should show no dry-run banner for a real run, whose outcome banner comes from the load result", () => {
    const view = buildEjesReportView(resultOf({ dryRun: false, targetModified: true }));

    expect(view.banners).toEqual([]);
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
        { label: "Decididos por defecto", value: 2 },
      ]);
    });

    it("should show zeros in the KPI group when there are no twin groups", () => {
      const zero = { ...COUNTS, twins: 0, twinsUrban: 0, twinsRural: 0, twinsBoth: 0, twinsNeither: 0, twinsCrossDepartment: 0, twinsDrop: 0, twinsKeep: 0, twinsDefaulted: 0, renumbered: 0, renumberedWithPoints: 0, renumberedPoints: 0 };
      const group = buildEjesReportView(resultOf({ counts: zero })).kpiGroups.find(
        (candidate) => candidate.title === "Tramos repetidos por localidad"
      );

      expect(group?.kpis.map((kpi) => kpi.value)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("should keep no summary of the twin rows, which are counted in the KPI group only", () => {
      const view = buildEjesReportView(resultOf({ counts: { ...COUNTS, twins: 700 } }));

      expect(Object.keys(view.summaries)).not.toContain("twins");
      expect(view.kpiGroups.find((group) => group.title === "Tramos repetidos por localidad")?.kpis[0]).toEqual({ label: "Total", value: 700 });
    });

    it.each([
      [TWIN_CLASS.URBAN, "Cerca de padrones urbanos"],
      [TWIN_CLASS.RURAL, "Cerca de padrones rurales"],
      [TWIN_CLASS.BOTH, "Cerca de ambos: se mantiene una"],
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

    it("should keep no summary of the renumbered rows, which are counted in the KPI group only", () => {
      const view = buildEjesReportView(resultOf({ counts: { ...COUNTS, renumbered: 4037 } }));

      expect(Object.keys(view.summaries)).not.toContain("renumbered");
      expect(kpisOf(resultOf({ counts: { ...COUNTS, renumbered: 4037 } }))["Renumerados (mismo trazado, otro reftramo)"]).toBe(4037);
    });
  });

  describe("renumbers held back (EJ-25, EJL-12)", () => {
    const held = { oldRef: "3001", newRef: "3002", idcalle: "5", points: 2, reason: "not_single_copy" } as const;

    it("should summarize the held list with its shown rows and the analysis count, in the list's own title", () => {
      const view = buildEjesReportView(resultOf({ renumberSkipped: [held], counts: { ...COUNTS, renumberSkipped: 1 } }));

      expect(view.summaries.renumberHeld).toBe("Renumerados retenidos (ambos tramos quedan como están) (1)");
    });

    it("should note a cut held list when the analysis count is larger than the rows shown", () => {
      const view = buildEjesReportView(resultOf({ renumberSkipped: [held], counts: { ...COUNTS, renumberSkipped: 700 } }));

      expect(view.summaries.renumberHeld).toBe("Renumerados retenidos (ambos tramos quedan como están) (primeras 1 de 700)");
    });

    it("should summarize an empty held list with zero", () => {
      expect(buildEjesReportView(resultOf()).summaries.renumberHeld).toBe("Renumerados retenidos (ambos tramos quedan como están) (0)");
    });
  });

  describe("renumbers dropped as candidates (EJL-27)", () => {
    const dropped = { ref: "3002", oldRef: "3001", keptRef: "3003", hausdorff: 0.1, points: 0 };

    it("should summarize the dropped list with the analysis count, in the list's own title", () => {
      const view = buildEjesReportView(resultOf({ renumberDropped: [dropped], counts: { ...COUNTS, renumberDroppedCandidates: 1 } }));

      expect(view.summaries.renumberDropped).toBe("Candidatos descartados (el tramo se renumera a otro reftramo) (1)");
    });

    it("should note a cut dropped list when the analysis count is larger than the rows shown", () => {
      const view = buildEjesReportView(resultOf({ renumberDropped: [dropped], counts: { ...COUNTS, renumberDroppedCandidates: 700 } }));

      expect(view.summaries.renumberDropped).toBe("Candidatos descartados (el tramo se renumera a otro reftramo) (primeras 1 de 700)");
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

      expect(kpis["Filas con geometría inválida o colapsada, o menor de 1 m sin puntos de acceso (se omiten)"]).toBe(795);
      expect(kpis["Tramos con geometría inválida o colapsada, o menores de 1 m sin puntos de acceso"]).toBe(615);
    });

    it("should show neither KPI when there are no invalid geometries", () => {
      const labels = kpiLabels(withInvalid(0, 0));

      expect(labels).not.toContain("Filas con geometría inválida o colapsada, o menor de 1 m sin puntos de acceso (se omiten)");
      expect(labels).not.toContain("Tramos con geometría inválida o colapsada, o menores de 1 m sin puntos de acceso");
    });

    it("should show the KPIs in the file-problems part, next to the other file problems", () => {
      const problems = buildEjesReportView(withInvalid(3, 2)).kpiGroups.find((group) => group.title === "Problemas en el archivo");
      const labels = problems?.kpis.map((kpi) => kpi.label) ?? [];

      expect(labels).toContain("Filas con geometría inválida o colapsada, o menor de 1 m sin puntos de acceso (se omiten)");
      expect(labels).toContain("Tramos con geometría inválida o colapsada, o menores de 1 m sin puntos de acceso");
    });

    it("should summarize the list with the shown rows and the row total, noting a cut list", () => {
      const row = { ref: "1", idcalle: "2", localidad: "A", departamento: "B" };

      expect(buildEjesReportView(withInvalid(1, 1, [row])).summaries.invalidGeometries).toBe(
        "Tramos con geometría inválida o colapsada, o menores de 1 m sin puntos de acceso (se omiten) (1)"
      );
      expect(buildEjesReportView(withInvalid(795, 615, [row])).summaries.invalidGeometries).toBe(
        "Tramos con geometría inválida o colapsada, o menores de 1 m sin puntos de acceso (se omiten) (primeras 1 de 795)"
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

  describe("twinRowCaseTextOf and twinDecisionTextOf for NEITHER (ET-19)", () => {
    const neither = { class: TWIN_CLASS.NEITHER, localities: ["A", "B"], dropLocalities: [] as string[], insideLocalities: [] as string[] };

    it("should say Sin regla when nothing is dropped even if two polygons match", () => {
      const row = { ...neither, insideLocalities: ["A", "B"] };

      expect(twinRowCaseTextOf(row)).toBe("Lejos de padrones: sin regla");
      expect(twinDecisionTextOf(row)).toBe("Sin regla: se mantienen todas");
    });

    it("should say Cruza varias localidades with the winner and the dropped copy when two polygons match and one is dropped", () => {
      const row = { ...neither, localities: ["A", "B", "C"], insideLocalities: ["B", "C", "A"], dropLocalities: ["C"] };

      expect(twinRowCaseTextOf(row)).toBe("Cruza varias localidades");
      expect(twinDecisionTextOf(row)).toBe("Cruza varias localidades: se queda B (mayor largo dentro); se quitaría: C");
    });

    it("should name the first kept inside locality as winner and every dropped copy", () => {
      const row = { ...neither, localities: ["A", "B", "C"], insideLocalities: ["A", "C", "B"], dropLocalities: ["A", "C"] };

      expect(twinDecisionTextOf(row)).toBe("Cruza varias localidades: se queda B (mayor largo dentro); se quitaría: A, C");
    });

    it("should say sin dato for the winner when no kept copy is inside the polygons", () => {
      const row = { ...neither, localities: ["A", "B", "C"], insideLocalities: ["A", "B"], dropLocalities: ["A", "B"] };

      expect(twinDecisionTextOf(row)).toBe("Cruza varias localidades: se queda sin dato (mayor largo dentro); se quitaría: A, B");
    });

    it("should not say Cruza varias localidades when only one polygon matches", () => {
      const row = { ...neither, insideLocalities: ["A"] };

      expect(twinRowCaseTextOf(row)).toBe("Lejos de padrones: sin regla");
      expect(twinDecisionTextOf(row)).toBe("Sin regla: se mantienen todas");
    });

    it("should say por polígono de localidad with se quita for a single dropped copy", () => {
      const row = { ...neither, insideLocalities: ["A"], dropLocalities: ["B"] };

      expect(twinRowCaseTextOf(row)).toBe("Lejos de padrones: por polígono de localidad");
      expect(twinDecisionTextOf(row)).toBe("Dentro de A: se quita B");
    });

    it("should say se quitan with every dropped copy and every inside locality", () => {
      const row = { ...neither, localities: ["A", "B", "C"], insideLocalities: ["A", "D"], dropLocalities: ["B", "C"] };

      expect(twinDecisionTextOf(row)).toBe("Dentro de A, D: se quitan B, C");
    });

    it("should say regla rural when no polygon matches and a copy is dropped", () => {
      const row = { ...neither, dropLocalities: ["B RURAL"] };

      expect(twinRowCaseTextOf(row)).toBe("Lejos de padrones: regla rural");
      expect(twinDecisionTextOf(row)).toBe("Se quitaría: B RURAL");
    });

    it("should say sin regla when no polygon matches and nothing is dropped", () => {
      expect(twinRowCaseTextOf(neither)).toBe("Lejos de padrones: sin regla");
      expect(twinDecisionTextOf(neither)).toBe("Sin regla: se mantienen todas");
    });

    it("should leave the case of a non-NEITHER row to its class", () => {
      expect(twinRowCaseTextOf({ class: TWIN_CLASS.BOTH, dropLocalities: [], insideLocalities: ["A", "B"], localities: ["A", "B"] })).toBe(
        "Cerca de ambos: se mantiene una"
      );
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
