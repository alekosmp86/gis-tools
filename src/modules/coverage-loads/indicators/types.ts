import type { ReportColumn, ReportKind } from "./constants";

/** One validated data row of an `IndicadoresLTE_*.csv`, trimmed. `cobertura` is as in the file. */
export interface IndicatorRow {
  readonly departamento: string;
  readonly localidad: string;
  readonly porcentaje: string;
  readonly cobertura: string;
}

/** A data row that was not saved. `line` is the 1-based physical line of the file (the header is line 1). */
export interface RejectedRow {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

/** A file that was rejected as a whole: nothing of it is saved. */
export interface FileError {
  readonly fileName: string;
  readonly message: string;
}

/** The content of one accepted file, kept server-side (rows never travel back to the browser). */
export interface ParsedCut {
  readonly fileName: string;
  /** `YYYY-MM-DD`; a text, never a JS Date. */
  readonly fechaact: string;
  readonly rows: ReadonlyArray<IndicatorRow>;
  readonly rejected: ReadonlyArray<RejectedRow>;
}

export const ParseKind = {
  CUT: "CUT",
  ERROR: "ERROR",
} as const;

type ParseKind = (typeof ParseKind)[keyof typeof ParseKind];

export type ParseOutcome =
  | { readonly kind: typeof ParseKind.CUT; readonly cut: ParsedCut }
  | { readonly kind: typeof ParseKind.ERROR; readonly error: FileError };

/** What the plan says about one cut. */
export interface CutPlan {
  readonly fileName: string;
  readonly fechaact: string;
  /** Data rows read from the file: valid plus rejected. */
  readonly totalRows: number;
  readonly validRows: number;
  readonly rejectedRows: ReadonlyArray<RejectedRow>;
  /** Rows currently stored in the history for this date; they are replaced on load. */
  readonly existingRows: number;
  readonly incomplete: boolean;
  /** Fewer rows would be stored than are stored now. */
  readonly shrinks: boolean;
  readonly replaceMessage: string;
  readonly incompleteMessage: string | null;
  readonly shrinkMessage: string | null;
}

export interface PrivilegeShortfallPayload {
  readonly table: string;
  readonly tableExists: boolean;
  readonly missing: ReadonlyArray<string>;
  readonly message: string;
}

export interface IndicatorsPlan {
  readonly cuts: ReadonlyArray<CutPlan>;
  readonly fileErrors: ReadonlyArray<FileError>;
  readonly privilegeShortfalls: ReadonlyArray<PrivilegeShortfallPayload>;
  /** Load is allowed to start: no file errors, no missing privilege, at least one cut. */
  readonly canLoad: boolean;
  /** At least one cut shrinks, so `load` needs `acceptShrink`. */
  readonly requiresAcceptShrink: boolean;
  readonly hasIncompleteCut: boolean;
  /** Why `canLoad` is false, in Spanish; empty otherwise. */
  readonly blockers: ReadonlyArray<string>;
}

export interface LoadedCut {
  readonly fileName: string;
  readonly fechaact: string;
  readonly replacedRows: number;
  readonly insertedRows: number;
  /** Rows the history holds for this date after the write. */
  readonly storedRows: number;
  readonly rejectedRows: number;
  readonly incomplete: boolean;
  readonly incompleteMessage: string | null;
}

export interface LoadResult {
  readonly cuts: ReadonlyArray<LoadedCut>;
  readonly totalInserted: number;
  readonly totalReplaced: number;
  readonly hasIncompleteCut: boolean;
  readonly rejectedRows: ReadonlyArray<RejectedRow>;
}

/** Body of a successful `plan` answer. */
export interface PlanResponsePayload {
  readonly success: true;
  readonly plan: IndicatorsPlan;
}

/** Body of a successful `load` answer. */
export interface LoadResponsePayload {
  readonly success: true;
  readonly result: LoadResult;
}

/** Body of a refused or failed answer; `plan` is present when a load was refused (409). */
export interface IndicatorsErrorPayload {
  readonly success: false;
  readonly error: string;
  readonly plan?: IndicatorsPlan;
}

/** Body the browser posts to `reports`. */
export interface ReportRequestPayload {
  readonly connection: {
    readonly host: string;
    readonly port: string;
    readonly db_name: string;
    readonly user: string;
    readonly password: string;
  };
  readonly kind: ReportKind;
}

/** One row of a report query: every value already text (dates formatted in SQL). */
export type ReportRow = Readonly<Record<ReportColumn, string>>;
