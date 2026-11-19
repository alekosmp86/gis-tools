import type { LoadOptions } from "../../jobs/cargar-padrones/domain/loadSql";
import type { CargarPadronesResult } from "../../jobs/cargar-padrones/types";
import type { AcceptedGeometry, ActualizarPadronResult, GeometryMapItem, PairChoice } from "../../jobs/actualizar-padron/types";
import type { CargarLocalidadesResult, LocalityOptions, LocalityTableRef } from "../../jobs/cargar-localidades/types";
import type { UnitAddressMasterTable, UnitResult } from "../../jobs/unidad-territorial/types";
import type { EJES_SPLIT_POINTS_ROLES, EjesTableRole } from "../../jobs/ejes-calles/constants";
import type { EjesMapItem, EjesResult, EjesSummary, EjesTableRef } from "../../jobs/ejes-calles/types";
import type { CentrosTableRole } from "../../jobs/centros-anep/constants";
import type { CentrosResult, CentrosTableRef } from "../../jobs/centros-anep/types";

export type JobOptions = LoadOptions;

export interface ClientConnection {
  host: string;
  port: string;
  db_name: string;
  user: string;
  password: string;
}

export interface StagingSelection {
  schema: string;
  table: string;
}

export interface StartRequest {
  connection: ClientConnection;
  schema: string;
  ruralTable: string;
  urbanoTable: string;
  targetTable: string;
  options: JobOptions;
  dryRun: boolean;
  confirm: boolean;
}

export type JobStatusState = "RUNNING" | "DONE" | "FAILED";

export interface JobStatusBase<Result> {
  jobId: string;
  state: JobStatusState;
  step: string | null;
  current?: number;
  total?: number;
  dryRun: boolean;
  steps?: string[];
  startedAt: number;
  finishedAt?: number;
  result?: Result;
  error?: string;
  outcomeUnknown?: boolean;
}

export type JobStatusView = JobStatusBase<CargarPadronesResult>;

export interface ActualizarJobOptions {
  localityType?: string;
  tolerance: number;
  geometryAreaThreshold: number;
  updateGeometries: boolean;
  linkAddressMaster: boolean;
  repairSequences: boolean;
  pairChoices?: PairChoice[];
  acceptedGeometries?: AcceptedGeometry[];
  acceptAllGeometries?: boolean;
}

export interface ActualizarStartRequest {
  connection: ClientConnection;
  stagingSchema: string;
  stagingTable: string;
  cartoSchema: string;
  targetTable: string;
  provinceTable: string;
  localityTable: string;
  typeTable?: string;
  addressMasterTable?: string;
  options: ActualizarJobOptions;
  dryRun: boolean;
  confirm: boolean;
  planId?: string;
}

export type ActualizarJobStatusView = JobStatusBase<ActualizarPadronResult>;

/** The connection and the tables the map reads: the wizard's, with no option and no plan. */
export interface GeometryMapBase {
  connection: ClientConnection;
  stagingSchema: string;
  stagingTable: string;
  cartoSchema: string;
  targetTable: string;
}

export interface GeometryMapRequest extends GeometryMapBase {
  items: GeometryMapItem[];
}

export interface LocalidadesStartRequest {
  connection: ClientConnection;
  stagingSchema: string;
  padronTable: string;
  localityStagingTable: string;
  provinceSchema: string;
  provinceTable: string;
  targets: LocalityTableRef[];
  options: LocalityOptions;
  dryRun: boolean;
  confirm: boolean;
}

export type LocalidadesJobStatusView = JobStatusBase<CargarLocalidadesResult>;

export interface UnitClientOptions {
  localityTypeName: string;
  tolerance: number;
  updateGeometries: boolean;
  linkAddressMaster: boolean;
  repairSequences: boolean;
}

export interface UnidadStartRequest {
  connection: ClientConnection;
  localitySchema: string;
  localityTable: string;
  typeSchema: string;
  typeTable: string;
  targetSchema: string;
  targetTable: string;
  addressMasterTable?: UnitAddressMasterTable;
  options: UnitClientOptions;
  dryRun: boolean;
  confirm: boolean;
}

export type UnidadJobStatusView = JobStatusBase<UnitResult>;

/** One copy the user keeps for a `reftramo` that keeps several copies. */
export interface EjesTwinPickRequest {
  ref: string;
  department: string;
  locality: string;
}

/** The picks the Analizar re-run sends: the analysis then sees the picks the load will. */
export interface EjesAnalysisAcceptedRequest {
  twinPicks: EjesTwinPickRequest[];
}

export interface EjesStartRequest {
  connection: ClientConnection;
  tables: Record<EjesTableRole, EjesTableRef>;
  dryRun: boolean;
  accepted?: EjesAnalysisAcceptedRequest;
}

/** One review point's destination the user chose: the point and one piece of its split. */
export interface EjesPointChoiceRequest {
  pointId: string;
  newRef: string;
}

/** The accepted review rows: splits by their old `reftramo` with the user's choices for their review points only, plain removals by `reftramo`, merges by their new `reftramo` (the server derives the old ones). */
export interface EjesAcceptedRequest extends EjesAnalysisAcceptedRequest {
  splits: { oldRef: string; choices: EjesPointChoiceRequest[] }[];
  plainRemovals: { ref: string }[];
  merges: { newRef: string }[];
  twinRemovals: { ref: string }[];
}

/** The real run: the counts and fingerprint of the finished dry-run, and the rows the user accepted on it. */
export interface EjesLoadRequest extends EjesStartRequest {
  dryRun: false;
  accepted: EjesAcceptedRequest;
  summary: EjesSummary;
}

export type EjesJobStatusView = JobStatusBase<EjesResult>;

/** The connection and the tables the ejes map reads: the wizard's, with no option and no plan. */
export interface EjesGeometryMapBase {
  connection: ClientConnection;
  tables: Pick<Record<EjesTableRole, EjesTableRef>, "ejes-origen" | "ejes-tramos" | "ejes-padrones" | "ejes-localidades" | "ejes-departamentos">;
}

export interface EjesGeometryMapRequest extends EjesGeometryMapBase {
  items: EjesMapItem[];
}

/** The connection, the five tables the review reads by key or small lookup, and the dry run whose stored points the review shows. */
export interface EjesSplitPointsBase {
  connection: ClientConnection;
  tables: Pick<Record<EjesTableRole, EjesTableRef>, (typeof EJES_SPLIT_POINTS_ROLES)[number]>;
  jobId: string;
}

export interface EjesSplitPointsRequest extends EjesSplitPointsBase {
  oldRef: string;
  offset: number;
  limit: number;
}

export interface CentrosAnepStartRequest {
  connection: ClientConnection;
  tables: Record<CentrosTableRole, CentrosTableRef>;
  dryRun: boolean;
  confirm: boolean;
}

export type CentrosAnepJobStatusView = JobStatusBase<CentrosResult>;
