import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { Geometry } from "geojson";
import { GEOMETRY_MAP_ROLE } from "../../actualizar-padron/constants";
import { MapFeatureNotFoundError } from "../../actualizar-padron/domain/geometryMap";
import { createStepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunSession } from "../../cargar-padrones/types";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { resolveTable, type TableSpec } from "../../shared/tableResolution";
import { runTransaction, withRunSession } from "../../shared/transaction";
import { EJES_REQUIRED_COLUMNS_BY_ROLE, EJES_TABLE_ROLE, ROAD_SECTION_COLUMN, STAGING_COLUMN, type EjesTableRole } from "../constants";
import { EJES_MAP_STATEMENT_TIMEOUT, newSectionOutlineSql, oldSectionOutlineSql } from "../domain/geometryMap";
import type { EjesGeometryMapParams, EjesMapFeature, EjesTableRef } from "../types";
import { sridIssuesOf } from "./resolveLayouts";

const MAP_JOB_LABEL = "lectura de geometrías de ejes";
const MAP_UNTOUCHED = "No se modificó ninguna tabla.";
const MAP_UNVERIFIED = "No se pudo confirmar que la sesión terminara limpia.";

const specOf = (ref: EjesTableRef, role: EjesTableRole): TableSpec => ({
  label: buildQualifiedTableLabel(ref.schema, ref.table),
  schema: ref.schema,
  table: ref.table,
  required: EJES_REQUIRED_COLUMNS_BY_ROLE[role],
});

async function featureOf(
  session: RunSession,
  sql: string,
  reference: string | number,
  itemIndex: number,
  role: EjesMapFeature["role"],
  label: string
): Promise<EjesMapFeature> {
  const result = await session.query(sql, [reference]);
  const row = result.rows[0];
  if (row === undefined || row.geojson === null || row.geojson === undefined) {
    throw new MapFeatureNotFoundError(`No existe el tramo con reftramo ${reference} o no tiene geometría.`);
  }
  return { itemIndex, role, label, geometry: row.geojson as Geometry };
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
  throwIfIssues([
    ...staging.issues,
    ...sridIssuesOf(staging, STAGING_COLUMN.GEOM),
    ...roadSection.issues,
    ...sridIssuesOf(roadSection, ROAD_SECTION_COLUMN.GEOMETRY),
  ]);
  const oldSql = oldSectionOutlineSql(roadSection.layout);
  const newSql = newSectionOutlineSql(staging.layout);
  const features: EjesMapFeature[] = [];
  for (const [itemIndex, item] of params.items.entries()) {
    const entry = item;
    if (entry.oldRef !== undefined) {
      // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
      features.push(await featureOf(session, oldSql, entry.oldRef, itemIndex, GEOMETRY_MAP_ROLE.OLD, `Tramo anterior ${entry.oldRef}`));
    }
    if (entry.newRef !== undefined) {
      // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
      features.push(await featureOf(session, newSql, entry.newRef, itemIndex, GEOMETRY_MAP_ROLE.NEW, `Tramo nuevo ${entry.newRef}`));
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
