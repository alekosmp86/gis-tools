import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { DbConfig } from "@/core/types/db";
import type { Geometry } from "geojson";
import type { RunDeps, RunSession } from "../../cargar-padrones/types";
import { throwIfIssues } from "../../shared/preflightAsserts";
import {
  polygonalGeometryIssues,
  resolveTable,
  resolveWritableTarget,
  type TableSpec,
  type WritableTargetLayout,
} from "../../shared/tableResolution";
import { runTransaction, withRunSession } from "../../shared/transaction";
import { createStepTimer } from "../../cargar-padrones/services/runSteps";
import {
  ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE,
  ACTUALIZAR_TABLE_ROLE,
  GEOMETRY_MAP_ROLE,
  STAGING_COLUMN,
  type ActualizarTableRole,
} from "../constants";
import {
  GEOMETRY_MAP_STATEMENT_TIMEOUT,
  MapFeatureNotFoundError,
  newGeometrySql,
  oldGeometrySql,
  stagingLabelOf,
  stagingLookupValuesOf,
} from "../domain/geometryMap";
import type { GeometryMapFeature, GeometryMapItem, GeometryMapStagingKey } from "../types";
import type { TableLayout } from "../domain/layouts";

export interface GeometryMapParams {
  config: DbConfig;
  stagingSchema: string;
  stagingTable: string;
  cartoSchema: string;
  targetTable: string;
  items: GeometryMapItem[];
}

const MISSING_VALUE = "sin dato";
const MAP_JOB_LABEL = "lectura de geometrías";
const MAP_UNTOUCHED = "No se modificó ninguna tabla.";
const MAP_UNVERIFIED = "No se pudo confirmar que la sesión terminara limpia.";

const specOf = (schema: string, table: string, role: ActualizarTableRole): TableSpec => ({
  label: buildQualifiedTableLabel(schema, table),
  schema,
  table,
  required: ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE[role],
});

const textOf = (value: unknown): string => (value === null || value === undefined ? MISSING_VALUE : String(value));

async function oldFeature(
  session: RunSession,
  target: WritableTargetLayout,
  oldId: number,
  itemIndex: number
): Promise<GeometryMapFeature> {
  const result = await session.query(oldGeometrySql(target), [oldId]);
  const row = result.rows[0];
  if (row === undefined || row.geojson === null || row.geojson === undefined) {
    throw new MapFeatureNotFoundError(`No existe un padrón de destino con id ${oldId} y geometría.`);
  }
  const label = `Padrón anterior ${textOf(row.typePadron)} ${textOf(row.number)} (id ${oldId})`;
  return { itemIndex, role: GEOMETRY_MAP_ROLE.OLD, label, geometry: row.geojson as Geometry };
}

async function newFeature(
  session: RunSession,
  staging: TableLayout,
  target: WritableTargetLayout,
  key: GeometryMapStagingKey,
  itemIndex: number
): Promise<GeometryMapFeature> {
  const result = await session.query(newGeometrySql(staging, target, key), stagingLookupValuesOf(key));
  const row = result.rows[0];
  if (row === undefined || Number(row.matches) === 0 || row.geojson === null || row.geojson === undefined) {
    throw new MapFeatureNotFoundError(`No se encontró ${stagingLabelOf(key)} en la tabla de origen.`);
  }
  return { itemIndex, role: GEOMETRY_MAP_ROLE.NEW, label: stagingLabelOf(key), geometry: row.geojson as Geometry };
}

/**
 * Reads the outlines of the requested items. The catalog checks run first; every read is in one read-only transaction.
 * One pg client must never run two queries at once (deprecated in pg 8, removed in pg 9, and one failure aborts the
 * transaction under the others), so every read is awaited in turn and the features keep the item order.
 */
async function readFeatures(session: RunSession, params: GeometryMapParams): Promise<GeometryMapFeature[]> {
  await session.query(`SET LOCAL statement_timeout = '${GEOMETRY_MAP_STATEMENT_TIMEOUT}'`);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const staging = await resolveTable(session, specOf(params.stagingSchema, params.stagingTable, ACTUALIZAR_TABLE_ROLE.STAGING));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const target = await resolveWritableTarget(session, specOf(params.cartoSchema, params.targetTable, ACTUALIZAR_TABLE_ROLE.TARGET));
  throwIfIssues([
    ...staging.issues,
    ...polygonalGeometryIssues(staging, STAGING_COLUMN.GEOM),
    ...target.issues,
  ]);
  const features: GeometryMapFeature[] = [];
  for (const [itemIndex, item] of params.items.entries()) {
    if (item.oldId !== undefined) {
      // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
      features.push(await oldFeature(session, target.target, item.oldId, itemIndex));
    }
    if (item.staging !== undefined) {
      // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
      features.push(await newFeature(session, staging.layout, target.target, item.staging, itemIndex));
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
  params: GeometryMapParams,
  captured: CapturedNotFound
): Promise<GeometryMapFeature[]> {
  try {
    return await readFeatures(session, params);
  } catch (error: unknown) {
    if (!(error instanceof MapFeatureNotFoundError)) throw error;
    captured.error = error;
    return [];
  }
}

/** Read-only: the transaction is rolled back, nothing is written, and the statement timeout bounds every read. */
export async function readGeometryMap(params: GeometryMapParams, deps: RunDeps): Promise<GeometryMapFeature[]> {
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
