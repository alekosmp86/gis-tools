import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { TableLayout } from "../../actualizar-padron/domain/layouts";
import type { TargetApplyOutcome, TargetClassification, TargetReport } from "../types";

interface TargetReportInput {
  target: TableLayout;
  classification: TargetClassification;
  apply: TargetApplyOutcome;
  updateGeometries: boolean;
}

export const targetLabelOf = (target: TableLayout): string => buildQualifiedTableLabel(target.schema, target.table);

export function buildTargetReport({ target, classification, apply, updateGeometries }: TargetReportInput): TargetReport {
  const { counts } = classification;
  return {
    table: targetLabelOf(target),
    inserted: apply.inserted,
    insertedList: apply.insertedList,
    updated: apply.updated,
    updateApplied: updateGeometries,
    unchanged: counts.unchanged,
    unchangedWithinTolerance: counts.withinTolerance,
    changed: counts.changed,
    missing: counts.missing,
    missingSamples: classification.missingSamples,
    ambiguous: counts.ambiguous,
    ambiguousSamples: classification.ambiguousSamples,
    codeDiffers: counts.codeDiffers,
    codeDiffersSamples: classification.codeDiffersSamples,
    geometryChanges: classification.geometryChanges,
  };
}

export function expectedUpdateCount(classification: TargetClassification, updateGeometries: boolean): number {
  return updateGeometries ? classification.counts.changed : 0;
}
