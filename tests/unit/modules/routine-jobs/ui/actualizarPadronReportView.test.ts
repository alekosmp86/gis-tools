import { describe, expect, it } from "vitest";
import { buildActualizarReportView } from "@/modules/routine-jobs/ui/actualizarPadronReportView";
import { SKIP_REASON, type SkipReason } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { ActualizarPadronResult, CollidingKey, SkippedSample } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { actualizarResultOf } from "../wizard/actualizarFixtures";

const ALL_REASONS = Object.values(SKIP_REASON) as SkipReason[];
const LIMIT = 20;

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

describe("actualizarPadronReportView", () => {
  describe("totals", () => {
    it("AP-34: should list the five totals in the documented order", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.totals.map((row) => row.value)).toEqual([1000, 950, 950, 4, 50]);
    });

    it("AP-34: should give every total a non-empty Spanish label", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      for (const row of view.totals) {
        expect(row.label.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("skipped rows by reason", () => {
    it("AP-34: should list one row for every skip reason", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.skippedByReason.map((row) => row.reason).sort()).toEqual([...ALL_REASONS].sort());
    });

    it("AP-34: should zero-fill the reasons that skipped nothing", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.skippedByReason.find((row) => row.reason === SKIP_REASON.PROVINCIA_AMBIGUA)?.value).toBe(0);
    });

    it("AP-34: should carry the counts of the reasons that skipped rows", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.skippedByReason.find((row) => row.reason === SKIP_REASON.CLAVE_DUPLICADA)?.value).toBe(15);
      expect(view.skippedByReason.find((row) => row.reason === SKIP_REASON.LOCALIDAD_NO_ENCONTRADA)?.value).toBe(20);
    });

    it("AP-34: should give every reason a distinct Spanish label that is not its code", () => {
      const view = buildActualizarReportView(actualizarResultOf());
      const labels = view.skippedByReason.map((row) => row.label);

      expect(new Set(labels).size).toBe(ALL_REASONS.length);
      for (const row of view.skippedByReason) {
        expect(row.label.trim().length, row.reason).toBeGreaterThan(0);
        expect(row.label, row.reason).not.toBe(row.reason);
      }
    });

    it("AP-34: should show zero rows for every reason when nothing was skipped", () => {
      const result = actualizarResultOf({
        totals: { rowsRead: 10, accepted: 10, written: 10, repaired: 0, skipped: 0 },
        skipped: { ...actualizarResultOf().skipped, byReason: zeroReasons(), collidingKeys: [], collidingKeyCount: 0 },
      });

      expect(buildActualizarReportView(result).skippedByReason.every((row) => row.value === 0)).toBe(true);
    });
  });

  describe("departments, localities and samples", () => {
    it("AP-34: should map a null department name to a non-empty text, never to null", () => {
      const view = buildActualizarReportView(actualizarResultOf());
      const unnamed = view.byDepartment.find((group) => group.count === 20);

      expect(unnamed?.name.trim().length).toBeGreaterThan(0);
      expect(unnamed?.name).not.toMatch(/null|undefined/);
    });

    it("AP-34: should keep the named department groups and their counts", () => {
      const view = buildActualizarReportView(actualizarResultOf());

      expect(view.byDepartment[0]).toMatchObject({ name: "LA PAZ", count: 30 });
      expect(view.byLocality[0]).toMatchObject({ name: "VILLA", count: 12 });
    });

    it("AP-34: should cap the department and locality groups at 20 rows", () => {
      const groups = Array.from({ length: 25 }, (_, index) => ({ name: `G${index}`, count: 25 - index }));
      const view = buildActualizarReportView(
        actualizarResultOf({ skipped: { ...actualizarResultOf().skipped, byDepartment: groups, byLocality: groups } }),
      );

      expect(view.byDepartment).toHaveLength(LIMIT);
      expect(view.byLocality).toHaveLength(LIMIT);
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
      expect(view.byDepartment).toEqual([]);
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
