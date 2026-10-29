import type { DbConfig } from "@/core/types/db";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import type { StepTiming } from "../cargar-padrones/types";
import type { WritableTargetLayout } from "../shared/tableResolution";
import type { AddressMasterAmbiguous, AddressMasterCounts, AddressMasterKey, AddressMasterLinked } from "../shared/addressMasterLinkPass";

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

export type CompletarCounts = AddressMasterCounts;
export type CompletarUnitKey = AddressMasterKey;
export type CompletarLinkedUnit = AddressMasterLinked;
export type CompletarAmbiguousUnit = AddressMasterAmbiguous;

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
