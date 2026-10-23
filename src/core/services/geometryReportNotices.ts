import { OverlapPolicy, type GeometryProcessingOptions, type GeometryProcessingReport } from "@/core/types/geometryProcessing";

export const NoticeLevel = {
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
} as const;

export type NoticeLevel = (typeof NoticeLevel)[keyof typeof NoticeLevel];

export interface ReportNotice {
  readonly level: NoticeLevel;
  readonly text: string;
}

const plural = (count: number, singular: string, pluralForm: string): string => (count === 1 ? singular : pluralForm);

const TARGET_TYPE_LABELS: ReadonlyMap<string, string> = new Map([
  ["POLYGON", "Polígono"],
  ["POINT", "Punto"],
  ["LINESTRING", "Línea"],
]);

export const geometryTypeLabelOf = (rawType: string): string => {
  const normalizedType = rawType.trim().toUpperCase();
  const knownLabel = TARGET_TYPE_LABELS.get(normalizedType);
  if (knownLabel !== undefined) return knownLabel;
  const lowerCased = rawType.trim().toLowerCase();
  return lowerCased.charAt(0).toUpperCase() + lowerCased.slice(1);
};

const incompatibleTargetPhrase = (targetTypeLabel: string | null): string =>
  targetTypeLabel === null ? "de una sola parte" : `de tipo ${targetTypeLabel}`;

export const incompatibleGeometryText = (count: number, targetTypeLabel: string | null): string =>
  count === 1
    ? `1 geometría de varias partes no cabe en la columna destino ${incompatibleTargetPhrase(targetTypeLabel)}`
    : `${count} geometrías de varias partes no caben en la columna destino ${incompatibleTargetPhrase(targetTypeLabel)}`;

const incompatibleGeometryNotice = (report: GeometryProcessingReport): ReportNotice => ({
  level: NoticeLevel.ERROR,
  text: incompatibleGeometryText(report.incompatibleGeometryRows, report.incompatibleTargetType),
});

const invalidInsertedNotice = (count: number): ReportNotice => ({
  level: NoticeLevel.WARNING,
  text:
    count === 1
      ? "1 geometría inválida se insertó sin reparar"
      : `${count} geometrías inválidas se insertaron sin reparar`,
});

const invalidSkippedNotice = (count: number): ReportNotice => ({
  level: NoticeLevel.WARNING,
  text:
    count === 1
      ? "1 geometría inválida no se comprobó para solapes; active Reparar para incluirla"
      : `${count} geometrías inválidas no se comprobaron para solapes; active Reparar para incluirlas`,
});

const nullKeyNotice = (count: number): ReportNotice => ({
  level: NoticeLevel.WARNING,
  text:
    count === 1
      ? "1 registro con clave vacía no se unificó"
      : `${count} registros con clave vacía no se unificaron`,
});

const emptyAfterRepairNotice = (count: number): ReportNotice => ({
  level: NoticeLevel.WARNING,
  text:
    count === 1
      ? "1 geometría quedó vacía tras la reparación y se insertó como NULL"
      : `${count} geometrías quedaron vacías tras la reparación y se insertaron como NULL`,
});

const conflictNotice = (count: number): ReportNotice => ({
  level: NoticeLevel.WARNING,
  text: `${count} ${plural(count, "grupo tiene", "grupos tienen")} valores distintos en otras columnas: se conserva el valor del primer registro.`,
});

const blockingOverlapNotice = (count: number): ReportNotice => ({
  level: NoticeLevel.ERROR,
  text: `Se detectaron ${count} ${plural(count, "solape", "solapes")} entre geometrías. Con la política Bloquear la carga se cancela y la tabla destino no se modifica.`,
});

const reportedOverlapNotice = (count: number): ReportNotice => ({
  level: NoticeLevel.WARNING,
  text: `Se detectaron ${count} ${plural(count, "solape", "solapes")} entre geometrías (política Solo informar): la carga continúa.`,
});

const singleFieldKeyNotice: ReportNotice = {
  level: NoticeLevel.INFO,
  text: "La clave tiene un solo campo: puede fusionar registros no relacionados. Revise los grupos antes de continuar.",
};

const groupsSummaryNotice = (groups: number, rowsMerged: number): ReportNotice => ({
  level: NoticeLevel.INFO,
  text: `${groups} ${plural(groups, "grupo", "grupos")}, ${rowsMerged} ${plural(rowsMerged, "registro fusionado", "registros fusionados")}`,
});

const noMergeKeyNotice: ReportNotice = {
  level: NoticeLevel.INFO,
  text: "La clave elegida no agrupa registros: cada grupo tiene 1 registro, no se unificará nada. Revise los campos de la clave.",
};

const invalidCountOf = (report: GeometryProcessingReport): number =>
  report.insertedInvalid > 0 ? report.insertedInvalid : report.invalidBefore;

export function shouldOfferRepair(report: GeometryProcessingReport, options: GeometryProcessingOptions): boolean {
  return !options.repair.enabled && invalidCountOf(report) > 0;
}

export function isReplaceBlocked(report: GeometryProcessingReport): boolean {
  return report.wouldBlock || report.incompatibleGeometryRows > 0;
}

function incompatibleNotices(report: GeometryProcessingReport): ReportNotice[] {
  return report.incompatibleGeometryRows > 0 ? [incompatibleGeometryNotice(report)] : [];
}

function repairNotices(report: GeometryProcessingReport, options: GeometryProcessingOptions): ReportNotice[] {
  if (options.repair.enabled) {
    return report.emptyAfterRepair > 0 ? [emptyAfterRepairNotice(report.emptyAfterRepair)] : [];
  }
  const invalidCount = invalidCountOf(report);
  return invalidCount > 0 ? [invalidInsertedNotice(invalidCount)] : [];
}

function overlapNotices(report: GeometryProcessingReport, options: GeometryProcessingOptions): ReportNotice[] {
  if (!options.overlaps.enabled) return [];
  const notices: ReportNotice[] = [];
  if (!options.repair.enabled && report.overlapSkippedInvalid > 0) {
    notices.push(invalidSkippedNotice(report.overlapSkippedInvalid));
  }
  if (report.wouldBlock) notices.push(blockingOverlapNotice(report.overlapCount));
  if (options.overlaps.policy === OverlapPolicy.REPORT && report.overlapCount > 0) {
    notices.push(reportedOverlapNotice(report.overlapCount));
  }
  return notices;
}

function unifyWarnings(report: GeometryProcessingReport, options: GeometryProcessingOptions): ReportNotice[] {
  if (!options.unify.enabled) return [];
  const warnings: ReportNotice[] = [];
  if (report.nullKeyRows > 0) warnings.push(nullKeyNotice(report.nullKeyRows));
  if (report.attributeConflicts > 0) warnings.push(conflictNotice(report.attributeConflicts));
  return warnings;
}

function unifyInfos(report: GeometryProcessingReport, options: GeometryProcessingOptions): ReportNotice[] {
  if (!options.unify.enabled) return [];
  const infos: ReportNotice[] = [];
  if (options.unify.keyFields.length === 1) infos.push(singleFieldKeyNotice);
  if (report.rowsMerged > 0) infos.push(groupsSummaryNotice(report.groups, report.rowsMerged));
  else infos.push(noMergeKeyNotice);
  return infos;
}

export function buildReportNotices(
  report: GeometryProcessingReport,
  options: GeometryProcessingOptions
): ReportNotice[] {
  const overlaps = overlapNotices(report, options);
  const errors = [
    ...incompatibleNotices(report),
    ...overlaps.filter((notice) => notice.level === NoticeLevel.ERROR),
  ];
  const warnings = [
    ...repairNotices(report, options),
    ...overlaps.filter((notice) => notice.level === NoticeLevel.WARNING),
    ...unifyWarnings(report, options),
  ];
  return [...errors, ...warnings, ...unifyInfos(report, options)];
}
