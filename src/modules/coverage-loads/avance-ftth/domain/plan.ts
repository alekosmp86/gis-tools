import { describeShortfall } from "../../shared/tablePrivileges";
import {
  EXCLUDED_DISTRICT_STATUSES,
  ELIMINATED_STATUS,
  FILE_KIND_LABELS,
  FILE_KINDS,
  FILE_NAME_FORMAT_HINTS,
  ZONES,
  type AvanceFileKind,
} from "../constants";
import { ParseKind } from "../types";
import type {
  AvanceDbState,
  AvancePlan,
  FileError,
  FilePlan,
  ParseOutcome,
  ParsedAvanceFile,
  PrivilegeShortfallInput,
  PrivilegeShortfallPayload,
} from "../types";

interface ArrangedOutcomes {
  readonly files: ParsedAvanceFile[];
  readonly fileErrors: FileError[];
}

const NO_FILE_NAME = "";

const PlanMessage = {
  duplicatedKind: (kind: AvanceFileKind, fileNames: ReadonlyArray<string>) =>
    `Se subieron ${fileNames.length} archivos de ${FILE_KIND_LABELS[kind]} (${fileNames.map((name) => `"${name}"`).join(", ")}); hace falta exactamente uno.`,
  missingKind: (kind: AvanceFileKind) =>
    `Falta el archivo de ${FILE_KIND_LABELS[kind]} (${FILE_NAME_FORMAT_HINTS[kind]}).`,
  noValidRows: (fileName: string, rejected: number) =>
    `El archivo "${fileName}" no tiene ninguna fila válida (${rejected} rechazadas).`,
  zonesEmpty: () => `La capa de zonas ${ZONES} está vacía: no hay con qué cruzar las planillas.`,
  differentDates: (left: ParsedAvanceFile, right: ParsedAvanceFile) =>
    `Los archivos tienen fechas distintas: ${left.fileName} (${left.fechaact}) y ${right.fileName} (${right.fechaact}).`,
  alreadyLoaded: (kind: AvanceFileKind, fechaact: string) =>
    `La tabla de planillas de ${FILE_KIND_LABELS[kind]} ya tiene cargada la fecha ${fechaact}; se reemplazará.`,
  fewerRows: (kind: AvanceFileKind, incoming: number, current: number) =>
    `${FILE_KIND_LABELS[kind]}: quedarían ${incoming} filas en la planilla (sin la basura CZONA) y hoy hay ${current}.`,
  rejected: (fileName: string, total: number) => `${fileName}: ${total} filas rechazadas, no se cargan.`,
  emptyEdificio: (fileName: string, total: number) =>
    `${fileName}: ${total} filas con edificio vacío o #N/A; se cargan igual que en el job anterior.`,
  duplicates: (fileName: string, total: number) =>
    `${fileName}: ${total} claves (edificio, cable, zona) repetidas; el reporte de duplicados las lista.`,
  eliminated: (count: number, isExcluded: boolean) =>
    `${count} filas del Avance actual provienen de zonas ${ELIMINATED_STATUS} y se ${isExcluded ? "excluyen" : "incluyen, igual que el job anterior"}.`,
  historySkipped: () => "El Avance actual ya fue cargado hoy: no se copia al historial (historial omitido).",
} as const;

export const HISTORY_SKIPPED_REASON = "historial omitido: el Avance actual ya fue cargado hoy";

/** The pair of uploads becomes at most one accepted file per kind; everything else is a file-level error. */
export function arrangeOutcomes(outcomes: ReadonlyArray<ParseOutcome>): ArrangedOutcomes {
  const fileErrors: FileError[] = [];
  const filesByKind = new Map<AvanceFileKind, ParsedAvanceFile[]>();
  for (const outcome of outcomes) {
    if (outcome.kind === ParseKind.ERROR) {
      fileErrors.push(outcome.error);
      continue;
    }
    const sameKind = filesByKind.get(outcome.file.kind) ?? [];
    sameKind.push(outcome.file);
    filesByKind.set(outcome.file.kind, sameKind);
  }

  const files: ParsedAvanceFile[] = [];
  for (const kind of FILE_KINDS) {
    const sameKind = filesByKind.get(kind) ?? [];
    if (sameKind.length === 1) files.push(sameKind[0]);
    else if (sameKind.length === 0) fileErrors.push({ fileName: NO_FILE_NAME, message: PlanMessage.missingKind(kind) });
    else {
      const names = sameKind.map((file) => file.fileName);
      for (const name of names) fileErrors.push({ fileName: name, message: PlanMessage.duplicatedKind(kind, names) });
    }
  }
  return { files, fileErrors };
}

function toFilePlan(file: ParsedAvanceFile): FilePlan {
  return {
    kind: file.kind,
    fileName: file.fileName,
    fechaact: file.fechaact,
    rowsRead: file.rowsRead,
    validRows: file.rows.length,
    rejectedRows: file.rejected,
    rejectedTotal: file.rejectedTotal,
    junkRows: file.junkRows,
    emptyEdificioRows: file.emptyEdificioRows,
    duplicateKeys: file.duplicateKeys,
  };
}

function toShortfallPayload(shortfall: PrivilegeShortfallInput): PrivilegeShortfallPayload {
  return {
    table: shortfall.table,
    tableExists: shortfall.tableExists,
    missing: shortfall.missing,
    message: describeShortfall(shortfall),
  };
}

function isZonesReadable(state: AvanceDbState): boolean {
  return !state.shortfalls.some((shortfall) => shortfall.table === ZONES);
}

function collectBlockers(
  files: ReadonlyArray<ParsedAvanceFile>,
  fileErrors: ReadonlyArray<FileError>,
  shortfalls: ReadonlyArray<PrivilegeShortfallPayload>,
  state: AvanceDbState
): string[] {
  const blockers = [...fileErrors.map((error) => error.message)];
  for (const file of files) {
    if (file.rows.length === 0) blockers.push(PlanMessage.noValidRows(file.fileName, file.rejectedTotal));
  }
  blockers.push(...shortfalls.map((shortfall) => shortfall.message));
  if (state.zoneRows === 0 && isZonesReadable(state)) blockers.push(PlanMessage.zonesEmpty());
  return blockers;
}

function countEliminatedRows(state: AvanceDbState): number {
  return state.avanceByStatus.find((entry) => entry.status === ELIMINATED_STATUS)?.count ?? 0;
}

function warnAboutDates(files: ReadonlyArray<ParsedAvanceFile>, state: AvanceDbState): string[] {
  const warnings: string[] = [];
  if (files.length === FILE_KINDS.length && files[0].fechaact !== files[1].fechaact) {
    warnings.push(PlanMessage.differentDates(files[0], files[1]));
  }
  for (const file of files) {
    const staging = state.staging[file.kind];
    if (staging.rows > 0 && staging.fechaact === file.fechaact) {
      warnings.push(PlanMessage.alreadyLoaded(file.kind, file.fechaact));
    }
  }
  return warnings;
}

function warnAboutShrink(files: ReadonlyArray<ParsedAvanceFile>, state: AvanceDbState): string[] {
  const warnings: string[] = [];
  for (const file of files) {
    const incoming = file.rows.length - file.junkRows;
    const current = state.staging[file.kind].rows;
    if (incoming < current) warnings.push(PlanMessage.fewerRows(file.kind, incoming, current));
  }
  return warnings;
}

function warnAboutContent(files: ReadonlyArray<ParsedAvanceFile>): string[] {
  const warnings: string[] = [];
  for (const file of files) {
    if (file.rejectedTotal > 0) warnings.push(PlanMessage.rejected(file.fileName, file.rejectedTotal));
    if (file.emptyEdificioRows > 0) warnings.push(PlanMessage.emptyEdificio(file.fileName, file.emptyEdificioRows));
    if (file.duplicateKeys > 0) warnings.push(PlanMessage.duplicates(file.fileName, file.duplicateKeys));
  }
  return warnings;
}

function warnAboutCurrentAvance(state: AvanceDbState): string[] {
  const warnings: string[] = [];
  const eliminated = countEliminatedRows(state);
  if (eliminated > 0) {
    warnings.push(PlanMessage.eliminated(eliminated, EXCLUDED_DISTRICT_STATUSES.includes(ELIMINATED_STATUS)));
  }
  if (state.avance.loadedToday) warnings.push(PlanMessage.historySkipped());
  return warnings;
}

/** Pure: the plan is a function of the parsed files and of what the database reported. */
export function buildPlan(
  files: ReadonlyArray<ParsedAvanceFile>,
  fileErrors: ReadonlyArray<FileError>,
  state: AvanceDbState
): AvancePlan {
  const privilegeShortfalls = state.shortfalls.map(toShortfallPayload);
  const blockers = collectBlockers(files, fileErrors, privilegeShortfalls, state);

  return {
    files: files.map(toFilePlan),
    fileErrors,
    staging: state.staging,
    avance: state.avance,
    historyRows: state.historyRows,
    zoneRows: state.zoneRows,
    zoneStatuses: state.zoneStatuses,
    avanceByStatus: state.avanceByStatus,
    excludedStatuses: [...EXCLUDED_DISTRICT_STATUSES],
    privilegeShortfalls,
    historyWillBeSkipped: state.avance.loadedToday,
    blockers,
    warnings: [
      ...warnAboutDates(files, state),
      ...warnAboutShrink(files, state),
      ...warnAboutContent(files),
      ...warnAboutCurrentAvance(state),
    ],
    canLoad: blockers.length === 0,
  };
}

/** The load was refused before writing anything; the handlers answer 409. */
export class LoadRefusedError extends Error {
  constructor(
    message: string,
    readonly plan: AvancePlan
  ) {
    super(message);
    this.name = "LoadRefusedError";
  }
}

export function assertLoadable(plan: AvancePlan): void {
  if (plan.blockers.length > 0) throw new LoadRefusedError(plan.blockers.join(" "), plan);
}
