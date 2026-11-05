import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import {
  actualRemovalCountsOf,
  buildPadronTargetReport,
  plannedApplyOf,
  plannedRemovalOf,
  toPadronClassification,
  toPadronDeleteOutcome,
  toPadronReassignChangedOutcome,
  toPadronReassignOutcome,
  NO_REASSIGN_CHANGED_OUTCOME,
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
  it("should map removed and the four skip reasons, with a total that is their sum", () => {
    const { counts } = classificationOf({ removals_skipped_unverified: 3 });

    expect(counts.removed).toBe(4);
    expect(counts.removalsSkipped).toEqual({ total: 6, byReason: { STILL_PAIRABLE: 2, NOW_REFERENCED: 1, NOT_REASSIGNABLE: 0, UNVERIFIED: 3 } });
  });

  it("should read missing removal columns as zero", () => {
    const { counts } = toPadronClassification({});

    expect(counts.removed).toBe(0);
    expect(counts.removalsSkipped).toEqual({ total: 0, byReason: { STILL_PAIRABLE: 0, NOW_REFERENCED: 0, NOT_REASSIGNABLE: 0, UNVERIFIED: 0 } });
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

describe("toPadronDeleteOutcome master count (AP-114)", () => {
  it("should map master_deleted as masterDeleted", () => {
    expect(toPadronDeleteOutcome({ surviving: 2, deleted: 2, master_deleted: "2" }).masterDeleted).toBe(2);
  });
});

describe("toPadronReassignOutcome (AP-113)", () => {
  it("should map moved, padrones and per-table counts, reading bigint text as numbers", () => {
    expect(toPadronReassignOutcome({ moved: "5", padrones: 2, without_point: "2", by_table: { "carto.a": "5" } })).toEqual({
      moved: 5,
      padrones: 2,
      withoutPoint: 2,
      byTable: { "carto.a": 5 },
    });
  });

  it("should read an empty row as zero moved and no tables, and a non-object by_table as no tables", () => {
    expect(toPadronReassignOutcome({})).toEqual({ moved: 0, padrones: 0, withoutPoint: 0, byTable: {} });
    expect(toPadronReassignOutcome({ by_table: "x" }).byTable).toEqual({});
    expect(toPadronReassignOutcome({ by_table: null }).byTable).toEqual({});
  });
});

describe("toPadronClassification reassign fields (AP-112)", () => {
  it("should map the not-reassignable skip, the reassigned counts and the per-table map", () => {
    const { counts } = classificationOf({
      removals_skipped_not_reassignable: 4,
      reassigned: 9,
      subdivided_deleted: 3,
      reassigned_by_table: { "carto.t": 9 },
    });

    expect(counts.removalsSkipped.byReason.NOT_REASSIGNABLE).toBe(4);
    expect(counts.removalsSkipped.total).toBe(7);
    expect(counts.reassigned).toBe(9);
    expect(counts.subdividedDeleted).toBe(3);
    expect(counts.reassignedByTable).toEqual({ "carto.t": 9 });
  });

  it("should map reassigned_without_point to reassignedWithoutPoint and read it as zero when absent", () => {
    expect(classificationOf({ reassigned_without_point: "3" }).counts.reassignedWithoutPoint).toBe(3);
    expect(toPadronClassification({}).counts.reassignedWithoutPoint).toBe(0);
  });

  it("should read the reassign columns of an older result as zero and an empty map", () => {
    const { counts } = toPadronClassification({});

    expect(counts.reassigned).toBe(0);
    expect(counts.subdividedDeleted).toBe(0);
    expect(counts.reassignedByTable).toEqual({});
  });

  it("should map reassignBlockers of a missing review row to table and reason, empty when absent or not an object", () => {
    const { missingReview } = toPadronClassification({
      missing_review: [
        { oldId: 1, class: "SUBDIVIDED", removalReason: "NOT_REASSIGNABLE", reassignBlockers: { "carto.t": "sin clave primaria de una sola columna" } },
        { oldId: 2, class: "SUBDIVIDED" },
        { oldId: 3, class: "SUBDIVIDED", reassignBlockers: "x" },
      ],
    });

    expect(missingReview[0].reassignBlockers).toEqual({ "carto.t": "sin clave primaria de una sola columna" });
    expect(missingReview[0].removalReason).toBe("NOT_REASSIGNABLE");
    expect(missingReview[1].reassignBlockers).toEqual({});
    expect(missingReview[2].reassignBlockers).toEqual({});
  });
});

describe("toPadronDeleteOutcome (AP-106)", () => {
  it("should map the surviving, deleted counts and the capped list", () => {
    const outcome = toPadronDeleteOutcome({ surviving: "3", deleted: 3, removed_list: [removedRowOf(7)] });

    expect(outcome).toEqual({ deleted: 3, surviving: 3, masterDeleted: 0, removedList: [removedRowOf(7)] });
  });

  it("should read an empty delete row as zero deleted and an empty list", () => {
    expect(toPadronDeleteOutcome({})).toEqual({ deleted: 0, surviving: 0, masterDeleted: 0, removedList: [] });
  });
});

describe("plannedRemovalOf (AP-107)", () => {
  it("should carry the classification's own removed count, skips and list for an analysis", () => {
    const classification = classificationOf();

    expect(plannedRemovalOf(classification)).toEqual({
      removed: 4,
      removalsSkipped: { total: 3, byReason: { STILL_PAIRABLE: 2, NOW_REFERENCED: 1, NOT_REASSIGNABLE: 0, UNVERIFIED: 0 } },
      removedList: [removedRowOf(1), removedRowOf(2)],
      reassigned: 0,
      reassignedByTable: {},
      reassignedWithoutPoint: 0,
      reassignedChanged: 0,
      reassignedChangedAmbiguous: 0,
      reassignedChangedByTable: {},
    });
  });

  it("should carry the classification's reassigned rows and per-table counts for an analysis", () => {
    const classification = classificationOf({ reassigned: 7, subdivided_deleted: 2, reassigned_by_table: { "carto.a": 5, "carto.b": "2" } });

    const planned = plannedRemovalOf(classification);

    expect(planned.reassigned).toBe(7);
    expect(planned.reassignedByTable).toEqual({ "carto.a": 5, "carto.b": 2 });
    expect(classification.counts.subdividedDeleted).toBe(2);
  });
});

describe("actualRemovalCountsOf (AP-106)", () => {
  it("should report the deleted count and the delete statement's list, keeping the planned skips, when every candidate was deleted", () => {
    const result = actualRemovalCountsOf(classificationOf(), { deleted: 4, surviving: 4, masterDeleted: 0, removedList: [removedRowOf(9)] });

    expect(result.removed).toBe(4);
    expect(result.removedList).toEqual([removedRowOf(9)]);
    expect(result.removalsSkipped).toEqual({ total: 3, byReason: { STILL_PAIRABLE: 2, NOW_REFERENCED: 1, NOT_REASSIGNABLE: 0, UNVERIFIED: 0 } });
  });

  it("should count an id referenced since the classify as NOW_REFERENCED, growing the total by the same amount", () => {
    const result = actualRemovalCountsOf(classificationOf(), { deleted: 3, surviving: 3, masterDeleted: 0, removedList: [] });

    expect(result.removed).toBe(3);
    expect(result.removalsSkipped.byReason).toEqual({ STILL_PAIRABLE: 2, NOW_REFERENCED: 2, NOT_REASSIGNABLE: 0, UNVERIFIED: 0 });
    expect(result.removalsSkipped.total).toBe(4);
  });

  it("should count every candidate as newly referenced when the delete statement deleted none", () => {
    const result = actualRemovalCountsOf(classificationOf(), { deleted: 0, surviving: 0, masterDeleted: 0, removedList: [] });

    expect(result.removed).toBe(0);
    expect(result.removalsSkipped.byReason.NOW_REFERENCED).toBe(5);
    expect(result.removalsSkipped.total).toBe(7);
  });

  it("should keep removed plus skipped equal to the classified missing padrones that were eligible or held back", () => {
    const classification = classificationOf();
    const plannedTotal = classification.counts.removed + classification.counts.removalsSkipped.total;

    const result = actualRemovalCountsOf(classification, { deleted: 1, surviving: 1, masterDeleted: 0, removedList: [] });

    expect(result.removed + result.removalsSkipped.total).toBe(plannedTotal);
  });

  it("should not mutate the classification's planned skips", () => {
    const classification = classificationOf();

    actualRemovalCountsOf(classification, { deleted: 0, surviving: 0, masterDeleted: 0, removedList: [] });

    expect(classification.counts.removalsSkipped.byReason.NOW_REFERENCED).toBe(1);
  });
});

describe("actualRemovalCountsOf reassign outcome (AP-113, AP-115)", () => {
  it("should report the rows the reassign statement moved, per table, instead of the planned ones", () => {
    const classification = classificationOf({ reassigned: 5 });

    const result = actualRemovalCountsOf(classification, { deleted: 4, surviving: 4, masterDeleted: 1, removedList: [] }, { moved: 5, byTable: { "carto.a": 5 }, withoutPoint: 2, padrones: 1 });

    expect(result.reassigned).toBe(5);
    expect(result.reassignedByTable).toEqual({ "carto.a": 5 });
    expect(result.reassignedWithoutPoint).toBe(2);
  });

  it("should report zero reassigned when no reassign outcome is given", () => {
    const result = actualRemovalCountsOf(classificationOf({ reassigned: 5 }), { deleted: 4, surviving: 4, masterDeleted: 0, removedList: [] });

    expect(result.reassigned).toBe(0);
    expect(result.reassignedByTable).toEqual({});
  });

  it("should carry reassigned and reassignedByTable on the target report", () => {
    const classification = classificationOf({ reassigned: 5, reassigned_by_table: { "carto.a": 5 } });

    const report = buildPadronTargetReport({
      target: TARGET,
      classification,
      apply: plannedApplyOf(classification.counts),
      removal: plannedRemovalOf(classification),
      removalBlockedReason: null,
      updateGeometries: true,
    });

    expect(report.reassigned).toBe(5);
    expect(report.reassignedByTable).toEqual({ "carto.a": 5 });
  });

  it("should carry reassignedWithoutPoint of the classification on the planned removal and the target report", () => {
    const classification = classificationOf({ reassigned: 5, reassigned_without_point: 2 });

    const report = buildPadronTargetReport({
      target: TARGET,
      classification,
      apply: plannedApplyOf(classification.counts),
      removal: plannedRemovalOf(classification),
      removalBlockedReason: null,
      updateGeometries: true,
    });

    expect(plannedRemovalOf(classification).reassignedWithoutPoint).toBe(2);
    expect(report.reassignedWithoutPoint).toBe(2);
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
    const labels = plannedStepLabels({ repairSequences: true, dryRun: false });

    expect(labels.indexOf("Eliminar padrones faltantes sin referencias")).toBe(labels.indexOf("Reasignar direcciones de padrones modificados") + 1);
    expect(labels.indexOf("Reasignar direcciones de padrones modificados")).toBe(labels.indexOf("Reasignar direcciones de padrones subdivididos") + 1);
    expect(labels.indexOf("Reasignar direcciones de padrones subdivididos")).toBe(labels.indexOf("Aplicar cambios de padrones") + 1);
    expect(labels.indexOf("Eliminar padrones faltantes sin referencias")).toBeLessThan(labels.indexOf("Analizar tabla de destino"));
  });

  it("should leave the delete step out of an analysis", () => {
    expect(plannedStepLabels({ repairSequences: true, dryRun: true })).not.toContain("Eliminar padrones faltantes sin referencias");
  });
});

describe("changed-padron reassignment mapping (AP-122, AP-123, AP-124)", () => {
  const deleted = { deleted: 4, surviving: 4, masterDeleted: 0, removedList: [] };

  it("should map the planned counts of the classify row, reading absent columns as zero", () => {
    const { counts } = classificationOf({ reassigned_changed: "6", reassigned_changed_ambiguous: 2, reassigned_changed_by_table: { "carto.a": "4", "carto.b": 2 } });

    expect(counts.reassignedChanged).toBe(6);
    expect(counts.reassignedChangedAmbiguous).toBe(2);
    expect(counts.reassignedChangedByTable).toEqual({ "carto.a": 4, "carto.b": 2 });
    expect(toPadronClassification({}).counts.reassignedChanged).toBe(0);
    expect(toPadronClassification({}).counts.reassignedChangedAmbiguous).toBe(0);
    expect(toPadronClassification({}).counts.reassignedChangedByTable).toEqual({});
  });

  it("should carry the planned counts on the planned removal and the target report of an analysis", () => {
    const classification = classificationOf({ reassigned_changed: 3, reassigned_changed_ambiguous: 1, reassigned_changed_by_table: { "carto.a": 3 } });

    const planned = plannedRemovalOf(classification);
    const report = buildPadronTargetReport({
      target: TARGET,
      classification,
      apply: plannedApplyOf(classification.counts),
      removal: planned,
      removalBlockedReason: null,
      updateGeometries: true,
    });

    expect(planned.reassignedChanged).toBe(3);
    expect(report.reassignedChanged).toBe(3);
    expect(report.reassignedChangedAmbiguous).toBe(1);
    expect(report.reassignedChangedByTable).toEqual({ "carto.a": 3 });
  });

  it("should map moved, selected, ambiguous and per-table of the statement row", () => {
    const outcome = toPadronReassignChangedOutcome({ moved: "5", selected: 5, ambiguous: "1", by_table: { "carto.a": 5 } });

    expect(outcome).toEqual({ moved: 5, selected: 5, ambiguous: 1, byTable: { "carto.a": 5 } });
  });

  it("should map an empty statement row to the zero outcome", () => {
    expect(toPadronReassignChangedOutcome({})).toEqual(NO_REASSIGN_CHANGED_OUTCOME);
    expect(NO_REASSIGN_CHANGED_OUTCOME).toEqual({ moved: 0, selected: 0, ambiguous: 0, byTable: {} });
  });

  it("should report the rows the statement reassigned instead of the planned ones in a real run", () => {
    const classification = classificationOf({ reassigned_changed: 9, reassigned_changed_ambiguous: 9, reassigned_changed_by_table: { "carto.z": 9 } });

    const result = actualRemovalCountsOf(classification, deleted, undefined, { moved: 4, selected: 4, ambiguous: 1, byTable: { "carto.a": 4 } });

    expect(result.reassignedChanged).toBe(4);
    expect(result.reassignedChangedAmbiguous).toBe(1);
    expect(result.reassignedChangedByTable).toEqual({ "carto.a": 4 });
  });

  it("should report zero changed-padron reassignments when no outcome is given", () => {
    const result = actualRemovalCountsOf(classificationOf({ reassigned_changed: 9 }), deleted);

    expect(result.reassignedChanged).toBe(0);
    expect(result.reassignedChangedAmbiguous).toBe(0);
    expect(result.reassignedChangedByTable).toEqual({});
  });

  it("should keep the subdivided and the changed-padron counts separate on the real-run report", () => {
    const classification = classificationOf();
    const report = buildPadronTargetReport({
      target: TARGET,
      classification,
      apply: plannedApplyOf(classification.counts),
      removal: actualRemovalCountsOf(
        classification,
        deleted,
        { moved: 7, byTable: { "carto.s": 7 }, withoutPoint: 0, padrones: 1 },
        { moved: 2, selected: 2, ambiguous: 0, byTable: { "carto.c": 2 } }
      ),
      removalBlockedReason: null,
      updateGeometries: true,
    });

    expect(report.reassigned).toBe(7);
    expect(report.reassignedChanged).toBe(2);
    expect(report.reassignedChangedByTable).toEqual({ "carto.c": 2 });
  });
});
