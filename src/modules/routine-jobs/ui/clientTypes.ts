import type { LoadOptions } from "../jobs/cargar-padrones/domain/loadSql";
import type { CargarPadronesResult } from "../jobs/cargar-padrones/types";

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

export interface JobStatusView {
  jobId: string;
  state: JobStatusState;
  step: string | null;
  current?: number;
  total?: number;
  dryRun: boolean;
  startedAt: number;
  finishedAt?: number;
  result?: CargarPadronesResult;
  error?: string;
  outcomeUnknown?: boolean;
}
