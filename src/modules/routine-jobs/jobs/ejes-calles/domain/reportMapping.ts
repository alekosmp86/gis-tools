import { listOf, nullableNumber, numberOf, textOf, type Row } from "../../shared/rowMapping";
import { shortNameOf } from "./shortName";
import { EJES_POINT_REASON, TWIN_CLASS, type EjesKeptByDiscardedReason, type EjesSkipReason, type GeoTwinRole, type ManualSplitReason, type RenumberSkipReason, type TwinClass } from "../constants";
import { ANALYSIS_LIST_ALIAS } from "./analysisSql";
import type {
  EjesStoredCandidate,
  EjesStoredReviewPoint,
  EjesAnalysis,
  EjesManualSplitIgnored,
  EjesAttrRow,
  EjesInvalidGeometryRow,
  EjesMergeRow,
  EjesNewStreetRow,
  EjesRenamedStreetRow,
  EjesKeptByDiscardedRow,
  EjesRemovalRow,
  EjesRenumberedRow,
  EjesRenumberDroppedRow,
  EjesRenumberSkippedRow,
  EjesSplitRow,
  EjesGeoTwinRow,
  EjesTwinCopy,
  EjesTwinRow,
  EjesTwinUndecidedRow,
  EjesStagingReport,
  EjesUnknownValue,
} from "../types";

const textsOf = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const unknownValueOf = (row: Row): EjesUnknownValue => ({ value: textOf(row.value), rows: numberOf(row.rows) });

const candidateOf = (row: Row): EjesStoredCandidate => ({ newRef: String(row.newRef), distance: nullableNumber(row.distance) });

const reviewPointOf = (row: Row): EjesStoredReviewPoint => ({
  oldRef: textOf(row.oldRef) ?? "",
  pointId: String(row.pointId),
  reason: row.reason === EJES_POINT_REASON.AMBIGUOUS ? EJES_POINT_REASON.AMBIGUOUS : EJES_POINT_REASON.NO_GEOMETRY,
  suggestedRef: textOf(row.suggestedRef),
  candidates: listOf(row.candidates).map(candidateOf),
});

const renamedStreetOf = (row: Row): EjesRenamedStreetRow => ({
  idcalle: String(row.idcalle),
  currentNames: textOf(row.currentNames),
  newName: textOf(row.newName),
  sections: numberOf(row.sections),
  ways: numberOf(row.ways),
  multiName: row.multiName === true,
});

const manualIgnoredOf = (row: Row): EjesManualSplitIgnored => ({
  oldRef: textOf(row.old_ref) ?? "",
  reason: String(row.reason) as ManualSplitReason,
});

const splitOf = (row: Row): EjesSplitRow => ({
  oldRef: textOf(row.old_ref) ?? "",
  idcalle: textOf(row.idcalle),
  newRefs: textsOf(row.new_refs),
  points: numberOf(row.points),
  refPoints: numberOf(row.ref_points),
  autoPoints: numberOf(row.auto_points),
  reviewPoints: numberOf(row.review_points),
  noGeometryPoints: numberOf(row.no_geometry_points),
  farPoints: numberOf(row.far_points),
  heldReason: (textOf(row.held_reason) as EjesSkipReason | null) ?? null,
  manual: row.manual === true,
  incompleteReview: row.review_incomplete === true,
  coverage: nullableNumber(row.coverage),
  oldLength: nullableNumber(row.old_length),
  newLength: nullableNumber(row.new_length),
  outsideLength: nullableNumber(row.outside_length),
});

const mergeOf = (row: Row): EjesMergeRow => ({
  newRef: String(row.new_ref),
  idcalle: textOf(row.idcalle),
  oldRefs: textsOf(row.old_refs),
  points: numberOf(row.points),
  coverage: nullableNumber(row.coverage),
  oldLength: nullableNumber(row.old_length),
  newLength: nullableNumber(row.new_length),
  outsideLength: nullableNumber(row.outside_length),
});

const renumberedOf = (row: Row): EjesRenumberedRow => ({
  oldRef: String(row.old_ref),
  newRef: String(row.new_ref),
  idcalle: textOf(row.idcalle),
  points: numberOf(row.points),
  oldLength: nullableNumber(row.old_length),
  newLength: nullableNumber(row.new_length),
  hausdorff: nullableNumber(row.hausdorff),
});

const renumberSkippedOf = (row: Row): EjesRenumberSkippedRow => ({
  oldRef: String(row.old_ref),
  newRef: String(row.new_ref),
  idcalle: textOf(row.idcalle),
  points: numberOf(row.points),
  reason: String(row.reason) as RenumberSkipReason,
});

const renumberDroppedOf = (row: Row): EjesRenumberDroppedRow => ({
  ref: String(row.ref),
  oldRef: String(row.old_ref),
  keptRef: String(row.kept_ref),
  hausdorff: nullableNumber(row.hausdorff),
  points: numberOf(row.points),
});

const removalOf = (row: Row): EjesRemovalRow => ({
  ref: textOf(row.ref) ?? "",
  idcalle: textOf(row.idcalle),
  points: numberOf(row.points),
});

const keptByDiscardedOf = (row: Row): EjesKeptByDiscardedRow => ({
  ref: textOf(row.ref) ?? "",
  idcalle: textOf(row.idcalle),
  points: numberOf(row.points),
  discardedRef: String(row.discarded_ref),
  reason: String(row.reason) as EjesKeptByDiscardedReason,
});

const streetOf = (row: Row): EjesNewStreetRow => {
  const name = textOf(row.name);
  return {
    idcalle: textOf(row.idcalle),
    name,
    shortName: name === null ? null : shortNameOf(name),
    sections: numberOf(row.sections),
    tipos: textOf(row.tipos),
    departments: textOf(row.departments),
    localities: textOf(row.localities),
  };
};

const invalidGeometryOf = (row: Row): EjesInvalidGeometryRow => ({
  ref: String(row.ref),
  idcalle: textOf(row.idcalle),
  localidad: textOf(row.localidad),
  departamento: textOf(row.departamento),
});

const attrOf = (row: Row): EjesAttrRow => ({
  ref: String(row.ref),
  name: textOf(row.name),
  currentName: textOf(row.current_name),
  idcalle: textOf(row.idcalle),
  currentIdcalle: textOf(row.current_idcalle),
  typeId: nullableNumber(row.type_id),
  currentTypeId: nullableNumber(row.current_type_id),
  fontId: nullableNumber(row.font_id),
  currentFontId: nullableNumber(row.current_font_id),
});

const twinClassOf = (value: unknown): TwinClass =>
  Object.values(TWIN_CLASS).find((twinClass) => twinClass === value) ?? TWIN_CLASS.NEITHER;

const twinOf = (row: Row): EjesTwinRow => ({
  ref: String(row.ref),
  idcalle: textOf(row.idcalle),
  department: textOf(row.department),
  localities: textsOf(row.localities),
  class: twinClassOf(row.class),
  length: nullableNumber(row.length),
  urbanLength: nullableNumber(row.urban_length),
  ruralLength: nullableNumber(row.rural_length),
  dropLocalities: textsOf(row.drop_localities),
  insideLocalities: textsOf(row.inside_localities),
});

const twinCopyOf = (row: Row): EjesTwinCopy => ({ department: textOf(row.department), locality: textOf(row.locality) });

const twinUndecidedOf = (row: Row): EjesTwinUndecidedRow => ({
  ref: String(row.ref),
  idcalle: textOf(row.idcalle),
  name: textOf(row.name),
  copies: listOf(row.copies).map(twinCopyOf),
  points: numberOf(row.points),
  waiting: numberOf(row.waiting),
});

const geoTwinOf = (row: Row): EjesGeoTwinRow => ({
  ref: String(row.ref),
  idcalle: textOf(row.idcalle),
  localidad: textOf(row.localidad),
  groupKey: String(row.groupKey),
  partners: (textOf(row.partners) ?? "").split(",").filter((ref) => ref !== ""),
  role: String(row.role) as GeoTwinRole,
  inCarto: row.inCarto === true,
  points: numberOf(row.points),
  pointsById: numberOf(row.pointsById),
  removable: row.removable === true,
  winnerRef: String(row.winnerRef),
  winnerPoints: numberOf(row.winnerPoints),
  winnerLength: nullableNumber(row.winnerLength),
  winnerFuente: textOf(row.winnerFuente),
  winnerInCarto: row.winnerInCarto === true,
});

export function toEjesStagingReport(row: Row): EjesStagingReport {
  return {
    rows: numberOf(row.rows),
    distinctRefs: numberOf(row.distinct_refs),
    repeatedGroups: numberOf(row.repeated_groups),
    repeatedRows: numberOf(row.repeated_rows),
    nonIntegerRefs: numberOf(row.non_integer_refs),
    emptyGeometry: numberOf(row.empty_geometry),
    emptyIdcalle: numberOf(row.empty_idcalle),
    invalidGeometryRows: numberOf(row.invalid_geometry_rows),
    invalidGeometryRefs: numberOf(row.invalid_geometry_refs),
    invalidGeometries: listOf(row.invalid_geometries).map(invalidGeometryOf),
    damagedTextRows: numberOf(row.damaged_text_rows),
    unknownTipoRows: numberOf(row.unknown_tipo_rows),
    unknownFuenteRows: numberOf(row.unknown_fuente_rows),
    unknownTipos: listOf(row.unknown_tipos).map(unknownValueOf),
    unknownFuentes: listOf(row.unknown_fuentes).map(unknownValueOf),
  };
}

export function toEjesAnalysis(row: Row): EjesAnalysis {
  return {
    counts: {
      newSections: numberOf(row.new_sections),
      unchanged: numberOf(row.unchanged),
      attr: numberOf(row.attr),
      geom: numberOf(row.geom),
      both: numberOf(row.both),
      removed: numberOf(row.removed),
      splits: numberOf(row.splits),
      replacements: numberOf(row.replacements),
      merges: numberOf(row.merges),
      plainRemovals: numberOf(row.plain_removals),
      plainHeld: numberOf(row.plain_held),
      keptByDiscardedCandidate: numberOf(row.kept_by_discarded_candidate),
      newStreets: numberOf(row.new_streets),
      renamedStreets: numberOf(row.renamed_streets),
      renamedStreetsHeld: numberOf(row.renamed_streets_held),
      twins: numberOf(row.twins),
      geoTwinGroups: numberOf(row.geo_twin_groups),
      geoTwinSections: numberOf(row.geo_twin_sections),
      geoTwinLosersOmitted: numberOf(row.geo_twin_losers_omitted),
      geoTwinLosersRemovable: numberOf(row.geo_twin_losers_removable),
      geoTwinSkippedRefs: numberOf(row.geo_twin_skipped_refs),
      twinsUrban: numberOf(row.twins_urban),
      twinsRural: numberOf(row.twins_rural),
      twinsBoth: numberOf(row.twins_both),
      twinsNeither: numberOf(row.twins_neither),
      twinsCrossDepartment: numberOf(row.twins_cross_department),
      twinsDrop: numberOf(row.twins_drop),
      twinsKeep: numberOf(row.twins_keep),
      twinsUndecided: numberOf(row.twins_undecided),
      twinPicksApplied: numberOf(row.twin_picks_applied),
      manualSplitsApplied: numberOf(row.manual_splits_applied),
      manualSplitsIgnored: numberOf(row.manual_splits_ignored),
      twinsDefaulted: numberOf(row.twins_defaulted),
      renumbered: numberOf(row.renumbered),
      renumberedWithPoints: numberOf(row.renumbered_with_points),
      renumberedPoints: numberOf(row.renumbered_points),
      renumberedByGeometry: numberOf(row.renumbered_by_geometry),
      renumberDroppedCandidates: numberOf(row.renumber_dropped_candidates),
      renumberSkipped: numberOf(row.renumber_skipped),
      splitPointsTotal: numberOf(row.split_points),
      splitPointsAuto: numberOf(row.split_points_auto),
      splitPointsReview: numberOf(row.split_points_review),
      splitPointsNoGeometry: numberOf(row.split_points_no_geometry),
      splitPointsFar: numberOf(row.split_points_far),
    },
    cloc: {
      withLocality: numberOf(row.with_locality),
      onlyDepartment: numberOf(row.only_department),
      withoutCode: numberOf(row.without_code),
    },
    splits: listOf(row[ANALYSIS_LIST_ALIAS.SPLITS]).map(splitOf),
    reviewPoints: listOf(row.review_points).map(reviewPointOf),
    merges: listOf(row[ANALYSIS_LIST_ALIAS.MERGES]).map(mergeOf),
    plainRemovals: listOf(row[ANALYSIS_LIST_ALIAS.PLAIN]).map(removalOf),
    keptByDiscarded: listOf(row[ANALYSIS_LIST_ALIAS.KEPT_BY_DISCARDED]).map(keptByDiscardedOf),
    newStreets: listOf(row[ANALYSIS_LIST_ALIAS.STREETS]).map(streetOf),
    renamedStreets: listOf(row[ANALYSIS_LIST_ALIAS.RENAMED]).map(renamedStreetOf),
    attrChanges: listOf(row[ANALYSIS_LIST_ALIAS.ATTRS]).map(attrOf),
    twins: listOf(row[ANALYSIS_LIST_ALIAS.TWINS]).map(twinOf),
    twinUndecided: listOf(row[ANALYSIS_LIST_ALIAS.TWIN_UNDECIDED]).map(twinUndecidedOf),
    geoTwins: listOf(row[ANALYSIS_LIST_ALIAS.GEO_TWINS]).map(geoTwinOf),
    renumbered: listOf(row[ANALYSIS_LIST_ALIAS.RENUMBERED]).map(renumberedOf),
    renumberSkipped: listOf(row[ANALYSIS_LIST_ALIAS.RENUMBER_SKIPPED]).map(renumberSkippedOf),
    renumberDropped: listOf(row[ANALYSIS_LIST_ALIAS.RENUMBER_DROPPED]).map(renumberDroppedOf),
    manualSplitsIgnored: listOf(row[ANALYSIS_LIST_ALIAS.MANUAL_IGNORED]).map(manualIgnoredOf),
    fingerprint: { rows: numberOf(row.staging_rows), digest: textOf(row.staging_digest) ?? "" },
  };
}
