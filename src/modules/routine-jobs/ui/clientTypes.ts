import type { ClearMode } from "../jobs/cargar-padrones/constants";
import type { LoadOptions } from "../jobs/cargar-padrones/domain/loadSql";
import type { CargarPadronesResult } from "../jobs/cargar-padrones/types";
import type { ActualizarPadronResult } from "../jobs/actualizar-padron/types";

export type JobOptions = LoadOptions;

export interface ClientConnection {
  host: string;
  port: string;
  db_name: string;
  user: string;
  password: string;
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
  clearMode: ClearMode;
}

export interface ActualizarStartRequest {
  connection: ClientConnection;
  stagingSchema: string;
  stagingTable: string;
  workSchema: string;
  workTable: string;
  padronTable: string;
  provinceTable: string;
  localityTable: string;
  options: ActualizarJobOptions;
  dryRun: boolean;
  confirm: boolean;
}

export type ActualizarJobStatusView = JobStatusBase<ActualizarPadronResult>;
