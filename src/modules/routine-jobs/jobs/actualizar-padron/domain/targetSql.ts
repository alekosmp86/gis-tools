import {
  areaRatioOf,
  geometriesEqualSql,
  hausdorffDistanceSql,
  matchClassSql,
  MATCH_CLASS,
} from "../../shared/geometryCompare";
import { DETAIL_LIST_LIMIT, PAIR_LIST_LIMIT, SAMPLE_LIMIT } from "../../shared/limits";
import { cte, jsonArrayOf, literal, q, withClause } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import {
  DESTINATION_COLUMN,
  GEOMETRY_STATE,
  LOCALITY_COLUMN,
  PAIR_AREA_RATIO_TOLERANCE,
  PAIR_LOOSE_AREA_RATIO_TOLERANCE,
  PAIR_LOOSE_OVERLAP_MIN,
  PAIR_OVERLAP_MIN,
  PAIR_STATUS,
  PAIR_TIER,
  REMOVAL_SKIP_REASON,
  REPLACEMENT_CLASS,
  type PairStatus,
  type PairTier,
  type RemovalSkipReason,
  STAGING_COLUMN,
} from "../constants";
import type { ActualizarPadronOptions, PadronLayouts } from "../types";
import { candidateCtes, DECIDED_CTE, SKIP_REASON_COLUMN } from "./classifySql";
import { CHOICE_OLD_ID_COLUMN, pairChoicesValuesSql } from "./pairChoicesSql";
import { geometryAcceptsValuesSql } from "./geometryAcceptsSql";
import { physicalColumn, qualifiedName } from "./layouts";
import { REVERT_COLUMN, REVERT_KIND, REVERT_TABLE_SQL, revertColumnList } from "./revertCapture";
import { DELETE_IDS_ID_COLUMN, DELETE_IDS_TABLE_SQL } from "./deleteIdsTable";
import { INSERTED_IDS_TABLE_SQL, SESSION_IDS_COLUMN } from "./reassignTables";
import { NO_REFERENCE_SCAN, type ReferenceScan } from "./referenceScan";
import { removedListSql } from "./removedListSql";
import {
  classificationCtes,
  MISSING_SCORED_CLASS_COLUMN,
  MISSING_SCORED_CTE,
  missingReviewSql,
  referenceBlockedColumnSql,
  referenceCountCtes,
  referenceJoinSql,
  referenceTotalColumnSql,
  REMOVAL_CTE,
  replacementCountSql,
  replacementLabelCtes,
} from "./replacementSql";
import {
  DELETE_WITHOUT_REASSIGN,
  reassignCountsSql,
  reassignDigestEntrySql,
  reassignFlagSql,
  reassignIdsInsertCte,
  VERDICT_COLUMN,
} from "./reassignClassifySql";

const TARGET_ALIAS = "tgt";
const MATCHED_TARGET_ALIAS = "t1";
const PLANNED_ALIAS = "pl";
const CHANGED_ALIAS = "cg";
const UNMATCHED_ALIAS = "ut";
const PAIRABLE_ALIAS = "pt";
const DECIDED_ALIAS = "dc";
const PAIR_CANDIDATE_ALIAS = "pc";
const PAIR_COUNTED_ALIAS = "cnt";
const PAIR_ALIAS = "pr";
const CHOICE_ALIAS = "ch";
const OTHER_CHOICE_ALIAS = "oc";
const ACCEPT_ALIAS = "ga";
const OLD_LOCALITY_ALIAS = "oldloc";
const NEW_LOCALITY_ALIAS = "newloc";
const CENTROID_ALIAS = "ctr";
const FOOTPRINT_ALIAS = "fa";
const TIER_ALIAS = "ft";
const DEPARTMENT_COLUMN = STAGING_COLUMN.NOMDEPTO;
const LOCALITY_NAME_COLUMN = STAGING_COLUMN.NOMLOCCAT;
const WGS84_SRID = 4326;

const CTE_TARGET = {
  CANDIDATES: "candidates",
  COUNTS: "target_counts",
  CANDIDATE_TARGETS: "candidate_targets",
  MATCHED: "matched",
  MEASURED: "measured",
  PLANNED: "planned",
  GEOMETRY_ACCEPTS: "geometry_accepts",
  CHANGED_GEOMETRY: "changed_geometry",
  UNMATCHED: "unmatched_targets",
  PAIRABLE: "pairable_targets",
  PAIR_CHOICES: "pair_choices",
  PAIR_CANDIDATES: "pair_candidates",
  PAIRS: "pairs",
  INSERTED: "inserted_rows",
  INSERTED_STORE: "inserted_ids_store",
  UPDATED: "updated_rows",
  PAIRED: "paired_rows",
  REVERT: "revert_rows",
} as const;

export interface ApplySqlOptions {
  captureRevert?: boolean;
  /** The real run stores the inserted ids in the session's temp table when it has addresses to reassign (AP-113). */
  storeInsertedIds?: boolean;
}

const PAIR_COLUMN = {
  TARGET_ID: "target_id",
  OLD_TYPE_PADRON: "old_type_padron",
  OLD_LOCALITY_ID: "old_id_cadastral_locality",
  OLD_NUMBER: "old_number",
  TARGET_GEOMETRY: "target_geometry",
  NEW_MATCHES: "new_matches",
  TARGET_MATCHES: "target_matches",
  CHOSEN: "chosen",
  STATUS: "status",
  TYPE_CHANGED: "type_changed",
  LOCALITY_CHANGED: "locality_changed",
  NUMBER_CHANGED: "number_changed",
  TIER: "tier",
} as const;

const CHANGED_COLUMN = {
  AREA_RATIO: "area_ratio",
  OLD_AREA: "old_area",
  NEW_AREA: "new_area",
  ACCEPTED: "accepted",
  APPLIED: "applied",
} as const;

const FOOTPRINT_AREA = {
  OVERLAP: "overlap_area",
  EXISTING: "existing_area",
  INCOMING: "incoming_area",
} as const;

interface PairTierBand {
  tier: PairTier;
  overlapMin: number;
  areaRatioTolerance: number;
}

const PAIR_TIER_BANDS: readonly PairTierBand[] = [
  { tier: PAIR_TIER.STRICT, overlapMin: PAIR_OVERLAP_MIN, areaRatioTolerance: PAIR_AREA_RATIO_TOLERANCE },
  { tier: PAIR_TIER.LOOSE, overlapMin: PAIR_LOOSE_OVERLAP_MIN, areaRatioTolerance: PAIR_LOOSE_AREA_RATIO_TOLERANCE },
];

const INSERT_COLUMNS: readonly string[] = [
  DESTINATION_COLUMN.TYPE_PADRON,
  DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY,
  DESTINATION_COLUMN.ID_PROVINCE,
  DESTINATION_COLUMN.NUMBER,
  DESTINATION_COLUMN.GEOMETRY,
];
const CANDIDATE_GEOMETRY = "candidate_geometry";
const KEY_COLUMNS: readonly string[] = [
  DESTINATION_COLUMN.TYPE_PADRON,
  DESTINATION_COLUMN.ID_PROVINCE,
  DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY,
  DESTINATION_COLUMN.NUMBER,
];
const UNMATCHED_COLUMNS: readonly string[] = [DESTINATION_COLUMN.ID, DESTINATION_COLUMN.GEOMETRY, ...KEY_COLUMNS];
const PAIRED_KEY_COLUMNS: readonly string[] = [
  DESTINATION_COLUMN.TYPE_PADRON,
  DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY,
  DESTINATION_COLUMN.NUMBER,
];

const targetOf = (target: WritableTargetLayout, logical: string): string => `${TARGET_ALIAS}.${physicalColumn(target, logical)}`;
const plannedOf = (column: string): string => `${PLANNED_ALIAS}.${q(column)}`;
const changedOf = (column: string): string => `${CHANGED_ALIAS}.${q(column)}`;
const unmatchedOf = (column: string): string => `${UNMATCHED_ALIAS}.${q(column)}`;
const pairableOf = (column: string): string => `${PAIRABLE_ALIAS}.${q(column)}`;
const pairOf = (column: string): string => `${PAIR_ALIAS}.${q(column)}`;
const classIs = (value: string): string => `${plannedOf("class")} = ${literal(value)}`;
const statusIs = (status: PairStatus): string => `${pairOf(PAIR_COLUMN.STATUS)} = ${literal(status)}`;
const appliedCondition = (): string => statusIs(PAIR_STATUS.APPLIED);
const targetTableSql = (target: WritableTargetLayout): string => `${qualifiedName(target)} AS ${TARGET_ALIAS}`;
const applyFlag = (options: ActualizarPadronOptions): string => String(options.updateGeometries);

/** NULL-safe key equality: a rural row has no locality id, and two NULL localities share the key. */
const sameKeySql = (left: string, right: string): string =>
  [
    ...KEY_COLUMNS.filter((column) => column !== DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY).map(
      (column) => `${left}.${q(column)} = ${right}.${q(column)}`
    ),
    `${left}.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} IS NOT DISTINCT FROM ${right}.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}`,
  ].join(" AND ");

const sameKeyAsTargetSql = (target: WritableTargetLayout, candidate: string): string =>
  [
    `${candidate}.${q(DESTINATION_COLUMN.TYPE_PADRON)} = ${targetOf(target, DESTINATION_COLUMN.TYPE_PADRON)}`,
    `${candidate}.${q(DESTINATION_COLUMN.ID_PROVINCE)} = ${targetOf(target, DESTINATION_COLUMN.ID_PROVINCE)}`,
    `${candidate}.${q(DESTINATION_COLUMN.NUMBER)} = ${targetOf(target, DESTINATION_COLUMN.NUMBER)}`,
    `${candidate}.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} IS NOT DISTINCT FROM ${targetOf(target, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}`,
  ].join(" AND ");

const keyListOf = (alias: string): string[] => [
  `${alias}.${q(DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron"`,
  `${alias}.${q(DESTINATION_COLUMN.ID_PROVINCE)} AS "provinceId"`,
  `${alias}.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS "localityId"`,
  `${alias}.${q(DESTINATION_COLUMN.NUMBER)} AS "number"`,
];

const aliasedTargetColumns = (target: WritableTargetLayout, logicals: readonly string[]): string =>
  logicals.map((logical) => `${targetOf(target, logical)} AS ${q(logical)}`).join(", ");

function candidatesCte(): string {
  return cte(
    CTE_TARGET.CANDIDATES,
    [
      `SELECT ${KEY_COLUMNS.map((column) => `d.${q(column)}`).join(", ")}, d.${q(DEPARTMENT_COLUMN)}, d.${q(LOCALITY_NAME_COLUMN)},`,
      `d.${q(DESTINATION_COLUMN.GEOMETRY)} AS ${q(CANDIDATE_GEOMETRY)}`,
      `FROM ${q(DECIDED_CTE)} AS d WHERE d.${q(SKIP_REASON_COLUMN)} IS NULL`,
    ].join(" ")
  );
}

function targetCountsCte(target: WritableTargetLayout): string {
  return cte(
    CTE_TARGET.COUNTS,
    [
      `SELECT ${targetOf(target, DESTINATION_COLUMN.TYPE_PADRON)} AS ${q(DESTINATION_COLUMN.TYPE_PADRON)},`,
      `${targetOf(target, DESTINATION_COLUMN.ID_PROVINCE)} AS ${q(DESTINATION_COLUMN.ID_PROVINCE)},`,
      `${targetOf(target, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS ${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)},`,
      `${targetOf(target, DESTINATION_COLUMN.NUMBER)} AS ${q(DESTINATION_COLUMN.NUMBER)},`,
      `count(*) AS "target_rows", min(${targetOf(target, DESTINATION_COLUMN.ID)}) AS "target_id"`,
      `FROM ${targetTableSql(target)} GROUP BY 1, 2, 3, 4`,
    ].join(" ")
  );
}

function candidateTargetsCte(): string {
  return cte(
    CTE_TARGET.CANDIDATE_TARGETS,
    [
      `SELECT c.*, tc."target_rows", tc."target_id"`,
      `FROM ${q(CTE_TARGET.CANDIDATES)} AS c`,
      `LEFT JOIN ${q(CTE_TARGET.COUNTS)} AS tc ON ${sameKeySql("tc", "c")}`,
    ].join(" ")
  );
}

function matchedCte(target: WritableTargetLayout): string {
  const matchedGeometry = `${MATCHED_TARGET_ALIAS}.${physicalColumn(target, DESTINATION_COLUMN.GEOMETRY)}`;
  return cte(
    CTE_TARGET.MATCHED,
    [
      `SELECT ct.*, ${matchedGeometry} AS "target_geometry",`,
      `${geometriesEqualSql(matchedGeometry, `ct.${q(CANDIDATE_GEOMETRY)}`)} AS "equal"`,
      `FROM ${q(CTE_TARGET.CANDIDATE_TARGETS)} AS ct`,
      `LEFT JOIN ${qualifiedName(target)} AS ${MATCHED_TARGET_ALIAS}`,
      `ON ${MATCHED_TARGET_ALIAS}.${physicalColumn(target, DESTINATION_COLUMN.ID)} = ct."target_id" AND ct."target_rows" = 1`,
    ].join(" ")
  );
}

function measuredCte(): string {
  return cte(
    CTE_TARGET.MEASURED,
    `SELECT m.*, ${hausdorffDistanceSql('m."target_geometry"', `m.${q(CANDIDATE_GEOMETRY)}`, 'm."equal"')} AS "distance" FROM ${q(CTE_TARGET.MATCHED)} AS m`
  );
}

function plannedCte(options: ActualizarPadronOptions): string {
  return cte(
    CTE_TARGET.PLANNED,
    `SELECT m.*, ${matchClassSql(options.tolerance, 'm."target_rows"', 'm."equal"', 'm."distance"')} AS "class" FROM ${q(CTE_TARGET.MEASURED)} AS m`
  );
}

function geometryAcceptsCte(options: ActualizarPadronOptions): string {
  return cte(CTE_TARGET.GEOMETRY_ACCEPTS, geometryAcceptsValuesSql(options.acceptedGeometries ?? []));
}

/* A join, not a correlated EXISTS, so the planner can hash the accepts once; the parser rejects a repeated key, so no row multiplies. */
const acceptsJoinSql = (alias: string): string =>
  `LEFT JOIN ${q(CTE_TARGET.GEOMETRY_ACCEPTS)} AS ${ACCEPT_ALIAS} ON ${sameKeySql(ACCEPT_ALIAS, alias)}`;

/* The area ratio and the areas of every CHANGED row are computed once here: the counts, the UPDATE and the lists all read this CTE.
   A row is applied only when updateGeometries is on and its ratio is below the threshold or the user accepted its key (AP-100); a NULL ratio
   with an old geometry (no usable area) stays pending unless accepted. A NULL old geometry is a fill-in: it has no ratio to gate, so it is applied with the flag. */
function changedGeometryCte(options: ActualizarPadronOptions): string {
  const measured = [
    `SELECT ${PLANNED_ALIAS}.*,`,
    `${areaRatioOf(plannedOf("target_geometry"), plannedOf(CANDIDATE_GEOMETRY))} AS ${q(CHANGED_COLUMN.AREA_RATIO)},`,
    `ST_Area(${plannedOf("target_geometry")}) AS ${q(CHANGED_COLUMN.OLD_AREA)},`,
    `ST_Area(${plannedOf(CANDIDATE_GEOMETRY)}) AS ${q(CHANGED_COLUMN.NEW_AREA)},`,
    `${ACCEPT_ALIAS}.${q(DESTINATION_COLUMN.NUMBER)} IS NOT NULL AS ${q(CHANGED_COLUMN.ACCEPTED)}`,
    `FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS} ${acceptsJoinSql(PLANNED_ALIAS)} WHERE ${classIs(MATCH_CLASS.CHANGED)}`,
  ].join(" ");
  const withinThreshold = `CASE WHEN ${changedOf(PAIR_COLUMN.TARGET_GEOMETRY)} IS NULL THEN true ELSE COALESCE(${changedOf(CHANGED_COLUMN.AREA_RATIO)} < ${options.geometryAreaThreshold}, false) END`;
  const applied = `((${withinThreshold} OR ${changedOf(CHANGED_COLUMN.ACCEPTED)}) AND ${applyFlag(options)})`;
  return cte(
    CTE_TARGET.CHANGED_GEOMETRY,
    `SELECT ${CHANGED_ALIAS}.*, ${applied} AS ${q(CHANGED_COLUMN.APPLIED)} FROM (${measured}) AS ${CHANGED_ALIAS}`
  );
}

/** Destination rows whose key no staging candidate carries: the only rows a pair can start from, never removed. */
function unmatchedTargetsCte(target: WritableTargetLayout): string {
  return cte(
    CTE_TARGET.UNMATCHED,
    [
      `SELECT ${aliasedTargetColumns(target, UNMATCHED_COLUMNS)}`,
      `FROM ${targetTableSql(target)}`,
      `LEFT JOIN ${q(CTE_TARGET.CANDIDATES)} AS c ON ${sameKeyAsTargetSql(target, "c")}`,
      `WHERE c.${q(DESTINATION_COLUMN.NUMBER)} IS NULL`,
    ].join(" ")
  );
}

/* The intersection is computed once per candidate, and only for valid geometries: CASE, not AND, guards the overlay,
   because PostgreSQL does not short-circuit AND and GEOS aborts the statement on invalid input. */
function footprintAreasSql(existing: string, incoming: string): string {
  const valid = `ST_IsValid(${existing}) AND ST_IsValid(${incoming})`;
  return [
    `CASE WHEN ${valid} THEN ST_Area(ST_Intersection(${existing}, ${incoming})) END AS ${q(FOOTPRINT_AREA.OVERLAP)}`,
    `CASE WHEN ${valid} THEN ST_Area(${existing}) END AS ${q(FOOTPRINT_AREA.EXISTING)}`,
    `CASE WHEN ${valid} THEN ST_Area(${incoming}) END AS ${q(FOOTPRINT_AREA.INCOMING)}`,
  ].join(", ");
}

/* The overlap is a share of the old footprint; the new area must sit within the band around the old one. */
function tierBandSql({ overlapMin, areaRatioTolerance }: PairTierBand): string {
  const footprintOf = (column: string): string => `${FOOTPRINT_ALIAS}.${q(column)}`;
  const existingArea = footprintOf(FOOTPRINT_AREA.EXISTING);
  const lower = 1 - areaRatioTolerance;
  const upper = 1 + areaRatioTolerance;
  return [
    `${footprintOf(FOOTPRINT_AREA.OVERLAP)} >= ${overlapMin} * ${existingArea}`,
    `${footprintOf(FOOTPRINT_AREA.INCOMING)} BETWEEN ${lower} * ${existingArea} AND ${upper} * ${existingArea}`,
  ].join(" AND ");
}

/** STRICT is tried before LOOSE; a NULL tier (no band met, or an invalid geometry) is not a candidate. */
function pairTierSql(): string {
  const branches = PAIR_TIER_BANDS.map((band) => `WHEN ${tierBandSql(band)} THEN ${literal(band.tier)}`);
  return `CASE ${branches.join(" ")} END`;
}

function pairCandidateColumns(): string[] {
  const targetGeometry = pairableOf(DESTINATION_COLUMN.GEOMETRY);
  const newGeometry = plannedOf(CANDIDATE_GEOMETRY);
  return [
    ...KEY_COLUMNS.map((column) => plannedOf(column)),
    plannedOf(DEPARTMENT_COLUMN),
    plannedOf(LOCALITY_NAME_COLUMN),
    newGeometry,
    `${pairableOf(DESTINATION_COLUMN.ID)} AS ${q(PAIR_COLUMN.TARGET_ID)}`,
    `${pairableOf(DESTINATION_COLUMN.TYPE_PADRON)} AS ${q(PAIR_COLUMN.OLD_TYPE_PADRON)}`,
    `${pairableOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS ${q(PAIR_COLUMN.OLD_LOCALITY_ID)}`,
    `${pairableOf(DESTINATION_COLUMN.NUMBER)} AS ${q(PAIR_COLUMN.OLD_NUMBER)}`,
    `${targetGeometry} AS ${q(PAIR_COLUMN.TARGET_GEOMETRY)}`,
    `${TIER_ALIAS}.${q(PAIR_COLUMN.TIER)} AS ${q(PAIR_COLUMN.TIER)}`,
    ...Object.values(FOOTPRINT_AREA).map((column) => `${FOOTPRINT_ALIAS}.${q(column)}`),
  ];
}

const choiceOf = (column: string): string => `${CHOICE_ALIAS}.${q(column)}`;

/* A key with a choice keeps only the chosen candidate, so a NULL choice keeps none; a destination row chosen for one key is no candidate of another key. */
function choicePruningSql(): string[] {
  const oldId = pairableOf(DESTINATION_COLUMN.ID);
  const otherChoiceOf = (column: string): string => `${OTHER_CHOICE_ALIAS}.${q(column)}`;
  return [
    `AND NOT EXISTS (SELECT 1 FROM ${q(CTE_TARGET.PAIR_CHOICES)} AS ${CHOICE_ALIAS}`,
    `WHERE ${sameKeySql(CHOICE_ALIAS, PLANNED_ALIAS)} AND ${choiceOf(CHOICE_OLD_ID_COLUMN)} IS DISTINCT FROM ${oldId})`,
    `AND NOT EXISTS (SELECT 1 FROM ${q(CTE_TARGET.PAIR_CHOICES)} AS ${OTHER_CHOICE_ALIAS}`,
    `WHERE ${otherChoiceOf(CHOICE_OLD_ID_COLUMN)} = ${oldId} AND NOT (${sameKeySql(OTHER_CHOICE_ALIAS, PLANNED_ALIAS)}))`,
  ];
}

function pairChoicesCte(options: ActualizarPadronOptions): string {
  return cte(CTE_TARGET.PAIR_CHOICES, pairChoicesValuesSql(options.pairChoices));
}

/* The && probe reads the destination table's GiST index; the footprint reads the unmatched copy of the geometry, so matched neighbours are dropped before it runs. OFFSET 0 fences the footprint subquery: without it the planner flattens it and re-runs the intersection per reference. */
function pairCandidatesCte(target: WritableTargetLayout): string {
  const existing = pairableOf(DESTINATION_COLUMN.GEOMETRY);
  const incoming = plannedOf(CANDIDATE_GEOMETRY);
  return cte(
    CTE_TARGET.PAIR_CANDIDATES,
    [
      `SELECT ${pairCandidateColumns().join(", ")}`,
      `FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
      `JOIN ${targetTableSql(target)}`,
      `ON ${targetOf(target, DESTINATION_COLUMN.GEOMETRY)} && ${incoming}`,
      `AND ${targetOf(target, DESTINATION_COLUMN.ID_PROVINCE)} = ${plannedOf(DESTINATION_COLUMN.ID_PROVINCE)}`,
      `JOIN ${q(CTE_TARGET.PAIRABLE)} AS ${PAIRABLE_ALIAS}`,
      `ON ${pairableOf(DESTINATION_COLUMN.ID)} = ${targetOf(target, DESTINATION_COLUMN.ID)}`,
      `CROSS JOIN LATERAL (SELECT ${footprintAreasSql(existing, incoming)} OFFSET 0) AS ${FOOTPRINT_ALIAS}`,
      `CROSS JOIN LATERAL (SELECT ${pairTierSql()} AS ${q(PAIR_COLUMN.TIER)}) AS ${TIER_ALIAS}`,
      `WHERE ${classIs(MATCH_CLASS.NEW)}`,
      `AND ${TIER_ALIAS}.${q(PAIR_COLUMN.TIER)} IS NOT NULL`,
      ...choicePruningSql(),
    ].join(" ")
  );
}

/** Unmatched destination rows that no decided staging row carries, skipped or not: a skipped row still owns its key. */
function pairableTargetsCte(): string {
  return cte(
    CTE_TARGET.PAIRABLE,
    [
      `SELECT ${UNMATCHED_ALIAS}.* FROM ${q(CTE_TARGET.UNMATCHED)} AS ${UNMATCHED_ALIAS}`,
      `WHERE NOT EXISTS (SELECT 1 FROM ${q(DECIDED_CTE)} AS ${DECIDED_ALIAS} WHERE ${sameKeySql(DECIDED_ALIAS, UNMATCHED_ALIAS)})`,
    ].join(" ")
  );
}

function pairStatusSql(): string {
  const counted = (column: string): string => `${PAIR_COUNTED_ALIAS}.${q(column)}`;
  return [
    "CASE",
    `WHEN ${counted(PAIR_COLUMN.NEW_MATCHES)} > 1 OR ${counted(PAIR_COLUMN.TARGET_MATCHES)} > 1 THEN ${literal(PAIR_STATUS.NOT_APPLIED_AMBIGUOUS)}`,
    `WHEN ${counted(PAIR_COLUMN.TIER)} = ${literal(PAIR_TIER.LOOSE)} AND NOT ${counted(PAIR_COLUMN.CHOSEN)} THEN ${literal(PAIR_STATUS.NOT_APPLIED_PENDING)}`,
    `ELSE ${literal(PAIR_STATUS.APPLIED)} END`,
  ].join(" ");
}

/* A pair is applied when both sides match exactly once; a LOOSE pair also needs a user choice naming its key and old id. */
function pairsCte(): string {
  const candidate = (column: string): string => `${PAIR_CANDIDATE_ALIAS}.${q(column)}`;
  const counted = (column: string): string => `${PAIR_COUNTED_ALIAS}.${q(column)}`;
  const newKey = [DESTINATION_COLUMN.TYPE_PADRON, DESTINATION_COLUMN.ID_PROVINCE, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY, DESTINATION_COLUMN.NUMBER]
    .map((column) => candidate(column))
    .join(", ");
  const choicesJoinSql = [
    `LEFT JOIN ${q(CTE_TARGET.PAIR_CHOICES)} AS ${CHOICE_ALIAS}`,
    `ON ${choiceOf(CHOICE_OLD_ID_COLUMN)} = ${candidate(PAIR_COLUMN.TARGET_ID)} AND ${sameKeySql(CHOICE_ALIAS, PAIR_CANDIDATE_ALIAS)}`,
  ].join(" ");
  const changedSql = (column: string, oldColumn: string, alias: string): string =>
    `${counted(column)} IS DISTINCT FROM ${counted(oldColumn)} AS ${q(alias)}`;
  return cte(
    CTE_TARGET.PAIRS,
    [
      `SELECT ${PAIR_COUNTED_ALIAS}.*,`,
      `${pairStatusSql()} AS ${q(PAIR_COLUMN.STATUS)},`,
      `${changedSql(DESTINATION_COLUMN.TYPE_PADRON, PAIR_COLUMN.OLD_TYPE_PADRON, PAIR_COLUMN.TYPE_CHANGED)},`,
      `${changedSql(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY, PAIR_COLUMN.OLD_LOCALITY_ID, PAIR_COLUMN.LOCALITY_CHANGED)},`,
      `${changedSql(DESTINATION_COLUMN.NUMBER, PAIR_COLUMN.OLD_NUMBER, PAIR_COLUMN.NUMBER_CHANGED)}`,
      `FROM (SELECT ${PAIR_CANDIDATE_ALIAS}.*,`,
      `count(*) OVER (PARTITION BY ${newKey}) AS ${q(PAIR_COLUMN.NEW_MATCHES)},`,
      `count(*) OVER (PARTITION BY ${candidate(PAIR_COLUMN.TARGET_ID)}) AS ${q(PAIR_COLUMN.TARGET_MATCHES)},`,
      `${choiceOf(DESTINATION_COLUMN.NUMBER)} IS NOT NULL AS ${q(PAIR_COLUMN.CHOSEN)}`,
      `FROM ${q(CTE_TARGET.PAIR_CANDIDATES)} AS ${PAIR_CANDIDATE_ALIAS} ${choicesJoinSql}) AS ${PAIR_COUNTED_ALIAS}`,
    ].join(" ")
  );
}

function classifyCtes(layouts: PadronLayouts, options: ActualizarPadronOptions): string[] {
  const { target } = layouts;
  return [
    ...candidateCtes(layouts, "populate"),
    candidatesCte(),
    targetCountsCte(target),
    candidateTargetsCte(),
    matchedCte(target),
    measuredCte(),
    plannedCte(options),
    geometryAcceptsCte(options),
    changedGeometryCte(options),
    unmatchedTargetsCte(target),
    pairableTargetsCte(),
    pairChoicesCte(options),
    pairCandidatesCte(target),
    pairsCte(),
  ];
}

/* AP-102 to AP-105: every missing destination row is a deletion candidate; it is deleted unless a live pair could claim it or
   something references it. Read fresh at classify time, both dry run and real run alike. A separate block from classifyCtes()
   because buildPadronApplySql's WITH chain never needs it: the delete is its own statement. */
const CTE_REMOVAL = {
  MISSING_IDS: "missing_target_ids",
  OPEN_PAIR_IDS: "open_pair_ids",
  DELETE_IDS: "deleted_ids_insert",
} as const;

const REMOVAL_REASON_COLUMN = "reason";

/* Condition (a) of AP-103: the destination id has no staging candidate and no applied pair claims it. */
function missingTargetIdsCte(): string {
  return cte(CTE_REMOVAL.MISSING_IDS, [`SELECT ${unmatchedOf(DESTINATION_COLUMN.ID)} AS "id"`, missingTargetsSql()].join(" "));
}

/* Condition (b) of AP-103: a pair still waiting for a decision (pending or ambiguous) may yet claim the row. */
function openPairIdsCte(): string {
  return cte(
    CTE_REMOVAL.OPEN_PAIR_IDS,
    [
      `SELECT DISTINCT ${pairOf(PAIR_COLUMN.TARGET_ID)} AS "id" FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}`,
      `WHERE ${pairOf(PAIR_COLUMN.STATUS)} IN (${literal(PAIR_STATUS.NOT_APPLIED_PENDING)}, ${literal(PAIR_STATUS.NOT_APPLIED_AMBIGUOUS)})`,
    ].join(" ")
  );
}

/* Conditions (b), (c) and the scan guard of AP-102, in that order: the first that fails names the reason; NULL means the
   padrón is deleted. A blocked scan (no table found, or one unreadable) leaves every unreferenced padrón UNVERIFIED. */
function removalVerdictsCte(blocked: boolean): string {
  const openPair = `${q(CTE_REMOVAL.OPEN_PAIR_IDS)}.${q("id")}`;
  const refsTotal = referenceTotalColumnSql(REMOVAL_CTE.REFS);
  const subdivided = `${q(MISSING_SCORED_CTE)}.${q(MISSING_SCORED_CLASS_COLUMN)} = ${literal(REPLACEMENT_CLASS.SUBDIVIDED)}`;
  const reassignable = blocked ? "false" : `${referenceBlockedColumnSql(REMOVAL_CTE.REFS)} = 0`;
  const branches = [
    `WHEN ${openPair} IS NOT NULL THEN ${literal(REMOVAL_SKIP_REASON.STILL_PAIRABLE)}`,
    `WHEN ${refsTotal} > 0 AND ${subdivided} AND ${reassignable} THEN NULL`,
    `WHEN ${refsTotal} > 0 AND ${subdivided} THEN ${literal(REMOVAL_SKIP_REASON.NOT_REASSIGNABLE)}`,
    `WHEN ${refsTotal} > 0 THEN ${literal(REMOVAL_SKIP_REASON.NOW_REFERENCED)}`,
    ...(blocked ? [`ELSE ${literal(REMOVAL_SKIP_REASON.UNVERIFIED)}`] : []),
  ];
  const missingId = `${q(CTE_REMOVAL.MISSING_IDS)}.${q("id")}`;
  const verdicts = [
    `SELECT ${missingId} AS ${q(VERDICT_COLUMN.OLD_ID)}, CASE ${branches.join(" ")} END AS ${q(REMOVAL_REASON_COLUMN)},`,
    `${refsTotal} AS ${q(VERDICT_COLUMN.REFS_TOTAL)}`,
    `FROM ${q(CTE_REMOVAL.MISSING_IDS)}`,
    `LEFT JOIN ${q(CTE_REMOVAL.OPEN_PAIR_IDS)} ON ${openPair} = ${missingId}`,
    referenceJoinSql(REMOVAL_CTE.REFS, missingId),
    `LEFT JOIN ${q(MISSING_SCORED_CTE)} ON ${q(MISSING_SCORED_CTE)}.${q(DESTINATION_COLUMN.ID)} = ${missingId}`,
  ].join(" ");
  return cte(
    REMOVAL_CTE.VERDICTS,
    `SELECT vd.*, ${reassignFlagSql("vd")} AS ${q(VERDICT_COLUMN.REASSIGN)} FROM (${verdicts}) AS vd`
  );
}

const DELETABLE_CONDITION = `${q(REMOVAL_REASON_COLUMN)} IS NULL`;

/** The removal-eligibility CTEs, always present (not gated by the report flag): the digest and the removed/removalsSkipped
    counts must be identical in an analysis and in the persist classify, so AP-90's plan-changed guard also covers deletions. */
function removalCtes(scan: ReferenceScan): string[] {
  return [
    missingTargetIdsCte(),
    ...referenceCountCtes(REMOVAL_CTE.REFS, CTE_REMOVAL.MISSING_IDS, "id", scan.tables),
    openPairIdsCte(),
    removalVerdictsCte(scan.blockedReason !== null),
  ];
}

/* The persist classify also writes the eligible ids, set-based, into the session's temp table (AP-106): a data-modifying CTE
   runs exactly once and to completion whether or not the main select reads it. */
function deleteIdsInsertCte(): string {
  return cte(
    CTE_REMOVAL.DELETE_IDS,
    [
      `INSERT INTO ${DELETE_IDS_TABLE_SQL} (${q(DELETE_IDS_ID_COLUMN)})`,
      `SELECT "old_id" FROM ${q(REMOVAL_CTE.VERDICTS)} WHERE ${DELETE_WITHOUT_REASSIGN}`,
      `RETURNING ${q(DELETE_IDS_ID_COLUMN)}`,
    ].join(" ")
  );
}

const verdictCountSql = (condition: string): string => `(SELECT count(*) FROM ${q(REMOVAL_CTE.VERDICTS)} WHERE ${condition})`;

const SKIPPED_COUNT_COLUMN: Record<RemovalSkipReason, string> = {
  [REMOVAL_SKIP_REASON.STILL_PAIRABLE]: "removals_skipped_still_pairable",
  [REMOVAL_SKIP_REASON.NOW_REFERENCED]: "removals_skipped_now_referenced",
  [REMOVAL_SKIP_REASON.NOT_REASSIGNABLE]: "removals_skipped_not_reassignable",
  [REMOVAL_SKIP_REASON.UNVERIFIED]: "removals_skipped_unverified",
};

/** removed is the delete-eligible missing padrón count (a planned write); the removalsSkipped reasons partition the rest (AP-105). */
function removalCountsSql(): string[] {
  return [
    `${verdictCountSql(DELETABLE_CONDITION)} AS "removed",`,
    ...Object.values(REMOVAL_SKIP_REASON).map(
      (reason) => `${verdictCountSql(`${q(REMOVAL_REASON_COLUMN)} = ${literal(reason)}`)} AS ${q(SKIPPED_COUNT_COLUMN[reason])},`
    ),
  ];
}

/** An analysis lists the padrones it would delete: the unmatched rows whose verdict is NULL, capped (AP-108). */
function plannedRemovedListSql(layouts: PadronLayouts): string {
  const source = [
    `SELECT ${UNMATCHED_ALIAS}.* FROM ${q(CTE_TARGET.UNMATCHED)} AS ${UNMATCHED_ALIAS}`,
    `WHERE ${unmatchedOf(DESTINATION_COLUMN.ID)} IN (SELECT "old_id" FROM ${q(REMOVAL_CTE.VERDICTS)} WHERE ${DELETABLE_CONDITION})`,
  ].join(" ");
  return removedListSql(layouts, source);
}

const pairCountSql = (condition: string): string =>
  `(SELECT count(*) FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS} WHERE ${condition})`;

const changedCountSql = (applied: boolean): string =>
  `(SELECT count(*) FROM ${q(CTE_TARGET.CHANGED_GEOMETRY)} AS ${CHANGED_ALIAS} WHERE ${applied ? "" : "NOT "}${changedOf(CHANGED_COLUMN.APPLIED)})`;

/** Each applied pair consumes exactly one new row (its new key is unique among the candidates and matches one pair). */
function classificationCountsSql(): string {
  return [
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.NEW)}) - ${pairCountSql(appliedCondition())} AS "new",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.UNCHANGED)}) AS "unchanged",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.WITHIN_TOLERANCE)}) AS "within_tolerance",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.CHANGED)}) AS "changed",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.AMBIGUOUS)}) AS "ambiguous",`,
    `${changedCountSql(true)} AS "updates",`,
    `${changedCountSql(false)} AS "geometry_pending",`,
    ...removalCountsSql(),
    ...reassignCountsSql(),
    geometryAcceptsUnappliedSql(),
  ].join(" ");
}

/* An accepted key counts as unapplied when no applied CHANGED row carries it (gone, not CHANGED any more, or Actualizar geometrías off). */
function geometryAcceptsUnappliedSql(): string {
  return [
    `(SELECT count(*) FROM ${q(CTE_TARGET.GEOMETRY_ACCEPTS)} AS ${ACCEPT_ALIAS}`,
    `WHERE NOT EXISTS (SELECT 1 FROM ${q(CTE_TARGET.CHANGED_GEOMETRY)} AS ${CHANGED_ALIAS}`,
    `WHERE ${changedOf(CHANGED_COLUMN.APPLIED)} AND ${sameKeySql(ACCEPT_ALIAS, CHANGED_ALIAS)})) AS "geometry_accepts_unapplied"`,
  ].join(" ");
}

const appliedLooseCondition = (): string => `${appliedCondition()} AND ${pairOf(PAIR_COLUMN.TIER)} = ${literal(PAIR_TIER.LOOSE)}`;

/* A choice with an old id is applied when an APPLIED pair carries that destination row under the choice's new key. */
function choicesUnappliedSql(): string {
  return [
    `(SELECT count(*) FROM ${q(CTE_TARGET.PAIR_CHOICES)} AS ${CHOICE_ALIAS}`,
    `WHERE ${choiceOf(CHOICE_OLD_ID_COLUMN)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}`,
    `WHERE ${appliedCondition()} AND ${pairOf(PAIR_COLUMN.TARGET_ID)} = ${choiceOf(CHOICE_OLD_ID_COLUMN)}`,
    `AND ${sameKeySql(CHOICE_ALIAS, PAIR_ALIAS)})) AS "choices_unapplied"`,
  ].join(" ");
}

/* Only the ambiguous keys count as not applied; a pending LOOSE pair is counted on its own. A new row claimed by two or more
   ambiguous pairs is one candidate: its duplicate pairs count once. */
function pairCountsSql(): string {
  const ambiguousKeys = `SELECT DISTINCT ${KEY_COLUMNS.map((column) => pairOf(column)).join(", ")} FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS} WHERE ${statusIs(PAIR_STATUS.NOT_APPLIED_AMBIGUOUS)}`;
  return [
    `${pairCountSql(appliedCondition())} AS "pairs",`,
    `${pairCountSql(appliedLooseCondition())} AS "pairs_loose",`,
    `(SELECT count(*) FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}) AS "pairs_total",`,
    `${pairCountSql(statusIs(PAIR_STATUS.NOT_APPLIED_PENDING))} AS "pairs_pending",`,
    `(SELECT count(*) FROM (${ambiguousKeys}) AS "not_applied_keys") AS "pairs_not_applied",`,
    choicesUnappliedSql(),
  ].join(" ");
}

/** Destination rows with no staging candidate that no applied pair claims: counted and sampled, never removed. */
function missingTargetsSql(): string {
  return [
    `FROM ${q(CTE_TARGET.UNMATCHED)} AS ${UNMATCHED_ALIAS}`,
    `WHERE NOT EXISTS (SELECT 1 FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}`,
    `WHERE ${appliedCondition()} AND ${pairOf(PAIR_COLUMN.TARGET_ID)} = ${unmatchedOf(DESTINATION_COLUMN.ID)})`,
  ].join(" ");
}

function missingSqlParts(): string[] {
  return [
    `(SELECT count(*) ${missingTargetsSql()}) AS "missing",`,
    `${jsonArrayOf(
      [
        `SELECT ${keyListOf(UNMATCHED_ALIAS).join(", ")} ${missingTargetsSql()}`,
        `ORDER BY ${unmatchedOf(DESTINATION_COLUMN.ID_PROVINCE)}, ${unmatchedOf(DESTINATION_COLUMN.NUMBER)}`,
        `LIMIT ${SAMPLE_LIMIT}`,
      ].join(" "),
      "missing_samples"
    )} AS "missing_samples",`,
  ];
}

const centroidPointSql = (geometry: string): string =>
  `CROSS JOIN LATERAL (SELECT ST_Transform(ST_Centroid(${geometry}), ${WGS84_SRID}) AS "point") AS ${q(CENTROID_ALIAS)}`;

const centroidColumnsSql = (): string[] => [
  `ROUND(CAST(ST_Y(${CENTROID_ALIAS}."point") AS numeric), 6) AS "centroidLat"`,
  `ROUND(CAST(ST_X(${CENTROID_ALIAS}."point") AS numeric), 6) AS "centroidLon"`,
];

const areaChangePctSql = (ratio: string): string => `ROUND(CAST((${ratio}) * 100 AS numeric), 1) AS "areaChangePct"`;

/** A pair's area change is signed: 0 means the same area, -2 means 2 % smaller, +2 means 2 % larger. */
const signedAreaChangePctSql = (ratio: string): string => `ROUND(CAST((${ratio} - 1) * 100 AS numeric), 1) AS "areaChangePct"`;

const pairAreaRatioSql = (): string => `${pairOf(FOOTPRINT_AREA.INCOMING)} / NULLIF(${pairOf(FOOTPRINT_AREA.EXISTING)}, 0)`;

/** Every pair, applied or not, for the report; the lists are ordered by department, locality and padrón. */
function pairsListSql({ locality }: PadronLayouts): string {
  const oldLocalityId = `${OLD_LOCALITY_ALIAS}.${physicalColumn(locality, LOCALITY_COLUMN.ID)}`;
  const columns = [
    `${pairOf(PAIR_COLUMN.STATUS)} AS "status"`,
    `${pairOf(PAIR_COLUMN.TYPE_CHANGED)} AS "typeChanged"`,
    `${pairOf(PAIR_COLUMN.LOCALITY_CHANGED)} AS "localityChanged"`,
    `${pairOf(PAIR_COLUMN.NUMBER_CHANGED)} AS "numberChanged"`,
    `${pairOf(PAIR_COLUMN.TIER)} AS "tier"`,
    `${pairOf(FOOTPRINT_AREA.OVERLAP)} / NULLIF(${pairOf(FOOTPRINT_AREA.EXISTING)}, 0) AS "overlap"`,
    `${pairAreaRatioSql()} AS "areaRatio"`,
    `${pairOf(FOOTPRINT_AREA.EXISTING)} AS "oldAreaM2"`,
    `${pairOf(FOOTPRINT_AREA.INCOMING)} AS "newAreaM2"`,
    signedAreaChangePctSql(pairAreaRatioSql()),
    `${pairOf(PAIR_COLUMN.TARGET_ID)} AS "oldId"`,
    `${pairOf(PAIR_COLUMN.OLD_TYPE_PADRON)} AS "oldTypePadron"`,
    `${pairOf(PAIR_COLUMN.OLD_LOCALITY_ID)} AS "oldLocalityId"`,
    `${OLD_LOCALITY_ALIAS}.${physicalColumn(locality, LOCALITY_COLUMN.NAME)} AS "oldLocality"`,
    `${pairOf(PAIR_COLUMN.OLD_NUMBER)} AS "oldNumber"`,
    `${pairOf(DESTINATION_COLUMN.ID_PROVINCE)} AS "provinceId"`,
    `${pairOf(DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron"`,
    `${pairOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS "localityId"`,
    `${pairOf(DESTINATION_COLUMN.NUMBER)} AS "number"`,
    `${pairOf(DEPARTMENT_COLUMN)} AS "department"`,
    `${pairOf(LOCALITY_NAME_COLUMN)} AS "locality"`,
    ...centroidColumnsSql(),
  ];
  return [
    `SELECT ${columns.join(", ")} FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}`,
    `LEFT JOIN ${qualifiedName(locality)} AS ${OLD_LOCALITY_ALIAS} ON ${oldLocalityId} = ${pairOf(PAIR_COLUMN.OLD_LOCALITY_ID)}`,
    centroidPointSql(pairOf(CANDIDATE_GEOMETRY)),
    `ORDER BY ${pairOf(DEPARTMENT_COLUMN)}, ${pairOf(LOCALITY_NAME_COLUMN)} NULLS FIRST, ${pairOf(DESTINATION_COLUMN.NUMBER)}`,
    `LIMIT ${PAIR_LIST_LIMIT}`,
  ].join(" ");
}

function ambiguousSamplesSql(): string {
  return [
    `SELECT ${keyListOf(PLANNED_ALIAS).join(", ")} FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
    `WHERE ${classIs(MATCH_CLASS.AMBIGUOUS)}`,
    `ORDER BY ${plannedOf(DESTINATION_COLUMN.ID_PROVINCE)}, ${plannedOf(DESTINATION_COLUMN.NUMBER)} LIMIT ${SAMPLE_LIMIT}`,
  ].join(" ");
}

const geometryStateSql = (): string =>
  `CASE WHEN ${changedOf(CHANGED_COLUMN.APPLIED)} THEN ${literal(GEOMETRY_STATE.APPLIED)} ELSE ${literal(GEOMETRY_STATE.PENDING)} END AS "state"`;

/* Every CHANGED row, applied or pending, pending first and then by area ratio; the UI list passes a limit, the CSV of pending rows does not. */
function geometryListSql({ locality }: PadronLayouts, filter: string | null, limit: number | null): string {
  const newLocalityName = `${NEW_LOCALITY_ALIAS}.${physicalColumn(locality, LOCALITY_COLUMN.NAME)}`;
  const localityNameSql = `COALESCE(${changedOf(LOCALITY_NAME_COLUMN)}, ${newLocalityName})`;
  const columns = [
    ...keyListOf(CHANGED_ALIAS),
    `${changedOf(DEPARTMENT_COLUMN)} AS "department"`,
    `${localityNameSql} AS "locality"`,
    `${changedOf(PAIR_COLUMN.TARGET_ID)} AS "oldId"`,
    geometryStateSql(),
    `${changedOf(CHANGED_COLUMN.OLD_AREA)} AS "oldAreaM2"`,
    `${changedOf(CHANGED_COLUMN.NEW_AREA)} AS "newAreaM2"`,
    areaChangePctSql(changedOf(CHANGED_COLUMN.AREA_RATIO)),
    ...centroidColumnsSql(),
  ];
  return [
    `SELECT ${columns.join(", ")} FROM ${q(CTE_TARGET.CHANGED_GEOMETRY)} AS ${CHANGED_ALIAS}`,
    `LEFT JOIN ${qualifiedName(locality)} AS ${NEW_LOCALITY_ALIAS}`,
    `ON ${NEW_LOCALITY_ALIAS}.${physicalColumn(locality, LOCALITY_COLUMN.ID)} = ${changedOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}`,
    centroidPointSql(changedOf(CANDIDATE_GEOMETRY)),
    ...(filter === null ? [] : [`WHERE ${filter}`]),
    `ORDER BY ${changedOf(CHANGED_COLUMN.APPLIED)}, ${changedOf(CHANGED_COLUMN.AREA_RATIO)} DESC NULLS FIRST,`,
    `${changedOf(DEPARTMENT_COLUMN)} NULLS FIRST, ${localityNameSql} NULLS FIRST, ${changedOf(DESTINATION_COLUMN.NUMBER)}`,
    ...(limit === null ? [] : [`LIMIT ${limit}`]),
  ].join(" ");
}

const PENDING_FILTER = `NOT ${changedOf(CHANGED_COLUMN.APPLIED)}`;

export interface ClassifyStatementOptions {
  /** The analysis (true) reads the replacement block and the report lists; the persist classify (false) reads the counts, fingerprint and digest only. */
  report?: boolean;
  /** The real run's classify (AP-106) also writes the delete-eligible ids into the session's temp table, which the caller created first. */
  persistDeletable?: boolean;
}

/* The report flag only adds or drops report columns: the classification, the digest and the plan never depend on it. */
const replacementCountsOf = (report: boolean): string[] => (report ? [`${replacementCountSql()},`] : []);

function missingReviewOf(layouts: PadronLayouts, report: boolean): string[] {
  return report ? [`${jsonArrayOf(missingReviewSql(layouts), "missing_review")} AS "missing_review",`] : [];
}

const removedListOf = (layouts: PadronLayouts, report: boolean): string[] =>
  report ? [`${plannedRemovedListSql(layouts)} AS "removed_list",`] : [];

const deleteIdsInsertOf = (persistDeletable: boolean): string[] =>
  persistDeletable ? [deleteIdsInsertCte(), reassignIdsInsertCte()] : [];

const labelCtesOf = (report: boolean): string[] => (report ? replacementLabelCtes() : []);

function pendingListOf(layouts: PadronLayouts, report: boolean): string[] {
  return report ? [`${jsonArrayOf(geometryListSql(layouts, PENDING_FILTER, null), "pending_geometry_changes")} AS "pending_geometry_changes",`] : [];
}

export function buildPadronClassifySql(
  layouts: PadronLayouts,
  options: ActualizarPadronOptions,
  scan: ReferenceScan = NO_REFERENCE_SCAN,
  { report = true, persistDeletable = false }: ClassifyStatementOptions = {}
): string {
  return [
    withClause([
      ...classifyCtes(layouts, options),
      ...classificationCtes(layouts.target),
      ...removalCtes(scan),
      ...deleteIdsInsertOf(persistDeletable),
      ...labelCtesOf(report),
    ]),
    "SELECT",
    `${classificationCountsSql()},`,
    ...missingSqlParts(),
    ...replacementCountsOf(report),
    `${pairCountsSql()},`,
    `${jsonArrayOf(pairsListSql(layouts), "pairs_list")} AS "pairs_list",`,
    ...missingReviewOf(layouts, report),
    `${jsonArrayOf(ambiguousSamplesSql(), "ambiguous_samples")} AS "ambiguous_samples",`,
    `${jsonArrayOf(geometryListSql(layouts, null, DETAIL_LIST_LIMIT), "geometry_changes")} AS "geometry_changes",`,
    ...pendingListOf(layouts, report),
    ...removedListOf(layouts, report),
    fingerprintColumnsSql(layouts.target).join(", "),
    `FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
  ].join(" ");
}

const ENTRY_COLUMN = "entry";
const ENTRY_SEPARATOR = "\n";

const keyTextSql = (alias: string): string =>
  [
    `${alias}.${q(DESTINATION_COLUMN.TYPE_PADRON)}`,
    `${alias}.${q(DESTINATION_COLUMN.ID_PROVINCE)}::text`,
    `coalesce(${alias}.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}::text, '-')`,
    `${alias}.${q(DESTINATION_COLUMN.NUMBER)}`,
  ].join(", ");

const candidateHashSql = (alias: string): string => `md5(${alias}.${q(CANDIDATE_GEOMETRY)}::text)`;

const digestEntrySql = (tag: string, columns: string[], from: string, where: string): string =>
  `SELECT concat_ws('|', ${literal(tag)}, ${columns.join(", ")}) AS ${q(ENTRY_COLUMN)} FROM ${from} WHERE ${where}`;

/* One entry for the whole deletable set: its size and an md5 over its sorted ids, so the plan-changed guard (AP-90) covers deletions without a row per padrón. */
function removalDigestEntrySql(): string {
  const idsHash = `md5(string_agg("old_id"::text, ',' ORDER BY "old_id"))`;
  return [
    `SELECT concat_ws('|', 'D', count(*), coalesce(${idsHash}, '')) AS ${q(ENTRY_COLUMN)}`,
    `FROM ${q(REMOVAL_CTE.VERDICTS)} WHERE ${DELETABLE_CONDITION}`,
  ].join(" ");
}

/* One entry per planned write: NEW keys, applied pairs (new key and old id) and applied geometry updates, each with its candidate geometry hash, plus the one deletion entry. */
function digestEntriesSql(): string {
  const planned = `${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`;
  const pairs = `${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}`;
  const changed = `${q(CTE_TARGET.CHANGED_GEOMETRY)} AS ${CHANGED_ALIAS}`;
  return [
    digestEntrySql("N", [keyTextSql(PLANNED_ALIAS), candidateHashSql(PLANNED_ALIAS)], planned, classIs(MATCH_CLASS.NEW)),
    digestEntrySql(
      "P",
      [keyTextSql(PAIR_ALIAS), pairOf(PAIR_COLUMN.TARGET_ID), candidateHashSql(PAIR_ALIAS)],
      pairs,
      appliedCondition()
    ),
    digestEntrySql(
      "C",
      [keyTextSql(CHANGED_ALIAS), changedOf(PAIR_COLUMN.TARGET_ID), candidateHashSql(CHANGED_ALIAS)],
      changed,
      changedOf(CHANGED_COLUMN.APPLIED)
    ),
    removalDigestEntrySql(),
    reassignDigestEntrySql(),
  ].join(" UNION ALL ");
}

/* The digest is an md5 over the sorted entries, so the same planned writes always give the same text under the C collation. */
function planDigestSql(): string {
  const aggregate = `string_agg(${q(ENTRY_COLUMN)}, ${literal(ENTRY_SEPARATOR)} ORDER BY ${q(ENTRY_COLUMN)} COLLATE "C")`;
  return `(SELECT md5(coalesce(${aggregate}, '')) FROM (${digestEntriesSql()}) AS ${q("entries")})`;
}

/** Cheap facts of the destination and the staging side, read in the classify statement: they change when the data does. */
function fingerprintColumnsSql(target: WritableTargetLayout): string[] {
  return [
    `(SELECT count(*) FROM ${targetTableSql(target)}) AS "target_rows"`,
    `(SELECT coalesce(max(${targetOf(target, DESTINATION_COLUMN.ID)}), 0) FROM ${targetTableSql(target)}) AS "target_max_id"`,
    `(SELECT count(*) FROM ${q(CTE_TARGET.CANDIDATES)}) AS "staging_candidates"`,
    `${planDigestSql()} AS "plan_digest"`,
  ];
}

/** A new row consumed by an applied pair is not inserted: it is the row the pair's destination row now carries. */
function unpairedNewSql(): string {
  return `${classIs(MATCH_CLASS.NEW)} AND NOT EXISTS (SELECT 1 FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS} WHERE ${appliedCondition()} AND ${sameKeySql(PLANNED_ALIAS, PAIR_ALIAS)})`;
}

function insertedRowsCte(target: WritableTargetLayout): string {
  const insertList = INSERT_COLUMNS.map((logical) => physicalColumn(target, logical)).join(", ");
  const selectList = INSERT_COLUMNS.map((logical) =>
    `${PLANNED_ALIAS}.${q(logical === DESTINATION_COLUMN.GEOMETRY ? CANDIDATE_GEOMETRY : logical)}`
  ).join(", ");
  return cte(
    CTE_TARGET.INSERTED,
    [
      `INSERT INTO ${qualifiedName(target)} (${insertList})`,
      `SELECT ${selectList} FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS} WHERE ${unpairedNewSql()}`,
      `ORDER BY ${plannedOf(DESTINATION_COLUMN.ID_PROVINCE)}, ${plannedOf(DESTINATION_COLUMN.NUMBER)}, ${plannedOf(DESTINATION_COLUMN.TYPE_PADRON)},`,
      `${plannedOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} NULLS FIRST`,
      `RETURNING ${KEY_COLUMNS.concat(DESTINATION_COLUMN.ID)
        .map((logical) => `${physicalColumn(target, logical)} AS ${q(logical)}`)
        .join(", ")}`,
    ].join(" ")
  );
}

/* The old values come from the changed row the UPDATE joins: they were read from the same statement snapshot, so RETURNING can expose them without a second scan of the destination. */
function updatedReturningSql(target: WritableTargetLayout, captureRevert: boolean): string {
  const columns = [`${targetOf(target, DESTINATION_COLUMN.ID)} AS "id"`];
  if (captureRevert) columns.push(`${changedOf(PAIR_COLUMN.TARGET_GEOMETRY)} AS "old_geometry"`);
  return columns.join(", ");
}

/* The only writes of the stage: an applied CHANGED row gets its geometry; a paired row gets type_padron, id_cadastral_locality and number, and its geometry only when updateGeometries is on. id, id_address_master and id_province are never written. */
function updatedRowsCte(target: WritableTargetLayout, captureRevert: boolean): string {
  return cte(
    CTE_TARGET.UPDATED,
    [
      `UPDATE ${targetTableSql(target)}`,
      `SET ${physicalColumn(target, DESTINATION_COLUMN.GEOMETRY)} = ${changedOf(CANDIDATE_GEOMETRY)}`,
      `FROM ${q(CTE_TARGET.CHANGED_GEOMETRY)} AS ${CHANGED_ALIAS}`,
      `WHERE ${changedOf(CHANGED_COLUMN.APPLIED)} AND ${targetOf(target, DESTINATION_COLUMN.ID)} = ${changedOf(PAIR_COLUMN.TARGET_ID)}`,
      `RETURNING ${updatedReturningSql(target, captureRevert)}`,
    ].join(" ")
  );
}

function pairedReturningSql(target: WritableTargetLayout, captureRevert: boolean): string {
  const columns = [`${targetOf(target, DESTINATION_COLUMN.ID)} AS "id"`];
  if (captureRevert) {
    columns.push(
      `${pairOf(PAIR_COLUMN.OLD_TYPE_PADRON)} AS "old_type_padron"`,
      `${pairOf(PAIR_COLUMN.OLD_LOCALITY_ID)} AS "old_id_cadastral_locality"`,
      `${pairOf(PAIR_COLUMN.OLD_NUMBER)} AS "old_number"`,
      `${pairOf(PAIR_COLUMN.TARGET_GEOMETRY)} AS "old_geometry"`
    );
  }
  return columns.join(", ");
}

function pairedRowsCte(target: WritableTargetLayout, options: ActualizarPadronOptions, captureRevert: boolean): string {
  const assignments = [
    ...PAIRED_KEY_COLUMNS.map((logical) => `${physicalColumn(target, logical)} = ${pairOf(logical)}`),
    `${physicalColumn(target, DESTINATION_COLUMN.GEOMETRY)} = CASE WHEN ${applyFlag(options)} THEN ${pairOf(CANDIDATE_GEOMETRY)} ELSE ${targetOf(target, DESTINATION_COLUMN.GEOMETRY)} END`,
  ];
  return cte(
    CTE_TARGET.PAIRED,
    [
      `UPDATE ${targetTableSql(target)}`,
      `SET ${assignments.join(", ")}`,
      `FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}`,
      `WHERE ${appliedCondition()} AND ${targetOf(target, DESTINATION_COLUMN.ID)} = ${pairOf(PAIR_COLUMN.TARGET_ID)}`,
      `RETURNING ${pairedReturningSql(target, captureRevert)}`,
    ].join(" ")
  );
}

/* Writes the old values of every changed row into the session's revert table, before COMMIT. Kinds: U geometry updated, P pair updated, I row inserted. */
function revertRowsCte(): string {
  const [uKind, pKind, iKind] = [REVERT_KIND.UPDATED, REVERT_KIND.PAIRED, REVERT_KIND.INSERTED].map((kind) => literal(kind));
  return cte(
    CTE_TARGET.REVERT,
    [
      `INSERT INTO ${REVERT_TABLE_SQL} (${revertColumnList()})`,
      `SELECT ${uKind}, u."id", NULL, NULL, NULL, u."old_geometry", NULL::integer, NULL::integer FROM ${q(CTE_TARGET.UPDATED)} AS u`,
      `UNION ALL SELECT ${pKind}, p."id", p."old_type_padron", p."old_id_cadastral_locality", p."old_number", p."old_geometry", NULL::integer, NULL::integer FROM ${q(CTE_TARGET.PAIRED)} AS p`,
      `UNION ALL SELECT ${iKind}, i."id", NULL, NULL, NULL, NULL, NULL::integer, NULL::integer FROM ${q(CTE_TARGET.INSERTED)} AS i`,
      `RETURNING ${q(REVERT_COLUMN.KIND)}`,
    ].join(" ")
  );
}

const INSERTED_LIST_SQL = [
  `SELECT ir."id", pc.${q(DEPARTMENT_COLUMN)} AS "department", pc.${q(LOCALITY_NAME_COLUMN)} AS "locality",`,
  `ir.${q(DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron", ir.${q(DESTINATION_COLUMN.ID_PROVINCE)} AS "provinceId",`,
  `ir.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS "localityId", ir.${q(DESTINATION_COLUMN.NUMBER)} AS "number"`,
  `FROM ${q(CTE_TARGET.INSERTED)} AS ir JOIN ${q(CTE_TARGET.PLANNED)} AS pc ON ${sameKeySql("ir", "pc")}`,
  `ORDER BY ir."id" LIMIT ${DETAIL_LIST_LIMIT}`,
].join(" ");

function revertCountSql(captureRevert: boolean): string[] {
  return captureRevert ? [`(SELECT count(*) FROM ${q(CTE_TARGET.REVERT)}) AS "revert_rows",`] : [];
}

/* AP-113: the ids this statement inserted, kept for the reassign statement so its receivers are exactly this run's inserts. */
function insertedIdsStoreCte(): string {
  return cte(
    CTE_TARGET.INSERTED_STORE,
    [
      `INSERT INTO ${INSERTED_IDS_TABLE_SQL} (${q(SESSION_IDS_COLUMN)})`,
      `SELECT ir.${q(DESTINATION_COLUMN.ID)} FROM ${q(CTE_TARGET.INSERTED)} AS ir`,
      `RETURNING ${q(SESSION_IDS_COLUMN)}`,
    ].join(" ")
  );
}

export function buildPadronApplySql(
  layouts: PadronLayouts,
  options: ActualizarPadronOptions,
  { captureRevert = false, storeInsertedIds = false }: ApplySqlOptions = {}
): string {
  const { target } = layouts;
  return [
    withClause([
      ...classifyCtes(layouts, options),
      insertedRowsCte(target),
      ...(storeInsertedIds ? [insertedIdsStoreCte()] : []),
      updatedRowsCte(target, captureRevert),
      pairedRowsCte(target, options, captureRevert),
      ...(captureRevert ? [revertRowsCte()] : []),
    ]),
    "SELECT",
    `(SELECT count(*) FROM ${q(CTE_TARGET.INSERTED)}) AS "inserted",`,
    `(SELECT count(*) FROM ${q(CTE_TARGET.UPDATED)}) AS "updated",`,
    `(SELECT count(*) FROM ${q(CTE_TARGET.PAIRED)}) AS "paired",`,
    ...revertCountSql(captureRevert),
    `${jsonArrayOf(INSERTED_LIST_SQL, "inserted_list")} AS "inserted_list"`,
  ].join(" ");
}

