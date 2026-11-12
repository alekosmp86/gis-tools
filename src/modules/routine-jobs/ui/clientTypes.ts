import type { LoadOptions } from "../jobs/cargar-padrones/domain/loadSql";
import type { CargarPadronesResult } from "../jobs/cargar-padrones/types";
import type { AcceptedGeometry, ActualizarPadronResult, GeometryMapItem, PairChoice } from "../jobs/actualizar-padron/types";
import type { CargarLocalidadesResult, LocalityOptions, LocalityTableRef } from "../jobs/cargar-localidades/types";
import type { UnitAddressMasterTable, UnitResult } from "../jobs/unidad-territorial/types";
import type { EjesTableRole } from "../jobs/ejes-calles/constants";
import type { EjesMapItem, EjesResult, EjesTableRef } from "../jobs/ejes-calles/types";
import type { CentrosTableRole } from "../jobs/centros-anep/constants";
import type { CentrosResult, CentrosTableRef } from "../jobs/centros-anep/types";

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

export interface EjesStartRequest {
  connection: ClientConnection;
  tables: Record<EjesTableRole, EjesTableRef>;
  dryRun: boolean;
}

export type EjesJobStatusView = JobStatusBase<EjesResult>;

/** The connection and the tables the ejes map reads: the wizard's, with no option and no plan. */
export interface EjesGeometryMapBase {
  connection: ClientConnection;
  tables: Pick<Record<EjesTableRole, EjesTableRef>, "ejes-origen" | "ejes-tramos" | "ejes-padrones">;
}

export interface EjesGeometryMapRequest extends EjesGeometryMapBase {
  items: EjesMapItem[];
}

export interface CentrosAnepStartRequest {
  connection: ClientConnection;
  tables: Record<CentrosTableRole, CentrosTableRef>;
  dryRun: boolean;
  confirm: boolean;
}

export type CentrosAnepJobStatusView = JobStatusBase<CentrosResult>;
