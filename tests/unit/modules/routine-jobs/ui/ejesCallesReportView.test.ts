import { describe, expect, it } from "vitest";
import type { EjesResult } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import {
  buildEjesReportView,
  coverageTextOf,
  EJES_DRY_RUN_BANNER,
  metersTextOf,
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
    },
    counts: COUNTS,
    cloc: { withLocality: 6, onlyDepartment: 2, withoutCode: 0 },
    splits: [],
    merges: [],
    plainRemovals: [],
    newStreets: [],
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
    expect(kpis["Nuevos"]).toBe(5);
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
