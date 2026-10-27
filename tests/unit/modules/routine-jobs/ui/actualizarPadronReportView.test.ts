import { describe, expect, it } from "vitest";
import { buildActualizarReportView } from "@/modules/routine-jobs/ui/actualizarPadronReportView";
import { SKIP_REASON, type SkipReason } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type {
  ActualizarPadronResult,
  CollidingKey,
  SkippedLocalityGroup,
  SkippedReport,
  SkippedSample,
} from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { actualizarResultOf } from "../wizard/actualizarFixtures";

const ALL_REASONS = Object.values(SKIP_REASON) as SkipReason[];
const LIMIT = 20;
const TOP_LIMIT = 10;

const zeroReasons = (): Record<SkipReason, number> =>
  Object.fromEntries(ALL_REASONS.map((reason) => [reason, 0])) as Record<SkipReason, number>;

const samplesOf = (count: number): SkippedSample[] =>
  Array.from({ length: count }, (_, index) => ({
    department: `DEP ${index}`,
    locality: `LOC ${index}`,
    padron: String(index),
    reason: SKIP_REASON.SIN_GEOMETRIA,
  }));

const keysOf = (count: number): CollidingKey[] =>
  Array.from({ length: count }, (_, index) => ({
    typePadron: "RURAL",
    idProvince: 1,
    idCadastralLocality: null,
    number: String(index),
    rows: 2,
  }));

const bannerKinds = (view: ReturnType<typeof buildActualizarReportView>): string[] => view.banners.map((banner) => banner.kind);

const skippedOf = (overrides: Partial<SkippedReport> = {}): SkippedReport => ({ ...actualizarResultOf().skipped, ...overrides });

const resultWithSkipped = (overrides: Partial<SkippedReport>, skippedTotal = 50): ActualizarPadronResult =>
  actualizarResultOf({
    totals: { rowsRead: 1000, accepted: 950, written: 950, repaired: 4, skipped: skippedTotal },
    skipped: skippedOf(overrides),
  });

const oneEachReason = (): Record<SkipReason, number> =>
  Object.fromEntries(ALL_REASONS.map((reason) => [reason, 1])) as Record<SkipReason, number>;

const countsOf = (byReason: Partial<Record<SkipReason, number>>): Record<SkipReason, number> =>
  Object.fromEntries(ALL_REASONS.map((reason) => [reason, byReason[reason] ?? 0])) as Record<SkipReason, number>;

const groupsNamed = (count: number): { name: string; count: number }[] =>
  Array.from({ length: count }, (_, index) => ({ name: `G${index}`, count: count - index }));

const localityGroup = (
  department: string | null,
  locality: string | null,
  reason: SkipReason,
  count: number,
): SkippedLocalityGroup => ({ department, locality, reason, count });

describe("actualizarPadronReportView", () => {
  describe("skipped rows by reason", () => {
    it("AP-34: should carry the counts of the reasons that skipped rows", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.skippedRows.find((row) => row.reason === SKIP_REASON.CLAVE_DUPLICADA)?.value).toBe(15);
      expect(view.skippedRows.find((row) => row.reason === SKIP_REASON.LOCALIDAD_NO_ENCONTRADA)?.value).toBe(20);
    });

    it("AP-34: should leave out the reasons that skipped nothing and count them as zero", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.skippedRows.find((row) => row.reason === SKIP_REASON.PROVINCIA_AMBIGUA)).toBeUndefined();
      expect(view.zeroReasonCount).toBe(ALL_REASONS.length - view.skippedRows.length);
    });

    it("AP-34: should give every reason a distinct Spanish label that is not its code", () => {
      const view = buildActualizarReportView(resultWithSkipped({ byReason: oneEachReason() }, ALL_REASONS.length));
      const labels = view.skippedRows.map((row) => row.label);

      expect(new Set(labels).size).toBe(ALL_REASONS.length);
      for (const row of view.skippedRows) {
        expect(row.label.trim().length, row.reason).toBeGreaterThan(0);
        expect(row.label, row.reason).not.toBe(row.reason);
      }
    });

    it("AP-34: should show no reason rows when nothing was skipped", () => {
      const result = actualizarResultOf({
        totals: { rowsRead: 10, accepted: 10, written: 10, repaired: 0, skipped: 0 },
        skipped: { ...actualizarResultOf().skipped, byReason: zeroReasons(), collidingKeys: [], collidingKeyCount: 0 },
      });

      const view = buildActualizarReportView(result);

      expect(view.skippedRows).toEqual([]);
      expect(view.zeroReasonCount).toBe(ALL_REASONS.length);
    });
  });

  describe("departments, localities and samples", () => {
    it("AP-34: should map a null department name to a non-empty text, never to null", () => {
      const view = buildActualizarReportView(actualizarResultOf());
      const unnamed = view.byDepartmentSplit.top.find((group) => group.count === 20);

      expect(unnamed?.name.trim().length).toBeGreaterThan(0);
      expect(unnamed?.name).not.toMatch(/null|undefined/);
    });

    it("AP-34: should keep the named department groups and their counts", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.byDepartmentSplit.top[0]).toMatchObject({ name: "LA PAZ", count: 30 });
      expect(view.byLocalitySplit.top[0]).toMatchObject({ name: "VILLA", count: 12 });
    });

    it("AP-34: should cap the department and locality groups at 20 rows", () => {
      const groups = Array.from({ length: 25 }, (_, index) => ({ name: `G${index}`, count: 25 - index }));
      const view = buildActualizarReportView(
        actualizarResultOf({ skipped: { ...actualizarResultOf().skipped, byDepartment: groups, byLocality: groups } }),
      );

      expect(view.byDepartmentSplit.top.length + view.byDepartmentSplit.rest.length).toBe(LIMIT);
      expect(view.byLocalitySplit.top.length + view.byLocalitySplit.rest.length).toBe(LIMIT);
    });

    it("AP-34: should show the samples with the Spanish reason label", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.samples).toHaveLength(1);
      expect(view.samples[0]).toMatchObject({ department: "LA PAZ", locality: "VILLA", padron: "1234" });
      expect(view.samples[0].reason).not.toBe(SKIP_REASON.LOCALIDAD_NO_ENCONTRADA);
      expect(view.samples[0].reason.trim().length).toBeGreaterThan(0);
    });

    it("AP-25: should cap the samples at 20 rows", () => {
      const view = buildActualizarReportView(
        actualizarResultOf({ skipped: { ...actualizarResultOf().skipped, samples: samplesOf(25) } }),
      );

      expect(view.samples).toHaveLength(LIMIT);
    });

    it("AP-34: should show a non-empty text for null sample fields", () => {
      const sample: SkippedSample = { department: null, locality: null, padron: null, reason: SKIP_REASON.CLAVE_NULA };
      const view = buildActualizarReportView(actualizarResultOf({ skipped: { ...actualizarResultOf().skipped, samples: [sample] } }));

      for (const field of [view.samples[0].department, view.samples[0].locality, view.samples[0].padron]) {
        expect(field.trim().length).toBeGreaterThan(0);
        expect(field).not.toMatch(/null|undefined/);
      }
    });

    it("AP-34: should give an empty sample list when no row was skipped", () => {
      const view = buildActualizarReportView(
        actualizarResultOf({ skipped: { ...actualizarResultOf().skipped, samples: [], byDepartment: [], byLocality: [] } }),
      );

      expect(view.samples).toEqual([]);
      expect(view.byDepartmentSplit.top).toEqual([]);
    });
  });

  describe("colliding keys", () => {
    it("AP-13: should describe each colliding key with its number and its row count", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.collidingKeys).toHaveLength(1);
      expect(view.collidingKeys[0].keyLabel).toContain("55");
      expect(view.collidingKeys[0].rows).toBe(2);
    });

    it("AP-34: should not print null for a key without locality", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.collidingKeys[0].keyLabel).not.toMatch(/null|undefined/);
    });

    it("AP-25: should cap the colliding keys at 20 rows but keep the full count", () => {
      const view = buildActualizarReportView(
        actualizarResultOf({ skipped: { ...actualizarResultOf().skipped, collidingKeys: keysOf(25), collidingKeyCount: 25 } }),
      );

      expect(view.collidingKeys).toHaveLength(LIMIT);
      expect(view.collidingKeyCount).toBe(25);
    });
  });

  describe("warnings and timings", () => {
    it("AP-16: should copy the warnings in order", () => {
      const warnings = ["Hay 50 filas omitidas.", "Hay 4 geometrías reparadas."];
      const view = buildActualizarReportView(actualizarResultOf({ warnings }));

      expect(view.warnings).toEqual(warnings);
    });

    it("AP-16: should round each step timing to hundredths of a second", () => {
      const view = buildActualizarReportView(
        actualizarResultOf({ stepTimings: [{ label: "Cargar tabla de trabajo", ms: 1234 }] }),
      );

      expect(view.timings).toEqual([{ label: "Cargar tabla de trabajo", seconds: 1.23 }]);
    });

    it("AP-16: should sum the step timings into the total", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.totalSeconds).toBe(3.23);
    });

    it("AP-16: should report zero total seconds when there are no timings", () => {
      expect(buildActualizarReportView(actualizarResultOf({ stepTimings: [] })).totalSeconds).toBe(0);
    });
  });

  describe("analyze", () => {
    it("AP-34: should label an ok analysis in Spanish without a message", () => {
      const view = buildActualizarReportView(actualizarResultOf({ analyze: { status: "ok" } }));

      expect(view.analyze.status).toBe("ok");
      expect(view.analyze.label.trim().length).toBeGreaterThan(0);
      expect(view.analyze.message).toBeUndefined();
    });

    it("AP-34: should keep the message of a failed analysis", () => {
      const view = buildActualizarReportView(actualizarResultOf({ analyze: { status: "failed", message: "sin permiso" } }));

      expect(view.analyze.status).toBe("failed");
      expect(view.analyze.message).toBe("sin permiso");
    });

    it("AP-34: should give each analysis status a different label", () => {
      const labels = (["ok", "failed", "skipped"] as const).map(
        (status) => buildActualizarReportView(actualizarResultOf({ analyze: { status } })).analyze.label,
      );

      expect(new Set(labels).size).toBe(3);
    });
  });

  describe("KPI cards", () => {
    it("AP-32b: should give four KPI cards in the order read, written, skipped, repaired", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.kpis.map((kpi) => kpi.value)).toEqual([1000, 950, 50, 4]);
    });

    it("AP-32b: should give each KPI card a distinct non-empty Spanish label", () => {
      const labels = buildActualizarReportView(actualizarResultOf()).kpis.map((kpi) => kpi.label);

      expect(new Set(labels).size).toBe(4);
      for (const label of labels) {
        expect(label.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("skipped reasons with share, bar step and hint", () => {
    it("AP-32b: should list only the non-zero reasons, largest count first", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.skippedRows.map((row) => row.reason)).toEqual([
        SKIP_REASON.LOCALIDAD_NO_ENCONTRADA,
        SKIP_REASON.CLAVE_DUPLICADA,
        SKIP_REASON.SIN_GEOMETRIA,
        SKIP_REASON.CLAVE_NULA,
      ]);
    });

    it("AP-32b: should count the zero reasons in zeroReasonCount", () => {
      expect(buildActualizarReportView(actualizarResultOf()).zeroReasonCount).toBe(3);
    });

    it("AP-32b: should give each shown reason its whole-percent share of the skipped rows", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.skippedRows.map((row) => row.percent)).toEqual([40, 30, 20, 10]);
    });

    it("AP-32b: should give each shown reason a bar step in 5 percent units equal to its share", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.skippedRows.map((row) => row.barStep)).toEqual([40, 30, 20, 10]);
    });

    it("AP-32b: should round the share and the bar step of a one-third and two-thirds split", () => {
      const view = buildActualizarReportView(
        resultWithSkipped({ byReason: countsOf({ LOCALIDAD_NO_ENCONTRADA: 2, CLAVE_NULA: 1 }) }, 3),
      );

      expect(view.skippedRows.map((row) => [row.percent, row.barStep])).toEqual([
        [67, 65],
        [33, 35],
      ]);
    });

    it("AP-32b: should give a full bar when one reason holds every skipped row", () => {
      const view = buildActualizarReportView(
        resultWithSkipped({ byReason: countsOf({ SIN_GEOMETRIA: 7 }) }, 7),
      );

      expect(view.skippedRows).toHaveLength(1);
      expect(view.skippedRows[0]).toMatchObject({ percent: 100, barStep: 100 });
    });

    it("AP-32b: should keep every bar step a multiple of 5 within 0 to 100", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      for (const row of view.skippedRows) {
        expect(row.barStep % 5, row.reason).toBe(0);
        expect(row.barStep, row.reason).toBeGreaterThanOrEqual(0);
        expect(row.barStep, row.reason).toBeLessThanOrEqual(100);
      }
    });

    it("AP-32b: should show no reason rows and zero share when nothing was skipped", () => {
      const view = buildActualizarReportView(
        resultWithSkipped({ byReason: countsOf({}), collidingKeys: [], collidingKeyCount: 0 }, 0),
      );

      expect(view.skippedRows).toEqual([]);
      expect(view.zeroReasonCount).toBe(ALL_REASONS.length);
    });

    it("AP-32b: should give every reason a one-line Spanish hint that differs from its label and code", () => {
      const everyReason = countsOf(Object.fromEntries(ALL_REASONS.map((reason) => [reason, 1])));
      const view = buildActualizarReportView(resultWithSkipped({ byReason: everyReason }, ALL_REASONS.length));

      expect(view.skippedRows).toHaveLength(ALL_REASONS.length);
      expect(new Set(view.skippedRows.map((row) => row.hint)).size).toBe(ALL_REASONS.length);
      for (const row of view.skippedRows) {
        expect(row.hint.trim().length, row.reason).toBeGreaterThan(0);
        expect(row.hint, row.reason).not.toMatch(/[\r\n]/);
        expect(row.hint, row.reason).not.toBe(row.label);
        expect(row.hint, row.reason).not.toBe(row.reason);
      }
    });
  });

  describe("department and locality top lists", () => {
    it("AP-32b: should keep the first ten departments as top and report the other rows as the rest", () => {
      const view = buildActualizarReportView(
        actualizarResultOf({ skipped: skippedOf({ byDepartment: groupsNamed(25), byLocality: groupsNamed(25) }) }),
      );

      expect(view.byDepartmentSplit.top).toHaveLength(TOP_LIMIT);
      expect(view.byDepartmentSplit.restCount).toBe(LIMIT - TOP_LIMIT);
      expect(view.byDepartmentSplit.rest.map((row) => row.name)).toEqual(groupsNamed(20).slice(TOP_LIMIT).map((row) => row.name));
    });

    it("AP-32b: should apply the same top and rest split to the localities", () => {
      const view = buildActualizarReportView(
        actualizarResultOf({ skipped: skippedOf({ byDepartment: groupsNamed(25), byLocality: groupsNamed(25) }) }),
      );

      expect(view.byLocalitySplit.top).toHaveLength(TOP_LIMIT);
      expect(view.byLocalitySplit.restCount).toBe(LIMIT - TOP_LIMIT);
    });

    it("AP-32b: should report no rest when there are ten or fewer groups", () => {
      const view = buildActualizarReportView(
        actualizarResultOf({ skipped: skippedOf({ byDepartment: groupsNamed(TOP_LIMIT), byLocality: [] }) }),
      );

      expect(view.byDepartmentSplit.top).toHaveLength(TOP_LIMIT);
      expect(view.byDepartmentSplit.restCount).toBe(0);
      expect(view.byDepartmentSplit.rest).toEqual([]);
      expect(view.byLocalitySplit).toEqual({ top: [], rest: [], restCount: 0 });
    });
  });

  describe("localities not found and ambiguous", () => {
    it("AP-32b: should list the localities not found with department, locality and count, largest first", () => {
      const view = buildActualizarReportView(
        resultWithSkipped({
          byLocalityAndReason: [
            localityGroup("LA PAZ", "VILLA", SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, 3),
            localityGroup(null, "SAN JOSE", SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, 9),
            localityGroup("ORURO", "X", SKIP_REASON.LOCALIDAD_AMBIGUA, 4),
          ],
        }),
      );

      expect(view.localitiesNotFound.map((row) => [row.locality, row.count])).toEqual([
        ["SAN JOSE", 9],
        ["VILLA", 3],
      ]);
      expect(view.localitiesNotFound[1]).toMatchObject({ department: "LA PAZ", locality: "VILLA", count: 3 });
    });

    it("AP-32b: should list the ambiguous localities apart from the not found ones", () => {
      const view = buildActualizarReportView(
        resultWithSkipped({
          byLocalityAndReason: [
            localityGroup("LA PAZ", "VILLA", SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, 3),
            localityGroup("ORURO", "X", SKIP_REASON.LOCALIDAD_AMBIGUA, 4),
          ],
        }),
      );

      expect(view.localitiesAmbiguous).toEqual([expect.objectContaining({ department: "ORURO", locality: "X", count: 4 })]);
    });

    it("AP-32b: should show a non-empty text for an unnamed department or locality", () => {
      const view = buildActualizarReportView(
        resultWithSkipped({
          byLocalityAndReason: [localityGroup(null, null, SKIP_REASON.LOCALIDAD_AMBIGUA, 2)],
        }),
      );

      for (const field of [view.localitiesAmbiguous[0].department, view.localitiesAmbiguous[0].locality]) {
        expect(field.trim().length).toBeGreaterThan(0);
        expect(field).not.toMatch(/null|undefined/);
      }
    });

    it("AP-32b: should cap each locality list at twenty groups", () => {
      const groups = Array.from({ length: 25 }, (_, index) =>
        localityGroup("LA PAZ", `LOC ${index}`, SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, 25 - index),
      );
      const view = buildActualizarReportView(resultWithSkipped({ byLocalityAndReason: groups }));

      expect(view.localitiesNotFound).toHaveLength(LIMIT);
    });

    it("AP-32b: should give empty lists when no locality group has the reason", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.localitiesNotFound).toEqual([]);
      expect(view.localitiesAmbiguous).toEqual([]);
    });
  });

  describe("banners", () => {
    it("AP-17: should show the dry-run banner for an analysis and no done banner", () => {
      const view = buildActualizarReportView(actualizarResultOf({ dryRun: true, tempModified: false }));

      expect(bannerKinds(view)).toContain("dryRun");
      expect(bannerKinds(view)).not.toContain("done");
      expect(view.banners.find((banner) => banner.kind === "dryRun")?.text).toMatch(/tabla de trabajo/i);
    });

    it("AP-17: should show the done banner for a committed run and no dry-run banner", () => {
      const view = buildActualizarReportView(actualizarResultOf({ dryRun: false, tempModified: true }));

      expect(bannerKinds(view)).toContain("done");
      expect(bannerKinds(view)).not.toContain("dryRun");
      expect(bannerKinds(view)).not.toContain("unknown");
    });

    it("AP-19: should show the unknown banner asking to verify the work table when the outcome is unknown", () => {
      const view = buildActualizarReportView(actualizarResultOf({ outcomeUnknown: true, tempModified: false }));
      const unknown = view.banners.find((banner) => banner.kind === "unknown");

      expect(unknown?.text).toMatch(/verific/i);
      expect(unknown?.text).toMatch(/tabla de trabajo/i);
      expect(bannerKinds(view)).not.toContain("done");
    });

    it("AP-16: should show the warning banner when the report carries warnings", () => {
      const view = buildActualizarReportView(actualizarResultOf({ warnings: ["Hay filas omitidas."] }));

      expect(bannerKinds(view)).toContain("warning");
    });

    it("AP-16: should not show the warning banner without warnings", () => {
      expect(bannerKinds(buildActualizarReportView(actualizarResultOf({ warnings: [] })))).not.toContain("warning");
    });

    it("AP-17: should put the outcome banner first", () => {
      const view = buildActualizarReportView(actualizarResultOf({ dryRun: true, tempModified: false, warnings: ["x"] }));

      expect(view.banners[0].kind).toBe("dryRun");
    });

    it("AP-34: should never repeat a banner kind", () => {
      const view = buildActualizarReportView(actualizarResultOf({ dryRun: true, tempModified: false, warnings: ["x", "y"] }));

      expect(new Set(bannerKinds(view)).size).toBe(bannerKinds(view).length);
    });

    it("AP-17: should never report the padron as modified in any banner", () => {
      const results: ActualizarPadronResult[] = [
        actualizarResultOf({ dryRun: true, tempModified: false }),
        actualizarResultOf({ dryRun: false, tempModified: true }),
        actualizarResultOf({ outcomeUnknown: true, tempModified: false }),
      ];

      for (const result of results) {
        for (const banner of buildActualizarReportView(result).banners) {
          expect(banner.text).not.toMatch(/padron.*modificad/i);
        }
      }
    });
  });
});
