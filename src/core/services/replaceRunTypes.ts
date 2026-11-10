import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { ShpStartBody, ShpStartResult, ShpUploadProgress, ShpUploadResult } from "@/core/services/shpReplaceClient";
import type { ShpJobSnapshot } from "@/core/services/server/shpReplace/shpReplaceJobStore";
import type { ShpReplaceResult } from "@/core/services/server/shpReplace/shpReplaceTypes";
import type { DbConfig } from "@/core/types/db";
import type { GeometryProcessingOptions, GeometryProcessingReport } from "@/core/types/geometryProcessing";
import type { ShpReplacePhase } from "@/core/types/shpReplace";

export const ShpReplaceRunStatus = {
  IDLE: "idle",
  UPLOADING: "uploading",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;

export type ShpReplaceRunStatus = (typeof ShpReplaceRunStatus)[keyof typeof ShpReplaceRunStatus];

export interface ShpReplaceRunContext {
  targetLabel: string;
  targetServer: string;
  fileName: string;
  startedAt: number;
}

export interface ShpReplaceRunState {
  status: ShpReplaceRunStatus;
  uploadPct: number;
  phase: ShpReplacePhase | null;
  detail: string | null;
  current: number;
  total: number;
  result: ShpReplaceResult | null;
  error: string | null;
  context: ShpReplaceRunContext | null;
  jobId: string | null;
  outcomeUnknown: boolean;
  uploadId: string | null;
  dryRun: boolean;
  report: GeometryProcessingReport | null;
}

export interface ShpReplaceResetOptions {
  keepUpload?: boolean;
}

export interface ShpReplaceRerunParams {
  password: string;
  processing: GeometryProcessingOptions;
  dryRun: boolean;
}

export interface ShpReplaceRunClient {
  upload: (file: Blob, onProgress?: ShpUploadProgress) => Promise<ShpUploadResult>;
  start: (body: ShpStartBody) => Promise<ShpStartResult>;
  status: (jobId: string) => Promise<ShpJobSnapshot>;
}

export interface ShpReplaceRunParams {
  file: Blob;
  fileName: string;
  connection: DbConfig;
  mapping: ReplaceColumnMapping;
  sourceSrid: number;
  resetSequences: boolean;
  processing?: GeometryProcessingOptions;
  dryRun?: boolean;
  uploadId?: string;
  pollIntervalMs?: number;
  pollFailureGraceMs?: number;
  client?: ShpReplaceRunClient;
}
