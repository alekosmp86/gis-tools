import { describeShortfall, type PrivilegeShortfall } from "../../shared/tablePrivileges";
import { HISTORY_TABLE, HistoryPrivilege } from "../constants";
import { ParseKind } from "../types";
import type {
  CutPlan,
  FileError,
  IndicatorsPlan,
  ParseOutcome,
  ParsedCut,
  PrivilegeShortfallPayload,
} from "../types";

/** What the database says about the dates a run wants to write. */
export interface HistoryState {
  /** `YYYY-MM-DD` -> rows currently stored for that date; absent means none. */
  readonly existingRowsByDate: Readonly<Record<string, number>>;
  readonly shortfalls: ReadonlyArray<PrivilegeShortfall>;
}

interface SplitOutcomes {
  readonly cuts: ParsedCut[];
  readonly fileErrors: FileError[];
}

export const PlanMessage = {
  noCuts: () => "No hay ningún archivo válido para cargar.",
  sameDate: (fechaact: string, fileNames: ReadonlyArray<string>) =>
    `Los archivos ${fileNames.map((name) => `"${name}"`).join(" y ")} corresponden al mismo corte ${fechaact}; se rechazan todos.`,
  replace: (fechaact: string, existing: number, incoming: number) =>
    existing > 0
      ? `corte ${fechaact}: ${existing} filas existentes serán reemplazadas por ${incoming} nuevas`
      : `corte ${fechaact}: ${incoming} filas nuevas; no hay filas existentes para esa fecha`,
  incomplete: (fechaact: string, valid: number, total: number, rejected: number) =>
    `corte ${fechaact} incompleto: ${valid} de ${total} filas, ${rejected} rechazadas`,
  shrink: (fechaact: string, existing: number, incoming: number) =>
    `corte ${fechaact}: el historial tiene ${existing} filas y quedarían ${incoming}; el corte se reduce`,
  needsAcceptShrink: () =>
    "Hay cortes que quedarían con menos filas que las guardadas; hay que aceptar explícitamente la reducción.",
  deleteHint: () => "El privilegio DELETE sobre el historial puede requerir un GRANT de un DBA.",
} as const;

/** Two files for the same date are ambiguous, so every file of that date is rejected. */
export function rejectRepeatedDates(outcomes: ReadonlyArray<ParseOutcome>): ParseOutcome[] {
  const fileNamesByDate = new Map<string, string[]>();
  for (const outcome of outcomes) {
    if (outcome.kind !== ParseKind.CUT) continue;
    const names = fileNamesByDate.get(outcome.cut.fechaact) ?? [];
    names.push(outcome.cut.fileName);
    fileNamesByDate.set(outcome.cut.fechaact, names);
  }

  return outcomes.map((outcome) => {
    if (outcome.kind !== ParseKind.CUT) return outcome;
    const names = fileNamesByDate.get(outcome.cut.fechaact) ?? [];
    if (names.length < 2) return outcome;
    const error: FileError = {
      fileName: outcome.cut.fileName,
      message: PlanMessage.sameDate(outcome.cut.fechaact, names),
    };
    return { kind: ParseKind.ERROR, error };
  });
}

export function splitOutcomes(outcomes: ReadonlyArray<ParseOutcome>): SplitOutcomes {
  const cuts: ParsedCut[] = [];
  const fileErrors: FileError[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === ParseKind.CUT) cuts.push(outcome.cut);
    else fileErrors.push(outcome.error);
  }
  return { cuts, fileErrors };
}

/** "corte 2026-09-01 incompleto: 612 de 615 filas, 3 rechazadas", or null when no row was lost. */
export function describeIncompleteCut(cut: ParsedCut): string | null {
  const rejectedCount = cut.rejected.length;
  if (rejectedCount === 0) return null;
  return PlanMessage.incomplete(cut.fechaact, cut.rows.length, cut.rows.length + rejectedCount, rejectedCount);
}

function planCut(cut: ParsedCut, existingRows: number): CutPlan {
  const validRows = cut.rows.length;
  const rejectedCount = cut.rejected.length;
  const totalRows = validRows + rejectedCount;
  const incompleteMessage = describeIncompleteCut(cut);
  const shrinks = validRows < existingRows;

  return {
    fileName: cut.fileName,
    fechaact: cut.fechaact,
    totalRows,
    validRows,
    rejectedRows: cut.rejected,
    existingRows,
    incomplete: incompleteMessage !== null,
    shrinks,
    replaceMessage: PlanMessage.replace(cut.fechaact, existingRows, validRows),
    incompleteMessage,
    shrinkMessage: shrinks ? PlanMessage.shrink(cut.fechaact, existingRows, validRows) : null,
  };
}

function toShortfallPayload(shortfall: PrivilegeShortfall): PrivilegeShortfallPayload {
  const needsDeleteHint =
    shortfall.table === HISTORY_TABLE && shortfall.missing.includes(HistoryPrivilege.DELETE);
  const message = describeShortfall(shortfall);
  return {
    table: shortfall.table,
    tableExists: shortfall.tableExists,
    missing: shortfall.missing,
    message: needsDeleteHint ? `${message} ${PlanMessage.deleteHint()}` : message,
  };
}

function collectBlockers(
  cutCount: number,
  fileErrors: ReadonlyArray<FileError>,
  shortfalls: ReadonlyArray<PrivilegeShortfallPayload>
): string[] {
  const blockers = [...fileErrors.map((error) => error.message), ...shortfalls.map((item) => item.message)];
  if (cutCount === 0 && fileErrors.length === 0) blockers.push(PlanMessage.noCuts());
  return blockers;
}

/** Pure: the plan is a function of the parsed files and of what the database reported. */
export function buildPlan(
  cuts: ReadonlyArray<ParsedCut>,
  fileErrors: ReadonlyArray<FileError>,
  history: HistoryState
): IndicatorsPlan {
  const cutPlans = cuts.map((cut) => planCut(cut, history.existingRowsByDate[cut.fechaact] ?? 0));
  const privilegeShortfalls = history.shortfalls.map(toShortfallPayload);
  const blockers = collectBlockers(cuts.length, fileErrors, privilegeShortfalls);

  return {
    cuts: cutPlans,
    fileErrors,
    privilegeShortfalls,
    canLoad: blockers.length === 0,
    requiresAcceptShrink: cutPlans.some((cut) => cut.shrinks),
    hasIncompleteCut: cutPlans.some((cut) => cut.incomplete),
    blockers,
  };
}

/** Every reason this plan may not be written; empty means go. */
export function listLoadBlockers(plan: IndicatorsPlan, acceptShrink: boolean): string[] {
  const blockers = [...plan.blockers];
  if (plan.requiresAcceptShrink && !acceptShrink) blockers.push(PlanMessage.needsAcceptShrink());
  return blockers;
}

/** The load was refused before writing anything; the handlers answer 409. */
export class LoadRefusedError extends Error {
  constructor(
    message: string,
    readonly plan: IndicatorsPlan
  ) {
    super(message);
    this.name = "LoadRefusedError";
  }
}

export function assertLoadable(plan: IndicatorsPlan, acceptShrink: boolean): void {
  const blockers = listLoadBlockers(plan, acceptShrink);
  if (blockers.length > 0) throw new LoadRefusedError(blockers.join(" "), plan);
}
