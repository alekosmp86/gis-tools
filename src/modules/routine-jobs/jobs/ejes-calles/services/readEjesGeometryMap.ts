import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { Geometry } from "geojson";
import { getDiscrepancyLabel, MAP_SECTION_TYPE } from "@/core/constants/mapConstants";
import { MapFeatureNotFoundError } from "../../actualizar-padron/domain/geometryMap";
import { createStepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunSession } from "../../cargar-padrones/types";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { resolveTable, type ResolvedTable, type TableSpec } from "../../shared/tableResolution";
import { runTransaction, withRunSession } from "../../shared/transaction";
import { EJES_REQUIRED_COLUMNS_BY_ROLE, EJES_TABLE_ROLE, PADRON_TYPE, ROAD_SECTION_COLUMN, STAGING_COLUMN, type EjesTableRole, type PadronType } from "../constants";
import { EJES_MAP_ROLE, EJES_MAP_STATEMENT_TIMEOUT, newSectionOutlineSql, oldSectionOutlineSql, zoneOutlineSql } from "../domain/geometryMap";
import type { EjesGeometryMapParams, EjesMapFeature, EjesTableRef } from "../types";
import { padronSridIssuesOf, sridIssuesOf } from "./resolveLayouts";

const MAP_JOB_LABEL = "lectura de geometrías de ejes";
const MAP_UNTOUCHED = "No se modificó ninguna tabla.";
const MAP_UNVERIFIED = "No se pudo confirmar que la sesión terminara limpia.";

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
  label: string
): Promise<EjesMapFeature> {
  const geometry = await outlineOf(session, sql, [reference]);
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

/** Split and merge maps never touch the padrones table: it is resolved only when an item asks for a zone. */
async function resolvePadronesIfZoned(session: RunSession, params: EjesGeometryMapParams): Promise<ResolvedTable | null> {
  if (!params.items.some((item) => item.zoneOf !== undefined)) return null;
  return resolveTable(session, specOf(params.padrones, EJES_TABLE_ROLE.PADRONES));
}

/**
 * Reads the outlines of the requested items. The catalog checks run first; every read is in one read-only transaction.
 * One pg client must never run two queries at once, so every read is awaited in turn and the features keep the item order.
 */
async function readFeatures(session: RunSession, params: EjesGeometryMapParams): Promise<EjesMapFeature[]> {
  await session.query(`SET LOCAL statement_timeout = '${EJES_MAP_STATEMENT_TIMEOUT}'`);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const staging = await resolveTable(session, specOf(params.staging, EJES_TABLE_ROLE.STAGING));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const roadSection = await resolveTable(session, specOf(params.roadSection, EJES_TABLE_ROLE.ROAD_SECTION));
  const padrones = await resolvePadronesIfZoned(session, params);
  throwIfIssues([
    ...staging.issues,
    ...sridIssuesOf(staging, STAGING_COLUMN.GEOM),
    ...roadSection.issues,
    ...sridIssuesOf(roadSection, ROAD_SECTION_COLUMN.GEOMETRY),
    ...(padrones === null ? [] : [...padrones.issues, ...padronSridIssuesOf(padrones)]),
  ]);
  const oldSql = oldSectionOutlineSql(roadSection.layout);
  const newSql = newSectionOutlineSql(staging.layout);
  const zoneSql = padrones === null ? null : zoneOutlineSql(staging.layout, padrones.layout);
  const features: EjesMapFeature[] = [];
  for (const [itemIndex, item] of params.items.entries()) {
    const entry = item;
    if (entry.oldRef !== undefined) {
      // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
      features.push(await featureOf(session, oldSql, entry.oldRef, itemIndex, EJES_MAP_ROLE.OLD, `Tramo anterior ${entry.oldRef}`));
    }
    if (entry.newRef !== undefined) {
      // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
      features.push(await featureOf(session, newSql, entry.newRef, itemIndex, EJES_MAP_ROLE.NEW, `Tramo nuevo ${entry.newRef}`));
    }
    if (zoneSql !== null && entry.zoneOf !== undefined && entry.type !== undefined) {
      // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
      features.push(...(await zoneFeatureOf(session, zoneSql, entry.zoneOf, entry.type, itemIndex)));
    }
  }
  return features;
}

interface CapturedNotFound {
  error?: MapFeatureNotFoundError;
}

/** runTransaction rewraps every work error, so the not-found error is kept aside and rethrown once the transaction has ended. */
async function readFeaturesCapturingNotFound(
  session: RunSession,
  params: EjesGeometryMapParams,
  captured: CapturedNotFound
): Promise<EjesMapFeature[]> {
  try {
    return await readFeatures(session, params);
  } catch (error: unknown) {
    if (!(error instanceof MapFeatureNotFoundError)) throw error;
    captured.error = error;
    return [];
  }
}

/** Read-only: the transaction is rolled back, nothing is written, and the statement timeout bounds every read. */
export async function readEjesGeometryMap(params: EjesGeometryMapParams, deps: RunDeps): Promise<EjesMapFeature[]> {
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
