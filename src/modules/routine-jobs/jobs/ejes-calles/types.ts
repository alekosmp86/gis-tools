import type { DbConfig } from "@/core/types/db";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import type { StepTiming } from "../cargar-padrones/types";
import type { WritableTargetLayout } from "../shared/tableResolution";
import type { EjesTableRole } from "./constants";

export interface EjesTableRef {
  schema: string;
  table: string;
}

export type EjesTables = Record<EjesTableRole, EjesTableRef>;

export interface EjesParams {
  config: DbConfig;
  tables: EjesTables;
  dryRun: true;
}

export type EjesLayouts = Record<EjesTableRole, TableLayout>;

export interface EjesUnknownValue {
  value: string | null;
  rows: number;
}

export interface EjesStagingReport {
  rows: number;
  distinctRefs: number;
  repeatedGroups: number;
  repeatedRows: number;
  nonIntegerRefs: number;
  emptyGeometry: number;
  emptyIdcalle: number;
  damagedTextRows: number;
  unknownTipoRows: number;
  unknownFuenteRows: number;
  unknownTipos: EjesUnknownValue[];
  unknownFuentes: EjesUnknownValue[];
}

export interface EjesCounts {
  newSections: number;
  unchanged: number;
  attr: number;
  geom: number;
  both: number;
  removed: number;
  splits: number;
  merges: number;
  plainRemovals: number;
  plainHeld: number;
  newStreets: number;
}

export interface EjesClocReport {
  withLocality: number;
  onlyDepartment: number;
  withoutCode: number;
}

export interface EjesSplitRow {
  oldRef: string;
  idcalle: string | null;
  newRefs: string[];
  points: number;
  coverage: number | null;
  oldLength: number | null;
  newLength: number | null;
  outsideLength: number | null;
}

export interface EjesMergeRow {
  newRef: string;
  idcalle: string | null;
  oldRefs: string[];
  points: number;
  coverage: number | null;
  oldLength: number | null;
  newLength: number | null;
  outsideLength: number | null;
}

export interface EjesRemovalRow {
  ref: string;
  idcalle: string | null;
  points: number;
}

export interface EjesNewStreetRow {
  idcalle: string | null;
  name: string | null;
  shortName: string | null;
  sections: number;
  tipos: string | null;
  departments: string | null;
  localities: string | null;
}

export interface EjesAttrRow {
  ref: string;
  name: string | null;
  currentName: string | null;
  idcalle: string | null;
  currentIdcalle: string | null;
  typeId: number | null;
  currentTypeId: number | null;
  fontId: number | null;
  currentFontId: number | null;
}

export interface EjesAnalysis {
  counts: EjesCounts;
  cloc: EjesClocReport;
  splits: EjesSplitRow[];
  merges: EjesMergeRow[];
  plainRemovals: EjesRemovalRow[];
  newStreets: EjesNewStreetRow[];
  attrChanges: EjesAttrRow[];
}

export interface EjesResolvedLayouts {
  layouts: EjesLayouts;
  writeTargets: WritableTargetLayout[];
}

export interface EjesResult extends EjesAnalysis {
  dryRun: true;
  targetModified: false;
  outcomeUnknown: false;
  staging: EjesStagingReport;
  blockers: string[];
  privilegeInfo: string[];
  tables: Record<EjesTableRole, string>;
  stepTimings: StepTiming[];
}
