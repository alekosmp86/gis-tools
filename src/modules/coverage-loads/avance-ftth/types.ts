import type { AvanceColumnKey, AvanceFileKind, ReportKind } from "./constants";

/** One validated data row, trimmed; empty fields (and `-` in the Interior file) are `null`. */
export type AvanceRow = Readonly<Record<AvanceColumnKey, string | null>>;

/** A data row that was not saved. `line` is the 1-based physical line of the file (the header is line 1). */
export interface RejectedRow {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

/** A file that was rejected as a whole, or a problem with the pair of files. */
export interface FileError {
  readonly fileName: string;
  readonly message: string;
}

/** The content of one accepted file, kept server-side (rows never travel back to the browser). */
export interface ParsedAvanceFile {
  readonly kind: AvanceFileKind;
  readonly fileName: string;
  /** The 8 digits of the file name (`ddMMyyyy`), as text; becomes `fechaact` of every staging row. */
  readonly fechaact: string;
  readonly rows: ReadonlyArray<AvanceRow>;
  readonly rowsRead: number;
  /** Capped at `REJECTED_LIST_CAP`; `rejectedTotal` is the real count. */
  readonly rejected: ReadonlyArray<RejectedRow>;
  readonly rejectedTotal: number;
  /** Valid rows whose `conca` is junk: loaded and deleted by the rebuild. */
  readonly junkRows: number;
  readonly emptyEdificioRows: number;
  readonly duplicateKeys: number;
}

export const ParseKind = {
  FILE: "FILE",
  ERROR: "ERROR",
} as const;

export type ParseOutcome =
  | { readonly kind: typeof ParseKind.FILE; readonly file: ParsedAvanceFile }
  | { readonly kind: typeof ParseKind.ERROR; readonly error: FileError };

export interface StatusCount {
  readonly status: string;
  readonly count: number;
}

export interface StagingState {
  readonly rows: number;
  readonly fechaact: string | null;
}

export interface AvanceState {
  readonly rows: number;
  /** `YYYY-MM-DD` of the oldest and newest `fechacarga`; text, never a JS Date. */
  readonly oldestLoad: string | null;
  readonly newestLoad: string | null;
  /** Rows exist and every one was loaded today by the database's own clock: the history copy would be skipped. */
  readonly loadedToday: boolean;
}

export interface PrivilegeShortfallPayload {
  readonly table: string;
  readonly tableExists: boolean;
  readonly missing: ReadonlyArray<string>;
  readonly message: string;
}

export interface PrivilegeShortfallInput {
  readonly table: string;
  readonly tableExists: boolean;
  readonly missing: ReadonlyArray<string>;
}

/** What the database says, read once per plan (and again inside the write transaction). */
export interface AvanceDbState {
  readonly staging: Readonly<Record<AvanceFileKind, StagingState>>;
  readonly avance: AvanceState;
  readonly historyRows: number;
  readonly zoneRows: number;
  readonly zoneStatuses: ReadonlyArray<StatusCount>;
  readonly avanceByStatus: ReadonlyArray<StatusCount>;
  readonly shortfalls: ReadonlyArray<PrivilegeShortfallInput>;
}

export interface FilePlan {
  readonly kind: AvanceFileKind;
  readonly fileName: string;
  readonly fechaact: string;
  readonly rowsRead: number;
  readonly validRows: number;
  readonly rejectedRows: ReadonlyArray<RejectedRow>;
  readonly rejectedTotal: number;
  readonly junkRows: number;
  readonly emptyEdificioRows: number;
  readonly duplicateKeys: number;
}

export interface AvancePlan {
  readonly files: ReadonlyArray<FilePlan>;
  readonly fileErrors: ReadonlyArray<FileError>;
  readonly staging: Readonly<Record<AvanceFileKind, StagingState>>;
  readonly avance: AvanceState;
  readonly historyRows: number;
  readonly zoneRows: number;
  readonly zoneStatuses: ReadonlyArray<StatusCount>;
  readonly avanceByStatus: ReadonlyArray<StatusCount>;
  readonly excludedStatuses: ReadonlyArray<string>;
  readonly privilegeShortfalls: ReadonlyArray<PrivilegeShortfallPayload>;
  readonly historyWillBeSkipped: boolean;
  readonly blockers: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly canLoad: boolean;
}

export interface LoadedFile {
  readonly kind: AvanceFileKind;
  readonly fileName: string;
  readonly rowsLoaded: number;
  readonly junkDeleted: number;
  readonly avanceInserted: number;
  /** Distinct trimmed (edificio, cable, zona) keys that found no zone. */
  readonly unmatchedKeys: number;
}

export interface HistoryOutcome {
  readonly copied: number;
  readonly skipped: boolean;
  readonly reason: string | null;
}

export interface ReportOutcome {
  readonly kind: ReportKind;
  /** `null` when the report failed; the failure is in `error`. */
  readonly rows: number | null;
  readonly error: string | null;
}

export interface AvanceLoadResult {
  readonly dryRun: boolean;
  readonly files: ReadonlyArray<LoadedFile>;
  readonly history: HistoryOutcome;
  readonly avanceInserted: number;
  readonly byStatus: ReadonlyArray<StatusCount>;
  readonly reports: ReadonlyArray<ReportOutcome>;
  readonly elapsedMs: number;
  readonly warnings: ReadonlyArray<string>;
  readonly rejectedRows: ReadonlyArray<RejectedRow>;
  /** The real count across files; `rejectedRows` is capped per file. */
  readonly rejectedTotal: number;
}

/** The rows of a report as text, in the column order of `REPORT_COLUMNS`. */
export type ReportRow = ReadonlyArray<string>;

export interface ReportData {
  readonly kind: ReportKind;
  readonly rows: ReadonlyArray<ReportRow> | null;
  readonly error: string | null;
}

export interface PlanResponsePayload {
  readonly success: true;
  readonly plan: AvancePlan;
}

export interface LoadResponsePayload {
  readonly success: true;
  readonly result: AvanceLoadResult;
}

/** Body of a refused or failed answer; `plan` is present when a load was refused (409). */
export interface AvanceErrorPayload {
  readonly success: false;
  readonly error: string;
  readonly plan?: AvancePlan;
}

export interface ReportRequestPayload {
  readonly connection: {
    readonly host: string;
    readonly port: string;
    readonly db_name: string;
    readonly user: string;
    readonly password: string;
  };
  readonly kind?: ReportKind;
}
