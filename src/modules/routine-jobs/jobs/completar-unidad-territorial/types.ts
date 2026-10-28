import type { DbConfig } from "@/core/types/db";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import type { StepTiming } from "../cargar-padrones/types";
import type { WritableTargetLayout } from "../shared/tableResolution";

export interface CompletarParams {
  config: DbConfig;
  unitSchema: string;
  unitTable: string;
  addressMasterSchema: string;
  addressMasterTable: string;
  dryRun: boolean;
  confirm: boolean;
}

export interface CompletarLayouts {
  unit: TableLayout;
  addressMaster: WritableTargetLayout;
}

export interface CompletarCounts {
  withoutAddressMaster: number;
  created: number;
  linked: number;
  alreadyHadRecord: number;
  ambiguous: number;
}

export interface CompletarUnitKey {
  id: number;
  name: string | null;
  provinceId: string | null;
}

export interface CompletarLinkedUnit extends CompletarUnitKey {
  addressMasterId: number;
  created: boolean;
}

export interface CompletarAmbiguousUnit extends CompletarUnitKey {
  records: number;
}

export interface CompletarClassification {
  counts: Omit<CompletarCounts, "linked">;
  ambiguousSamples: CompletarAmbiguousUnit[];
}

export interface CompletarApplyOutcome {
  created: number;
  linked: number;
  linkedList: CompletarLinkedUnit[];
}

export interface CompletarResult {
  dryRun: boolean;
  targetModified: boolean;
  outcomeUnknown: boolean;
  unitSchema: string;
  unitTable: string;
  addressMasterTable: string;
  counts: CompletarCounts;
  linkedList: CompletarLinkedUnit[];
  ambiguousSamples: CompletarAmbiguousUnit[];
  warnings: string[];
  stepTimings: StepTiming[];
}
