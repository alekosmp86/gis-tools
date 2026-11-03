import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import {
  actualRemovalCountsOf,
  buildPadronTargetReport,
  plannedApplyOf,
  plannedRemovalOf,
  toPadronClassification,
  toPadronDeleteOutcome,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportMapping";
import { plannedStepLabels, STEP } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plannedSteps";
import type { PadronClassification } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const TARGET: WritableTargetLayout = {
  schema: "carto",
  table: "padron",
  columns: Object.fromEntries(Object.values(DESTINATION_COLUMN).map((column) => [column, column])),
  srid: 32721,
  idColumn: "id",
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const removedRowOf = (id: number) => ({
  id,
  typePadron: "URBANO",
  provinceId: 1,
  department: "MONTEVIDEO",
  localityId: 10,
  locality: "CENTRO",
  number: String(id),
});

const classificationOf = (row: Record<string, unknown> = {}): PadronClassification =>
  toPadronClassification({
    new: 0,
    removed: 4,
    removals_skipped_still_pairable: 2,
    removals_skipped_now_referenced: 1,
    removals_skipped_unverified: 0,
    removed_list: [removedRowOf(1), removedRowOf(2)],
    ...row,
  });

describe("toPadronClassification removal counts (AP-105)", () => {
  it("should map removed and the three skip reasons, with a total that is their sum", () => {
    const { counts } = classificationOf({ removals_skipped_unverified: 3 });

    expect(counts.removed).toBe(4);
    expect(counts.removalsSkipped).toEqual({ total: 6, byReason: { STILL_PAIRABLE: 2, NOW_REFERENCED: 1, UNVERIFIED: 3 } });
  });

  it("should read missing removal columns as zero", () => {
    const { counts } = toPadronClassification({});

    expect(counts.removed).toBe(0);
    expect(counts.removalsSkipped).toEqual({ total: 0, byReason: { STILL_PAIRABLE: 0, NOW_REFERENCED: 0, UNVERIFIED: 0 } });
  });

  it("should read bigint-as-text counts as numbers", () => {
    const { counts } = classificationOf({ removed: "12", removals_skipped_now_referenced: "5" });

    expect(counts.removed).toBe(12);
    expect(counts.removalsSkipped.byReason.NOW_REFERENCED).toBe(5);
  });

  it("should map the capped removed list to padron rows with their names", () => {
    const { removedList } = classificationOf();

    expect(removedList).toEqual([removedRowOf(1), removedRowOf(2)]);
  });

  it("should map no removed list to an empty list", () => {
    expect(toPadronClassification({}).removedList).toEqual([]);
  });

  it("should map the removalReason of each missing review row, null for a padron to be deleted and null for an unknown value", () => {
    const base = { oldId: 1, class: "ORPHAN" };

    const { missingReview } = toPadronClassification({
      missing_review: [
        { ...base, oldId: 1, removalReason: null },
        { ...base, oldId: 2, removalReason: "NOW_REFERENCED", refsTotal: 2, refsByTable: { "carto.access_point": 2 } },
        { ...base, oldId: 3, removalReason: "NO_LONGER_MISSING" },
        { ...base, oldId: 4, removalReason: "UNVERIFIED" },
      ],
    });

    expect(missingReview.map((entry) => entry.removalReason)).toEqual([null, "NOW_REFERENCED", null, "UNVERIFIED"]);
    expect(missingReview[1].refs).toEqual({ total: 2, byTable: { "carto.access_point": 2 } });
  });
});

describe("toPadronDeleteOutcome (AP-106)", () => {
  it("should map the surviving, deleted counts and the capped list", () => {
    const outcome = toPadronDeleteOutcome({ surviving: "3", deleted: 3, removed_list: [removedRowOf(7)] });

    expect(outcome).toEqual({ deleted: 3, surviving: 3, removedList: [removedRowOf(7)] });
  });

  it("should read an empty delete row as zero deleted and an empty list", () => {
    expect(toPadronDeleteOutcome({})).toEqual({ deleted: 0, surviving: 0, removedList: [] });
  });
});

describe("plannedRemovalOf (AP-107)", () => {
  it("should carry the classification's own removed count, skips and list for an analysis", () => {
    const classification = classificationOf();

    expect(plannedRemovalOf(classification)).toEqual({
      removed: 4,
      removalsSkipped: { total: 3, byReason: { STILL_PAIRABLE: 2, NOW_REFERENCED: 1, UNVERIFIED: 0 } },
      removedList: [removedRowOf(1), removedRowOf(2)],
    });
  });
});

describe("actualRemovalCountsOf (AP-106)", () => {
  it("should report the deleted count and the delete statement's list, keeping the planned skips, when every candidate was deleted", () => {
    const result = actualRemovalCountsOf(classificationOf(), { deleted: 4, surviving: 4, removedList: [removedRowOf(9)] });

    expect(result.removed).toBe(4);
    expect(result.removedList).toEqual([removedRowOf(9)]);
    expect(result.removalsSkipped).toEqual({ total: 3, byReason: { STILL_PAIRABLE: 2, NOW_REFERENCED: 1, UNVERIFIED: 0 } });
  });

  it("should count an id referenced since the classify as NOW_REFERENCED, growing the total by the same amount", () => {
    const result = actualRemovalCountsOf(classificationOf(), { deleted: 3, surviving: 3, removedList: [] });

    expect(result.removed).toBe(3);
    expect(result.removalsSkipped.byReason).toEqual({ STILL_PAIRABLE: 2, NOW_REFERENCED: 2, UNVERIFIED: 0 });
    expect(result.removalsSkipped.total).toBe(4);
  });

  it("should count every candidate as newly referenced when the delete statement deleted none", () => {
    const result = actualRemovalCountsOf(classificationOf(), { deleted: 0, surviving: 0, removedList: [] });

    expect(result.removed).toBe(0);
    expect(result.removalsSkipped.byReason.NOW_REFERENCED).toBe(5);
    expect(result.removalsSkipped.total).toBe(7);
  });

  it("should keep removed plus skipped equal to the classified missing padrones that were eligible or held back", () => {
    const classification = classificationOf();
    const plannedTotal = classification.counts.removed + classification.counts.removalsSkipped.total;

    const result = actualRemovalCountsOf(classification, { deleted: 1, surviving: 1, removedList: [] });

    expect(result.removed + result.removalsSkipped.total).toBe(plannedTotal);
  });

  it("should not mutate the classification's planned skips", () => {
    const classification = classificationOf();

    actualRemovalCountsOf(classification, { deleted: 0, surviving: 0, removedList: [] });

    expect(classification.counts.removalsSkipped.byReason.NOW_REFERENCED).toBe(1);
  });
});

describe("buildPadronTargetReport removal fields (AP-108)", () => {
  const reportOf = (removalBlockedReason: string | null) => {
    const classification = classificationOf();
    return buildPadronTargetReport({
      target: TARGET,
      classification,
      apply: plannedApplyOf(classification.counts),
      removal: plannedRemovalOf(classification),
      removalBlockedReason,
      updateGeometries: true,
    });
  };

  it("should carry removed, removalsSkipped and removedList on the target report", () => {
    const report = reportOf(null);

    expect(report.removed).toBe(4);
    expect(report.removalsSkipped?.total).toBe(3);
    expect(report.removedList).toEqual([removedRowOf(1), removedRowOf(2)]);
  });

  it("should leave removalBlockedReason out of the report when the scan was not blocked", () => {
    expect(reportOf(null)).not.toHaveProperty("removalBlockedReason");
  });

  it("should carry the blocked reason when the scan was blocked", () => {
    const reason = "No se pueden leer las tablas que referencian padrones (carto.x): no se eliminan padrones faltantes.";

    expect(reportOf(reason).removalBlockedReason).toBe(reason);
  });
});

describe("plannedStepLabels removal step (AP-107)", () => {
  it("should name the delete step Eliminar padrones faltantes sin referencias", () => {
    expect(STEP.DELETE).toBe("Eliminar padrones faltantes sin referencias");
  });

  it("should place the delete step after Aplicar cambios de padrones and before Analizar tabla de destino in a real run", () => {
    const labels = plannedStepLabels({ dryRun: false });

    expect(labels.indexOf("Eliminar padrones faltantes sin referencias")).toBe(labels.indexOf("Aplicar cambios de padrones") + 1);
    expect(labels.indexOf("Eliminar padrones faltantes sin referencias")).toBeLessThan(labels.indexOf("Analizar tabla de destino"));
  });

  it("should leave the delete step out of an analysis", () => {
    expect(plannedStepLabels({ dryRun: true })).not.toContain("Eliminar padrones faltantes sin referencias");
  });
});
