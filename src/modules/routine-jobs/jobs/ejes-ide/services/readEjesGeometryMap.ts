import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { Geometry } from "geojson";
import { getDiscrepancyLabel, MAP_SECTION_TYPE } from "@/core/constants/mapConstants";
import { MapFeatureNotFoundError } from "../../actualizar-padron/domain/geometryMap";
import { createStepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunSession } from "../../cargar-padrones/types";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { resolveTable, type ResolvedTable, type TableSpec } from "../../shared/tableResolution";
import { runTransaction, withRunSession } from "../../shared/transaction";
import {
  DEPARTMENTS_COLUMN,
  EJES_REQUIRED_COLUMNS_BY_ROLE,
  EJES_TABLE_ROLE,
  LOCALITIES_COLUMN,
  MANUAL_CANDIDATE_RADIUS_M,
  PADRON_TYPE,
  ROAD_SECTION_COLUMN,
  EJES_STAGING_COLUMN,
  type EjesTableRole,
  type PadronType,
} from "../constants";
import {
  accessPointOutlinesSql,
  candidateSectionsSql,
  departmentOutlineSql,
  EJES_MAP_ROLE,
  EJES_MAP_STATEMENT_TIMEOUT,
  localityOverlapSql,
  neighbourSectionsSql,
  newSectionOutlineSql,
  oldSectionOutlineSql,
  zoneOutlineSql,
} from "../domain/geometryMap";
import type {
  EjesGeometryMapParams,
  EjesGeometryMapResult,
  EjesMapCandidate,
  EjesMapFeature,
  EjesMapItem,
  EjesMapNeighbour,
  EjesTableRef,
} from "../types";
import { padronSridIssuesOf, sridIssuesOf } from "./resolveLayouts";
import { textOf, type Row } from "../../shared/rowMapping";

const MAP_JOB_LABEL = "lectura de geometrías de ejes";
const MAP_UNTOUCHED = "No se modificó ninguna tabla.";
const MAP_UNVERIFIED = "No se pudo confirmar que la sesión terminara limpia.";
const LOCALITY_LABEL_SEPARATOR = " · ";
const PERCENT = 100;

type MapItemKey = "zoneOf" | "localitiesOf" | "departmentOf" | "candidatesOf";

const specOf = (ref: EjesTableRef, role: EjesTableRole): TableSpec => ({
  label: buildQualifiedTableLabel(ref.schema, ref.table),
  schema: ref.schema,
  table: ref.table,
  required: EJES_REQUIRED_COLUMNS_BY_ROLE[role],
});

const ZONE_LABEL: Record<PadronType, string> = {
  [PADRON_TYPE.URBAN]: getDiscrepancyLabel(MAP_SECTION_TYPE.URBAN_ZONE),
  [PADRON_TYPE.RURAL]: getDiscrepancyLabel(MAP_SECTION_TYPE.RURAL_ZONE),
};

/** A locality on the map: its name, the metres of the section inside it and the share of the section that is. */
const localityLabelOf = (name: string, overlap: number, length: number): string => {
  const percent = length > 0 ? Math.round((overlap / length) * PERCENT) : 0;
  return `${name}${LOCALITY_LABEL_SEPARATOR}${Math.round(overlap)} m (${percent}%)`;
};

const usesItem = (params: EjesGeometryMapParams, key: MapItemKey): boolean => params.items.some((item) => item[key] !== undefined);

async function resolveIf(session: RunSession, used: boolean, table: EjesTableRef, role: EjesTableRole): Promise<ResolvedTable | null> {
  return used ? resolveTable(session, specOf(table, role)) : null;
}

async function outlineOf(session: RunSession, sql: string, values: Array<string | number>): Promise<Geometry | null> {
  const result = await session.query(sql, values);
  const geojson = result.rows[0]?.geojson;
  return geojson === null || geojson === undefined ? null : (geojson as Geometry);
}

async function featureOf(
  session: RunSession,
  sql: string,
  reference: string | number,
  itemIndex: number,
  role: EjesMapFeature["role"],
  label: string,
  locality?: string
): Promise<EjesMapFeature> {
  const geometry = await outlineOf(session, sql, locality === undefined ? [reference] : [reference, locality]);
  if (geometry === null) throw new MapFeatureNotFoundError(`No existe el tramo con reftramo ${reference} o no tiene geometría.`);
  return { itemIndex, role, label, geometry };
}

/** A zone with no padron near is no feature and no error. */
async function zoneFeatureOf(
  session: RunSession,
  sql: string,
  reference: string,
  type: PadronType,
  itemIndex: number
): Promise<EjesMapFeature[]> {
  const geometry = await outlineOf(session, sql, [reference, type]);
  return geometry === null ? [] : [{ itemIndex, role: EJES_MAP_ROLE.ZONE, label: ZONE_LABEL[type], geometry }];
}

/** One feature per locality the section crosses, each named by its own label; a section crossing none is no feature and no error. */
async function localityFeaturesOf(session: RunSession, sql: string, reference: string, itemIndex: number): Promise<EjesMapFeature[]> {
  const result = await session.query(sql, [reference]);
  return result.rows.map((row) => ({
    itemIndex,
    role: EJES_MAP_ROLE.LOCALITY,
    label: localityLabelOf(String(row.name), Number(row.overlap), Number(row.length)),
    geometry: row.geojson as Geometry,
  }));
}

async function departmentFeaturesOf(session: RunSession, sql: string, reference: string, itemIndex: number): Promise<EjesMapFeature[]> {
  const result = await session.query(sql, [reference]);
  return result.rows.map((row) => ({ itemIndex, role: EJES_MAP_ROLE.DEPARTMENT, label: String(row.name), geometry: row.geojson as Geometry }));
}

interface MapTables {
  staging: ResolvedTable;
  roadSection: ResolvedTable;
  padrones: ResolvedTable | null;
  localities: ResolvedTable | null;
  departments: ResolvedTable | null;
  accessPoints: ResolvedTable | null;
  addresses: ResolvedTable | null;
}

const optionalIssuesOf = (resolved: ResolvedTable | null, sridIssues: (table: ResolvedTable) => string[]): string[] =>
  resolved === null ? [] : [...resolved.issues, ...sridIssues(resolved)];

/** Split and merge maps never touch the padrones, localities, departments, access points or addresses: each is resolved only when an item asks for it. */
async function resolveMapTables(session: RunSession, params: EjesGeometryMapParams): Promise<MapTables> {
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const staging = await resolveTable(session, specOf(params.staging, EJES_TABLE_ROLE.STAGING));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const roadSection = await resolveTable(session, specOf(params.roadSection, EJES_TABLE_ROLE.ROAD_SECTION));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const padrones = await resolveIf(session, usesItem(params, "zoneOf"), params.padrones, EJES_TABLE_ROLE.PADRONES);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const localities = await resolveIf(session, usesItem(params, "localitiesOf"), params.localities, EJES_TABLE_ROLE.LOCALITIES);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const departments = await resolveIf(session, usesItem(params, "departmentOf"), params.departments, EJES_TABLE_ROLE.DEPARTMENTS);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const accessPoints = await resolveIf(session, usesItem(params, "candidatesOf"), params.accessPoints, EJES_TABLE_ROLE.ACCESS_POINT);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const addresses = await resolveIf(session, usesItem(params, "candidatesOf"), params.addresses, EJES_TABLE_ROLE.ADDRESS);
  throwIfIssues([
    ...staging.issues,
    ...sridIssuesOf(staging, EJES_STAGING_COLUMN.GEOM),
    ...roadSection.issues,
    ...sridIssuesOf(roadSection, ROAD_SECTION_COLUMN.GEOMETRY),
    ...optionalIssuesOf(padrones, padronSridIssuesOf),
    ...optionalIssuesOf(localities, (table) => sridIssuesOf(table, LOCALITIES_COLUMN.GEOM, false)),
    ...optionalIssuesOf(departments, (table) => sridIssuesOf(table, DEPARTMENTS_COLUMN.GEOM, false)),
    ...optionalIssuesOf(accessPoints, () => []),
    ...optionalIssuesOf(addresses, () => []),
  ]);
  return { staging, roadSection, padrones, localities, departments, accessPoints, addresses };
}

/** The SQL of one manual-split read in its two street variants: the same street only, or the other streets too. */
interface StreetSql {
  sameStreet: string;
  otherStreets: string;
}

/** The SQL of each kind of item; a kind whose table was not resolved has none. */
interface MapSql {
  old: string;
  newRef: string;
  copy: string;
  zone: string | null;
  locality: string | null;
  department: string | null;
  candidates: StreetSql | null;
  neighbours: StreetSql | null;
  accessPoints: string | null;
}

const streetVariantsOf = (build: (otherStreets: boolean) => string): StreetSql => ({ sameStreet: build(false), otherStreets: build(true) });

const streetSqlOf = (variants: StreetSql, entry: EjesMapItem): string => (entry.otherStreets === true ? variants.otherStreets : variants.sameStreet);

function mapSqlOf({ staging, roadSection, padrones, localities, departments, accessPoints, addresses }: MapTables): MapSql {
  return {
    old: oldSectionOutlineSql(roadSection.layout),
    newRef: newSectionOutlineSql(staging.layout),
    copy: newSectionOutlineSql(staging.layout, true),
    zone: padrones === null ? null : zoneOutlineSql(staging.layout, padrones.layout),
    locality: localities === null ? null : localityOverlapSql(staging.layout, localities.layout),
    department: departments === null ? null : departmentOutlineSql(staging.layout, departments.layout),
    candidates:
      accessPoints === null
        ? null
        : streetVariantsOf((otherStreets) => candidateSectionsSql(staging.layout, roadSection.layout, accessPoints.layout, otherStreets)),
    neighbours:
      accessPoints === null
        ? null
        : streetVariantsOf((otherStreets) => neighbourSectionsSql(staging.layout, roadSection.layout, accessPoints.layout, otherStreets)),
    accessPoints: accessPoints === null || addresses === null ? null : accessPointOutlinesSql(accessPoints.layout, addresses.layout),
  };
}

/** The features of one request item, in the order of its kinds. Every read is awaited in turn: one pg client runs one query at a time. */
async function itemFeaturesOf(session: RunSession, sql: MapSql, entry: EjesMapItem, itemIndex: number): Promise<EjesMapFeature[]> {
  const features: EjesMapFeature[] = [];
  if (entry.oldRef !== undefined) {
    // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
    features.push(await featureOf(session, sql.old, entry.oldRef, itemIndex, EJES_MAP_ROLE.OLD, `Tramo anterior ${entry.oldRef}`));
  }
  if (entry.newRef !== undefined) {
    // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
    const newSql = entry.locality === undefined ? sql.newRef : sql.copy;
    features.push(await featureOf(session, newSql, entry.newRef, itemIndex, EJES_MAP_ROLE.NEW, `Tramo nuevo ${entry.newRef}`, entry.locality));
  }
  if (sql.zone !== null && entry.zoneOf !== undefined && entry.type !== undefined) {
    // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
    features.push(...(await zoneFeatureOf(session, sql.zone, entry.zoneOf, entry.type, itemIndex)));
  }
  if (sql.locality !== null && entry.localitiesOf !== undefined) {
    // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
    features.push(...(await localityFeaturesOf(session, sql.locality, entry.localitiesOf, itemIndex)));
  }
  if (sql.department !== null && entry.departmentOf !== undefined) {
    // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
    features.push(...(await departmentFeaturesOf(session, sql.department, entry.departmentOf, itemIndex)));
  }
  return features;
}

const candidateOf = (oldRef: string, row: Row): EjesMapCandidate => ({
  oldRef,
  ref: String(row.ref),
  idcalle: textOf(row.idcalle),
  name: textOf(row.name),
  localities: textOf(row.localities),
  length: Number(row.length),
  nearLength: Number(row.near_length),
  coveredLength: Number(row.covered_length),
  coveredPercent: Number(row.covered_percent),
  distance: Number(row.distance),
});

const neighbourOf = (row: Row): EjesMapNeighbour => ({
  ref: String(row.ref),
  idcalle: textOf(row.idcalle),
  length: Number(row.length),
  points: Number(row.points),
  distance: Number(row.distance),
  covered: row.covered === true,
});

const rowFeaturesOf = (rows: readonly Row[], itemIndex: number, role: EjesMapFeature["role"], labelOf: (row: Row) => string): EjesMapFeature[] =>
  rows.map((row) => ({ itemIndex, role, label: labelOf(row), geometry: row.geojson as Geometry }));

const emptyResult = (): EjesGeometryMapResult => ({ features: [], candidates: [], neighbours: [] });

/**
 * The candidate new sections and the neighbour old sections of a manual split (EJS-22): the old section's outline, its access points as
 * points, one outline per candidate with its figures, then one outline per neighbour in the neighbours' order. The old section must exist
 * (not found otherwise); the radius is the item's or the default.
 */
async function candidateItemOf(session: RunSession, sql: MapSql, entry: EjesMapItem, itemIndex: number): Promise<EjesGeometryMapResult> {
  const oldRef = entry.candidatesOf;
  if (oldRef === undefined || sql.candidates === null || sql.neighbours === null) return emptyResult();
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const oldFeature = await featureOf(session, sql.old, oldRef, itemIndex, EJES_MAP_ROLE.OLD, `Tramo anterior ${oldRef}`);
  const radius = entry.radius ?? MANUAL_CANDIDATE_RADIUS_M;
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const candidateRows = (await session.query(streetSqlOf(sql.candidates, entry), [oldRef, radius])).rows;
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const neighbourRows = (await session.query(streetSqlOf(sql.neighbours, entry), [oldRef, radius, entry.coveredBy ?? []])).rows;
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const pointRows = sql.accessPoints === null ? [] : (await session.query(sql.accessPoints, [oldRef])).rows;
  return {
    features: [
      oldFeature,
      ...rowFeaturesOf(pointRows, itemIndex, EJES_MAP_ROLE.ACCESS, (row) => `Punto de acceso ${String(row.id)}`),
      ...rowFeaturesOf(candidateRows, itemIndex, EJES_MAP_ROLE.NEW, (row) => `Tramo nuevo ${String(row.ref)}`),
      ...rowFeaturesOf(neighbourRows, itemIndex, EJES_MAP_ROLE.NEIGHBOUR, (row) => `Tramo viejo vecino ${String(row.ref)}`),
    ],
    candidates: candidateRows.map((row) => candidateOf(String(oldRef), row)),
    neighbours: neighbourRows.map(neighbourOf),
  };
}

/**
 * Reads the outlines of the requested items. The catalog checks run first; every read is in one read-only transaction.
 * One pg client must never run two queries at once, so every read is awaited in turn and the features keep the item order.
 */
async function readFeatures(session: RunSession, params: EjesGeometryMapParams): Promise<EjesGeometryMapResult> {
  await session.query(`SET LOCAL statement_timeout = '${EJES_MAP_STATEMENT_TIMEOUT}'`);
  const sql = mapSqlOf(await resolveMapTables(session, params));
  const result = emptyResult();
  for (const [itemIndex, entry] of params.items.entries()) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    result.features.push(...(await itemFeaturesOf(session, sql, entry, itemIndex)));
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    const manual = await candidateItemOf(session, sql, entry, itemIndex);
    result.features.push(...manual.features);
    result.candidates.push(...manual.candidates);
    result.neighbours.push(...manual.neighbours);
  }
  return result;
}

interface CapturedNotFound {
  error?: MapFeatureNotFoundError;
}

/** runTransaction rewraps every work error, so the not-found error is kept aside and rethrown once the transaction has ended. */
async function readFeaturesCapturingNotFound(
  session: RunSession,
  params: EjesGeometryMapParams,
  captured: CapturedNotFound
): Promise<EjesGeometryMapResult> {
  try {
    return await readFeatures(session, params);
  } catch (error: unknown) {
    if (!(error instanceof MapFeatureNotFoundError)) throw error;
    captured.error = error;
    return emptyResult();
  }
}

/** Read-only: the transaction is rolled back, nothing is written, and the statement timeout bounds every read. */
export async function readEjesGeometryMap(params: EjesGeometryMapParams, deps: RunDeps): Promise<EjesGeometryMapResult> {
  const captured: CapturedNotFound = {};
  const outcome = await withRunSession(params.config, deps, (session) =>
    runTransaction(
      session,
      {
        dryRun: true,
        readOnly: true,
        secret: params.config.password,
        timer: createStepTimer({ now: deps.now, total: 0 }),
        steps: { commit: "", rollback: "" },
        messages: { jobLabel: MAP_JOB_LABEL, untouched: MAP_UNTOUCHED, unverified: MAP_UNVERIFIED },
      },
      () => readFeaturesCapturingNotFound(session, params, captured)
    )
  );
  if (captured.error !== undefined) throw captured.error;
  return outcome.body;
}
