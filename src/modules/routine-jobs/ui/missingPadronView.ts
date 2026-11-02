import { REPLACEMENT_CLASS, REPLACEMENT_CLASS_ORDER, type ReplacementClass } from "../jobs/actualizar-padron/constants";
import type { ActualizarTargetReport, MissingPadron, MissingPadronRefs } from "../jobs/actualizar-padron/types";
import type { ReportRowListRow } from "./ReportRowList";
import { NO_DATA_TEXT } from "./reportFormat";
import { listSummaryOf } from "./reportViewParts";
import { subjectOfMissing, type PadronMapSubject } from "./padronMapSubject";

const MISSING_SECTION_TITLE = "Padrones que ya no están en el catastro";

export const REPLACEMENT_CLASS_LABEL: Record<ReplacementClass, string> = {
  [REPLACEMENT_CLASS.SUBDIVIDED]: "Subdividido",
  [REPLACEMENT_CLASS.REPLACED_ONE]: "Reemplazado",
  [REPLACEMENT_CLASS.PARTIAL]: "Cubierto en parte",
  [REPLACEMENT_CLASS.ORPHAN]: "Huérfano",
};

const REPLACEMENT_COUNT_LABEL: Record<ReplacementClass, string> = {
  [REPLACEMENT_CLASS.SUBDIVIDED]: "Subdivididos",
  [REPLACEMENT_CLASS.REPLACED_ONE]: "Reemplazados por uno",
  [REPLACEMENT_CLASS.PARTIAL]: "Cubiertos en parte",
  [REPLACEMENT_CLASS.ORPHAN]: "Huérfanos",
};

const LIST_SEPARATOR = "; ";

/** The record-only removal decision of a missing padrón (AP-101). */
export const removalDecisionLabelOf = (marked: boolean): string => (marked ? "Marcado para eliminar" : "Se conserva");

export interface MissingPadronView {
  key: string;
  classLabel: string;
  type: string;
  department: string;
  locality: string;
  number: string;
  oldId: number;
  oldAreaM2: number | null;
  coveredPct: number | null;
  replacedBy: string;
  refs: string;
  centroidLat: number | null;
  centroidLon: number | null;
  subject: PadronMapSubject;
}

export interface MissingReviewView {
  title: string;
  counts: ReportRowListRow[];
  rows: MissingPadronView[];
  total: number;
  shown: number;
}

const textOf = (value: string | null): string => value ?? NO_DATA_TEXT;

export const replacedByTextOf = (parts: readonly string[]): string =>
  parts.length === 0 ? NO_DATA_TEXT : parts.join(LIST_SEPARATOR);

/** Only the reference tables the carto schema has are named; a missing refs object means none could be read. */
export function refsTextOf(refs: MissingPadronRefs | undefined): string {
  if (refs === undefined) return NO_DATA_TEXT;
  const texts = [
    ...(refs.accessPoint === undefined ? [] : [`puntos de acceso: ${refs.accessPoint}`]),
    ...(refs.addresses === undefined ? [] : [`direcciones: ${refs.addresses}`]),
  ];
  return texts.length === 0 ? NO_DATA_TEXT : texts.join(LIST_SEPARATOR);
}

const missingPadronViewOf = (padron: MissingPadron): MissingPadronView => ({
  key: `${padron.oldId}`,
  classLabel: REPLACEMENT_CLASS_LABEL[padron.class],
  type: textOf(padron.typePadron),
  department: textOf(padron.department),
  locality: textOf(padron.locality),
  number: textOf(padron.number),
  oldId: padron.oldId,
  oldAreaM2: padron.oldAreaM2,
  coveredPct: padron.coveredPct,
  replacedBy: replacedByTextOf(padron.parts),
  refs: refsTextOf(padron.refs),
  centroidLat: padron.centroidLat,
  centroidLon: padron.centroidLon,
  subject: subjectOfMissing(padron),
});

/** Null when the target has no missing padrón: the section is not shown. */
export function missingReviewViewOf(target: ActualizarTargetReport): MissingReviewView | null {
  if (target.missing === 0) return null;
  return {
    title: listSummaryOf(MISSING_SECTION_TITLE, target.missingReview.length, target.missing),
    counts: REPLACEMENT_CLASS_ORDER.map((replacementClass) => ({
      label: REPLACEMENT_COUNT_LABEL[replacementClass],
      value: target.missingByClass[replacementClass],
    })),
    rows: target.missingReview.map(missingPadronViewOf),
    total: target.missing,
    shown: target.missingReview.length,
  };
}
