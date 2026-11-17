import type { Geometry } from "geojson";
import { createStepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunSession } from "../../cargar-padrones/types";
import { resolveTable, type ResolvedTable, type TableSpec } from "../../shared/tableResolution";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { runTransaction, withRunSession } from "../../shared/transaction";
import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import {
  ADDRESS_COLUMN,
  EJES_REQUIRED_COLUMNS_BY_ROLE,
  EJES_STAGING_COLUMN,
  EJES_TABLE_ROLE,
  ROAD_SECTION_COLUMN,
  type EjesTableRole,
} from "../constants";
import { EJES_MAP_STATEMENT_TIMEOUT, newSectionOutlineSql, oldSectionOutlineSql } from "../domain/geometryMap";
import { circulationWayNamesSql, oldSectionStreetSql, splitPointDetailSql } from "../domain/splitPointDetailSql";
import type {
  EjesReviewStore,
  EjesSplitPiece,
  EjesSplitPointsPage,
  EjesSplitPointsParams,
  EjesSplitReviewPoint,
  EjesStoredReviewPoint,
  EjesStreet,
} from "../types";
import { sridIssuesOf } from "./resolveLayouts";

const JOB_LABEL = "lectura de los puntos de una división";
const READ_UNTOUCHED = "No se modificó ninguna tabla.";
const READ_UNVERIFIED = "No se pudo confirmar que la sesión terminara limpia.";

const specOf = (ref: { schema: string; table: string }, role: EjesTableRole): TableSpec => ({
  label: buildQualifiedTableLabel(ref.schema, ref.table),
  schema: ref.schema,
  table: ref.table,
  required: EJES_REQUIRED_COLUMNS_BY_ROLE[role],
});

interface ResolvedSplitTables {
  staging: ResolvedTable;
  roadSection: ResolvedTable;
  access: ResolvedTable;
  address: ResolvedTable;
  circulationWay: ResolvedTable;
  addressIssues: string[];
}

/** The five tables a page reads by key or small lookup: their columns must exist; a wrong address SRID is information (its points have no geometry). */
async function resolveSplitTables(session: RunSession, params: EjesSplitPointsParams): Promise<ResolvedSplitTables> {
  // One pg client: catalog reads are awaited in turn, so they never overlap.
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const staging = await resolveTable(session, specOf(params.tables[EJES_TABLE_ROLE.STAGING], EJES_TABLE_ROLE.STAGING));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const roadSection = await resolveTable(session, specOf(params.tables[EJES_TABLE_ROLE.ROAD_SECTION], EJES_TABLE_ROLE.ROAD_SECTION));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const access = await resolveTable(session, specOf(params.tables[EJES_TABLE_ROLE.ACCESS_POINT], EJES_TABLE_ROLE.ACCESS_POINT));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const address = await resolveTable(session, specOf(params.tables[EJES_TABLE_ROLE.ADDRESS], EJES_TABLE_ROLE.ADDRESS));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const circulationWay = await resolveTable(session, specOf(params.tables[EJES_TABLE_ROLE.CIRCULATION_WAY], EJES_TABLE_ROLE.CIRCULATION_WAY));
  throwIfIssues([
    ...staging.issues,
    ...sridIssuesOf(staging, EJES_STAGING_COLUMN.GEOM),
    ...roadSection.issues,
    ...sridIssuesOf(roadSection, ROAD_SECTION_COLUMN.GEOMETRY),
    ...access.issues,
    ...address.issues,
    ...circulationWay.issues,
  ]);
  return { staging, roadSection, access, address, circulationWay, addressIssues: sridIssuesOf(address, ADDRESS_COLUMN.GEOMETRY, false) };
}

interface RawDetail {
  pointId: string;
  number: string | null;
  letter: string | null;
  km: string | null;
  circulationWay: string | null;
  idcalle: string | null;
  geometry: Geometry | null;
}

async function readPieces(session: RunSession, staging: ResolvedTable, newRefs: readonly string[]): Promise<EjesSplitPiece[]> {
  const sql = newSectionOutlineSql(staging.layout);
  const pieces: EjesSplitPiece[] = [];
  for (const newRef of newRefs) {
    // One pg client: the piece outlines are read in turn.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    const result = await session.query(sql, [newRef]);
    const geometry = (result.rows[0]?.geojson as Geometry | null | undefined) ?? null;
    if (geometry !== null) pieces.push({ newRef, geometry });
  }
  return pieces;
}

async function readOldGeometry(session: RunSession, roadSection: ResolvedTable, oldRef: string): Promise<Geometry | null> {
  const result = await session.query(oldSectionOutlineSql(roadSection.layout), [Number(oldRef)]);
  return (result.rows[0]?.geojson as Geometry | null | undefined) ?? null;
}

async function readOldIdcalle(session: RunSession, roadSection: ResolvedTable, oldRef: string): Promise<string | null> {
  const result = await session.query(oldSectionStreetSql(roadSection.layout), [Number(oldRef)]);
  return (result.rows[0]?.idcalle as string | null | undefined) ?? null;
}

async function readDetails(session: RunSession, tables: ResolvedSplitTables, pointIds: readonly string[]): Promise<RawDetail[]> {
  const result = await session.query(splitPointDetailSql(tables.access.layout, tables.address.layout), [pointIds]);
  return result.rows.map((row) => ({
    pointId: String(row.pointId),
    number: (row.number as string | null | undefined) ?? null,
    letter: (row.letter as string | null | undefined) ?? null,
    km: (row.km as string | null | undefined) ?? null,
    circulationWay: (row.circulationWay as string | null | undefined) ?? null,
    idcalle: (row.idcalle as string | null | undefined) ?? null,
    geometry: (row.geometry as Geometry | null | undefined) ?? null,
  }));
}

/** The name of each street, by its `idcalle`: the streets the page names, none twice. */
async function readStreetNames(session: RunSession, circulationWay: ResolvedTable, idcalles: readonly string[]): Promise<Map<string, string | null>> {
  if (idcalles.length === 0) return new Map();
  const result = await session.query(circulationWayNamesSql(circulationWay.layout), [idcalles]);
  return new Map(result.rows.map((row) => [String(row.idcalle), (row.name as string | null | undefined) ?? null]));
}

type StreetOf = (idcalle: string | null) => EjesStreet | null;

const streetResolverOf =
  (names: ReadonlyMap<string, string | null>): StreetOf =>
  (idcalle) =>
    idcalle === null ? null : { idcalle, name: names.get(idcalle) ?? null };

/** A stored point and its read detail as the page shows them: the stored reason and candidates, the door data, the street and the geometry. */
function pointOf(stored: EjesStoredReviewPoint, detail: RawDetail | undefined, streetOf: StreetOf): EjesSplitReviewPoint {
  return {
    pointId: stored.pointId,
    reason: stored.reason,
    number: detail?.number ?? null,
    letter: detail?.letter ?? null,
    km: detail?.km ?? null,
    circulationWay: detail?.circulationWay ?? null,
    geometry: detail?.geometry ?? null,
    pointStreet: streetOf(detail?.idcalle ?? null),
    candidates: stored.candidates.map((candidate) => ({
      newRef: candidate.newRef,
      distance: candidate.distance,
      isSuggestion: candidate.newRef === stored.suggestedRef,
    })),
  };
}

const byNumericValue = (first: string, second: string): number => Number(first) - Number(second);

/** The stored points of one split, in point order. */
function storedRowsOf(stored: readonly EjesStoredReviewPoint[], oldRef: string): EjesStoredReviewPoint[] {
  return stored
    .filter((point) => point.oldRef === oldRef)
    .sort((first, second) => byNumericValue(first.pointId, second.pointId));
}

/** The pieces of the split: every stored point lists all of them as candidates, so the first point names them all. */
const piecesRefsOf = (rows: readonly EjesStoredReviewPoint[]): string[] =>
  (rows[0]?.candidates.map((candidate) => candidate.newRef) ?? []).sort(byNumericValue);

/** The distinct streets of the page: the points' and the old section's, none null. */
const streetIdcallesOf = (details: readonly RawDetail[], oldIdcalle: string | null): string[] => {
  const values = [...details.map((detail) => detail.idcalle), oldIdcalle];
  return [...new Set(values.filter((value): value is string => value !== null))];
};

interface SplitPageRead {
  pieces: EjesSplitPiece[];
  oldGeometry: Geometry | null;
  oldIdcalle: string | null;
  details: RawDetail[];
  streetNames: Map<string, string | null>;
  addressIssues: string[];
}

async function readPage(
  session: RunSession,
  params: EjesSplitPointsParams,
  rows: readonly EjesStoredReviewPoint[],
  pageRows: readonly EjesStoredReviewPoint[]
): Promise<SplitPageRead> {
  await session.query(`SET LOCAL statement_timeout = '${EJES_MAP_STATEMENT_TIMEOUT}'`);
  const tables = await resolveSplitTables(session, params);
  // One pg client: the piece, section, point and street reads follow each other.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const pieces = await readPieces(session, tables.staging, piecesRefsOf(rows));
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const oldGeometry = await readOldGeometry(session, tables.roadSection, params.oldRef);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const oldIdcalle = await readOldIdcalle(session, tables.roadSection, params.oldRef);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const details = await readDetails(session, tables, pageRows.map((point) => point.pointId));
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const streetNames = await readStreetNames(session, tables.circulationWay, streetIdcallesOf(details, oldIdcalle));
  return { pieces, oldGeometry, oldIdcalle, details, streetNames, addressIssues: tables.addressIssues };
}

/**
 * Read-only: one page of the review points of one split, from the points the dry run `jobId` kept (no analysis runs here). The page
 * reads the door fields, the streets, the point geometries and the sections by primary key or small lookup. Null when the dry run is no
 * longer kept.
 */
export async function readEjesSplitPoints(
  params: EjesSplitPointsParams,
  deps: RunDeps,
  reviews: EjesReviewStore
): Promise<EjesSplitPointsPage | null> {
  const stored = reviews.read(params.jobId);
  if (stored === undefined) return null;
  const rows = storedRowsOf(stored, params.oldRef);
  const pageRows = rows.slice(params.offset, params.offset + params.limit);
  const empty: SplitPageRead = { pieces: [], oldGeometry: null, oldIdcalle: null, details: [], streetNames: new Map(), addressIssues: [] };
  const read = pageRows.length === 0 ? empty : await readSplitPage(params, deps, rows, pageRows);
  const detailById = new Map(read.details.map((detail) => [detail.pointId, detail]));
  const streetOf = streetResolverOf(read.streetNames);
  return {
    oldRef: params.oldRef,
    total: rows.length,
    offset: params.offset,
    limit: params.limit,
    points: pageRows.map((point) => pointOf(point, detailById.get(point.pointId), streetOf)),
    pieces: read.pieces,
    oldGeometry: read.oldGeometry,
    oldStreet: streetOf(read.oldIdcalle),
    addressIssues: read.addressIssues,
  };
}

async function readSplitPage(
  params: EjesSplitPointsParams,
  deps: RunDeps,
  rows: readonly EjesStoredReviewPoint[],
  pageRows: readonly EjesStoredReviewPoint[]
): Promise<SplitPageRead> {
  const outcome = await withRunSession(params.config, deps, (session) =>
    runTransaction(
      session,
      {
        dryRun: true,
        readOnly: true,
        secret: params.config.password,
        timer: createStepTimer({ now: deps.now, total: 0 }),
        steps: { commit: "", rollback: "" },
        messages: { jobLabel: JOB_LABEL, untouched: READ_UNTOUCHED, unverified: READ_UNVERIFIED },
      },
      () => readPage(session, params, rows, pageRows)
    )
  );
  return outcome.body;
}
