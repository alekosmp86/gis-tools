import { describe, expect, it } from "vitest";
import { buildReportView } from "@/modules/routine-jobs/ui/cargarPadronesReportView";
import type {
  AmbiguousLocalityCode,
  AttributeConflictSample,
  CargarPadronesResult,
  TypeReport,
} from "@/modules/routine-jobs/jobs/cargar-padrones/types";

const typeReport = (overrides: Partial<TypeReport> = {}): TypeReport => ({
  rowsRead: 100,
  groups: 90,
  rowsMerged: 5,
  repaired: 0,
  insertedInvalid: 0,
  repairedInUnion: 0,
  noGeometry: 3,
  nullKeyRows: 2,
  attributeConflicts: 0,
  attributeConflictSamples: [],
  inserted: 90,
  ...overrides,
});

const result = (overrides: Partial<CargarPadronesResult> = {}): CargarPadronesResult => ({
  dryRun: false,
  targetModified: true,
  outcomeUnknown: false,
  report: { rural: typeReport(), urbano: typeReport({ rowsRead: 200, groups: 150, inserted: 150 }) },
  totals: { rowsRead: 300, groups: 240, rowsMerged: 20, inserted: 240 },
  ambiguousLocalityCodes: [],
  ambiguousLocalityTotal: 0,
  warnings: [],
  stepTimings: [],
  analyze: { status: "ok" },
  ...overrides,
});

const samples = (count: number, prefix = "k"): AttributeConflictSample[] =>
  Array.from({ length: count }, (_, index) => ({ key: `${prefix}${index}`, column: "seccat", values: ["1", "2"] }));

const ambiguous = (count: number): AmbiguousLocalityCode[] =>
  Array.from({ length: count }, (_, index) => ({
    coddepto: "1",
    codloccat: String(index),
    nomdepto: null,
    nomloccat: ["Uno", "Dos"],
  }));

type Row = { label: string; value: unknown };

const labels = (rows: Row[]): string[] => rows.map((row) => row.label);
const valueOf = (rows: Row[], label: string): string => String(rows.find((row) => row.label === label)?.value);

describe("cargarPadronesReportView", () => {
  describe("per type rows", () => {
    it("AC-31: should list the repair mode rows in the documented order", () => {
      const view = buildReportView(result({ report: { rural: typeReport({ repaired: 4 }), urbano: typeReport({ repaired: 6 }) } }));

      expect(labels(view.rural)).toEqual([
        "Filas leídas",
        "Reparadas",
        "Sin geometría",
        "Claves vacías",
        "Grupos",
        "Filas fusionadas",
        "Conflictos de atributos",
        "Insertadas",
      ]);
      expect(labels(view.urbano)).toEqual(labels(view.rural));
    });

    it("AC-31: should list the no-repair mode rows when invalid geometries were inserted", () => {
      const view = buildReportView(
        result({ report: { rural: typeReport({ insertedInvalid: 2, repairedInUnion: 1 }), urbano: typeReport() } }),
      );

      expect(labels(view.rural)).toEqual([
        "Filas leídas",
        "Insertadas inválidas",
        "Reparadas en la unión",
        "Sin geometría",
        "Claves vacías",
        "Grupos",
        "Filas fusionadas",
        "Conflictos de atributos",
        "Insertadas",
      ]);
      expect(labels(view.rural)).not.toContain("Reparadas");
    });

    it("AC-31: should show the no-repair rows when only repairedInUnion is positive", () => {
      const view = buildReportView(
        result({ report: { rural: typeReport({ repairedInUnion: 3 }), urbano: typeReport() } }),
      );

      expect(labels(view.rural)).toContain("Reparadas en la unión");
      expect(labels(view.rural)).not.toContain("Reparadas");
    });

    it("AC-31: should map each counter to the right row", () => {
      const view = buildReportView(
        result({
          report: {
            rural: typeReport({
              rowsRead: 11,
              repaired: 7,
              noGeometry: 5,
              nullKeyRows: 4,
              groups: 3,
              rowsMerged: 2,
              attributeConflicts: 1,
              inserted: 8,
            }),
            urbano: typeReport({ rowsRead: 21, repaired: 17, inserted: 28 }),
          },
        }),
      );

      expect(valueOf(view.rural, "Filas leídas")).toBe("11");
      expect(valueOf(view.rural, "Reparadas")).toBe("7");
      expect(valueOf(view.rural, "Sin geometría")).toBe("5");
      expect(valueOf(view.rural, "Claves vacías")).toBe("4");
      expect(valueOf(view.rural, "Grupos")).toBe("3");
      expect(valueOf(view.rural, "Filas fusionadas")).toBe("2");
      expect(valueOf(view.rural, "Conflictos de atributos")).toBe("1");
      expect(valueOf(view.rural, "Insertadas")).toBe("8");
      expect(valueOf(view.urbano, "Filas leídas")).toBe("21");
      expect(valueOf(view.urbano, "Insertadas")).toBe("28");
    });

    it("AC-31: should show zero counters as 0, not hide them", () => {
      const view = buildReportView(result({ report: { rural: typeReport({ noGeometry: 0, repaired: 1 }), urbano: typeReport() } }));

      expect(valueOf(view.rural, "Sin geometría")).toBe("0");
    });
  });

  describe("totals and warnings", () => {
    it("AC-31: should list the totals rows in order", () => {
      const view = buildReportView(result({ totals: { rowsRead: 300, groups: 240, rowsMerged: 20, inserted: 235 } }));

      expect(labels(view.totals)).toEqual(["Filas leídas", "Grupos", "Filas fusionadas", "Insertadas"]);
      expect(valueOf(view.totals, "Filas leídas")).toBe("300");
      expect(valueOf(view.totals, "Grupos")).toBe("240");
      expect(valueOf(view.totals, "Filas fusionadas")).toBe("20");
      expect(valueOf(view.totals, "Insertadas")).toBe("235");
    });

    it("AC-31: should pass the warnings through unchanged", () => {
      const warnings = ["Hay 2 filas sin clave.", "Se detectaron conflictos."];

      expect(buildReportView(result({ warnings })).warnings).toEqual(warnings);
    });

    it("AC-31: should return an empty warnings list when there are none", () => {
      expect(buildReportView(result({ warnings: [] })).warnings).toEqual([]);
    });
  });

  describe("conflict samples", () => {
    const withSamples = (rural: number, urbano = 0): CargarPadronesResult =>
      result({
        report: {
          rural: typeReport({ attributeConflicts: rural, attributeConflictSamples: samples(rural, "r") }),
          urbano: typeReport({ attributeConflicts: urbano, attributeConflictSamples: samples(urbano, "u") }),
        },
      });

    it("AC-31: should return no samples and no extra count when there are no conflicts", () => {
      const view = buildReportView(result());

      expect(view.conflictSamples).toEqual([]);
      expect(view.moreConflicts ?? 0).toBe(0);
    });

    it("AC-31: should map a sample to unit, key, column and values", () => {
      const view = buildReportView(
        result({
          report: {
            rural: typeReport({
              attributeConflicts: 1,
              attributeConflictSamples: [{ key: "SALTO|123", column: "seccat", values: ["1", "2"] }],
            }),
            urbano: typeReport(),
          },
        }),
      );

      expect(view.conflictSamples).toHaveLength(1);
      expect(view.conflictSamples[0]).toMatchObject({ key: "SALTO|123", column: "seccat", values: ["1", "2"] });
      expect(view.conflictSamples[0].unit).toBe("rural");
    });

    it("AC-31: should tag urban samples with the urbano unit", () => {
      const view = buildReportView(withSamples(0, 2));

      expect(view.conflictSamples.map((sample) => sample.unit)).toEqual(["urbano", "urbano"]);
    });

    it.each([19, 20])("AC-31: should show all %i samples without an extra count", (count) => {
      const view = buildReportView(withSamples(count));

      expect(view.conflictSamples).toHaveLength(count);
      expect(view.moreConflicts ?? 0).toBe(0);
    });

    it("AC-31: should cap at 20 and report one more conflict when there are 21", () => {
      const view = buildReportView(withSamples(21));

      expect(view.conflictSamples).toHaveLength(20);
      expect(view.moreConflicts).toBe(1);
    });

    it("AC-31: should cap the combined samples of both types at 20", () => {
      const view = buildReportView(withSamples(15, 10));

      expect(view.conflictSamples).toHaveLength(20);
      expect(view.moreConflicts).toBe(5);
    });

    it("AC-31: should keep the first samples in input order when capping", () => {
      const view = buildReportView(withSamples(25));

      expect(view.conflictSamples[0].key).toBe("r0");
      expect(view.conflictSamples[19].key).toBe("r19");
    });
  });

  describe("ambiguous locality codes", () => {
    it("AC-31: should return an empty list when there are none", () => {
      expect(buildReportView(result()).ambiguousLocalityCodes).toEqual([]);
    });

    it("AC-31: should map codes and the locality names", () => {
      const view = buildReportView(
        result({ ambiguousLocalityCodes: [{ coddepto: "1", codloccat: "7", nomdepto: null, nomloccat: ["Uno", "Dos"] }] }),
      );

      expect(view.ambiguousLocalityCodes).toEqual([{ coddepto: "1", codloccat: "7", names: ["Uno", "Dos"] }]);
    });

    it.each([19, 20])("AC-31: should show all %i codes", (count) => {
      expect(buildReportView(result({ ambiguousLocalityCodes: ambiguous(count) })).ambiguousLocalityCodes).toHaveLength(
        count,
      );
    });

    it("AC-31: should cap at 20 codes when there are 21", () => {
      const view = buildReportView(result({ ambiguousLocalityCodes: ambiguous(21) }));

      expect(view.ambiguousLocalityCodes).toHaveLength(20);
      expect(view.ambiguousLocalityCodes[19].codloccat).toBe("19");
    });
  });

  describe("timings", () => {
    it("AC-31: should return no timings and a zero total when there are none", () => {
      const view = buildReportView(result({ stepTimings: [] }));

      expect(view.timings).toEqual([]);
      expect(view.totalSeconds).toBe(0);
    });

    it("AC-31: should convert milliseconds to seconds rounded to two decimals", () => {
      const view = buildReportView(
        result({
          stepTimings: [
            { label: "Leer rurales", ms: 1234 },
            { label: "Insertar", ms: 500 },
            { label: "Rápido", ms: 4 },
          ],
        }),
      );

      expect(view.timings).toEqual([
        { label: "Leer rurales", seconds: 1.23 },
        { label: "Insertar", seconds: 0.5 },
        { label: "Rápido", seconds: 0 },
      ]);
    });

    it("AC-31: should sum the timings into totalSeconds rounded to two decimals", () => {
      const view = buildReportView(
        result({
          stepTimings: [
            { label: "a", ms: 1234 },
            { label: "b", ms: 500 },
          ],
        }),
      );

      expect(view.totalSeconds).toBe(1.73);
    });
  });

  describe("analyze", () => {
    it("AC-31: should label an OK analyze", () => {
      expect(buildReportView(result({ analyze: { status: "ok" } })).analyze).toMatchObject({
        status: "ok",
        label: "Estadísticas actualizadas",
      });
    });

    it("AC-31: should label a failed analyze and keep its message", () => {
      expect(buildReportView(result({ analyze: { status: "failed", message: "permiso denegado" } })).analyze).toMatchObject({
        status: "failed",
        label: "No se pudieron actualizar las estadísticas",
        message: "permiso denegado",
      });
    });

    it("AC-31: should label a skipped analyze", () => {
      expect(buildReportView(result({ analyze: { status: "skipped" } })).analyze).toMatchObject({
        status: "skipped",
        label: "No se actualizaron las estadísticas",
      });
    });

    it("AC-31: should not invent a message when the analyze has none", () => {
      expect(buildReportView(result({ analyze: { status: "ok" } })).analyze.message).toBeUndefined();
    });
  });

  describe("banner", () => {
    it("AC-31: should tell the user to verify the target table when the outcome is unknown", () => {
      const view = buildReportView(result({ outcomeUnknown: true, targetModified: false }));

      expect(view.banner.kind).toBe("unknown");
      expect(view.banner.text).toMatch(/verific/i);
      expect(view.banner.text).toMatch(/tabla destino/i);
    });

    it("AC-31: should prefer the unknown banner over any other state", () => {
      const view = buildReportView(result({ outcomeUnknown: true, targetModified: true, warnings: ["x"] }));

      expect(view.banner.kind).toBe("unknown");
    });

    it("AC-31: should show the dry run banner when the target was not modified", () => {
      const view = buildReportView(result({ dryRun: true, targetModified: false }));

      expect(view.banner).toEqual({ kind: "dryRun", text: "Simulación: no se modificó la tabla destino." });
    });

    it("AC-31: should show a warning banner when the target was modified and there are warnings", () => {
      const view = buildReportView(result({ targetModified: true, warnings: ["Hay conflictos."] }));

      expect(view.banner.kind).toBe("warning");
      expect(view.banner.text.trim().length).toBeGreaterThan(0);
    });

    it("AC-31: should show a done banner when the target was modified without warnings", () => {
      const view = buildReportView(result({ targetModified: true, warnings: [] }));

      expect(view.banner.kind).toBe("done");
      expect(view.banner.text.trim().length).toBeGreaterThan(0);
    });
  });

  describe("purity", () => {
    it("AC-31: should not mutate its input and return equal views for equal inputs", () => {
      const input = result({
        warnings: ["a"],
        stepTimings: [{ label: "x", ms: 10 }],
        ambiguousLocalityCodes: ambiguous(25),
      });
      const before = JSON.stringify(input);

      const first = buildReportView(input);
      const second = buildReportView(input);

      expect(JSON.stringify(input)).toBe(before);
      expect(second).toEqual(first);
    });
  });
});
