import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { SequenceRef } from "@/core/services/replaceSequences";
import type { AnalyzeOutcome, SequenceAdjustment } from "@/core/types/replace";
import type { OpenShapefile } from "@/core/services/server/shpReplace/shpRecordSource";
import { ShpReplacePhase } from "@/core/types/shpReplace";

export { ShpReplacePhase };

export interface ShpReplaceProgress {
  phase: ShpReplacePhase;
  current: number;
  total: number;
}

export interface ShpQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

export interface ShpQuerySession {
  query(sql: string, values?: ReadonlyArray<unknown>): Promise<ShpQueryResult>;
}

export interface ShpReplaceSession extends ShpQuerySession {
  copyIn(sql: string, lines: Iterable<string>): Promise<number>;
  close(): Promise<void>;
}

export type ShpReplaceSessionOpener = () => Promise<ShpReplaceSession>;

export interface ShpReplaceTarget {
  schema_name?: string | null;
  table_name: string;
}

export interface RunShpReplaceParams {
  target: ShpReplaceTarget;
  shapefile: OpenShapefile;
  mapping: ReplaceColumnMapping;
  sourceSrid: number;
  resetSequences: boolean;
  sequences?: SequenceRef[];
  onProgress?: (progress: ShpReplaceProgress) => void;
}

export interface ShpReplaceResult {
  sourceRows: number;
  stagedRows: number;
  previousRows: number;
  insertedRows: number;
  targetModified: boolean;
  sequencesAdjusted: SequenceAdjustment[];
  analyze: AnalyzeOutcome;
}

export class ShpCommitUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShpCommitUncertainError";
  }
}
