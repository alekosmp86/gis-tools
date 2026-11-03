import {
  PAIR_STATUS,
  REMOVAL_SKIP_REASON,
  REPLACEMENT_CLASS,
  REPLACEMENT_CLASS_ORDER,
  type ReplacementClass,
} from "../jobs/actualizar-padron/constants";
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
  /** The read-only removal status (AP-101): what the real run will do with this padrón. */
  removalStatus: string;
  willBeRemoved: boolean;
  centroidLat: number | null;
  centroidLon: number | null;
  subject: PadronMapSubject;
}

export interface MissingReviewView {
  title: string;
  counts: ReportRowListRow[];
  rows: MissingPadronView[];
  awaitingPairNote: string | null;
  total: number;
  shown: number;
}

const textOf = (value: string | null): string => value ?? NO_DATA_TEXT;

export const replacedByTextOf = (parts: readonly string[]): string =>
  parts.length === 0 ? NO_DATA_TEXT : parts.join(LIST_SEPARATOR);

/** Only the carto-schema tables the catalog scan (AP-102) actually found referencing this padrón are named. */
export function refsTextOf(refs: MissingPadronRefs | undefined): string {
  if (refs === undefined || refs.total === 0) return NO_DATA_TEXT;
  const texts = Object.entries(refs.byTable).map(([table, count]) => `${table}: ${count}`);
  return texts.length === 0 ? NO_DATA_TEXT : texts.join(LIST_SEPARATOR);
}

const WILL_BE_REMOVED_TEXT = "Se eliminará";
const NOT_REMOVED_PREFIX = "No se elimina: ";
const PAIR_OPEN_TEXT = `${NOT_REMOVED_PREFIX}tiene un par sin resolver`;
const UNVERIFIED_TEXT = `${NOT_REMOVED_PREFIX}no se pudieron verificar sus referencias`;

const referencedTextOf = (refs: MissingPadronRefs | undefined): string => {
  const total = refs?.total ?? 0;
  const noun = total === 1 ? "dirección asociada" : "direcciones asociadas";
  return `${NOT_REMOVED_PREFIX}tiene ${total} ${noun} (${refsTextOf(refs)})`;
};

const NOT_REASSIGNABLE_TEXT = `${NOT_REMOVED_PREFIX}no se pueden reasignar sus direcciones`;

/** AP-115: a padrón that will be removed while still referenced is a subdivided one: its addresses move to its parts. */
function willBeRemovedTextOf(padron: MissingPadron): string {
  const moved = padron.refs?.total ?? 0;
  if (moved === 0) return WILL_BE_REMOVED_TEXT;
  return `${WILL_BE_REMOVED_TEXT} (${moved} ${moved === 1 ? "dirección pasa" : "direcciones pasan"} a sus partes)`;
}

function notReassignableTextOf(padron: MissingPadron): string {
  const blockers = Object.entries(padron.reassignBlockers ?? {}).map(([table, reason]) => `${table}: ${reason}`);
  return blockers.length === 0 ? NOT_REASSIGNABLE_TEXT : `${NOT_REASSIGNABLE_TEXT} (${blockers.join(LIST_SEPARATOR)})`;
}

/** AP-101: the status is read from the server's reason for the padrón, never decided in the browser. */
function removalStatusOf(padron: MissingPadron): string {
  switch (padron.removalReason) {
    case REMOVAL_SKIP_REASON.STILL_PAIRABLE:
      return PAIR_OPEN_TEXT;
    case REMOVAL_SKIP_REASON.NOW_REFERENCED:
      return referencedTextOf(padron.refs);
    case REMOVAL_SKIP_REASON.NOT_REASSIGNABLE:
      return notReassignableTextOf(padron);
    case REMOVAL_SKIP_REASON.UNVERIFIED:
      return UNVERIFIED_TEXT;
    case null:
      return willBeRemovedTextOf(padron);
  }
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
  removalStatus: removalStatusOf(padron),
  willBeRemoved: padron.removalReason === null,
  centroidLat: padron.centroidLat,
  centroidLon: padron.centroidLon,
  subject: subjectOfMissing(padron),
});

export interface MissingAwaitingPair {
  oldIds: ReadonlySet<number>;
  count: number;
  /** The pairs list is cut, so more padrones than counted may await a pair decision. */
  atLeast: boolean;
}

/** The old side of every pending or ambiguous pair of the listed pairs: its decision lives in the pairs lists, not in the missing list. */
export function missingAwaitingPairOf(target: ActualizarTargetReport): MissingAwaitingPair {
  const oldIds = new Set<number>();
  for (const pair of target.pairs) {
    const awaiting = pair.status === PAIR_STATUS.NOT_APPLIED_PENDING || pair.status === PAIR_STATUS.NOT_APPLIED_AMBIGUOUS;
    if (awaiting && pair.oldId !== null) oldIds.add(pair.oldId);
  }
  return { oldIds, count: oldIds.size, atLeast: target.pairsTotal > target.pairs.length };
}

const AWAITING_SUFFIX = "una decisión de par (ver pares pendientes y ambiguos)";

function awaitingNoteOf({ count, atLeast }: MissingAwaitingPair): string | null {
  if (count === 0) return null;
  const verb = count === 1 ? "espera" : "esperan";
  const noun = count === 1 ? "faltante" : "faltantes";
  return `${atLeast ? "Al menos " : ""}${count} ${noun} ${verb} ${AWAITING_SUFFIX}`;
}

/** Null when the target has no missing padrón: the section is not shown. Padrones awaiting a pair decision are counted, not listed. */
export function missingReviewViewOf(target: ActualizarTargetReport): MissingReviewView | null {
  if (target.missing === 0) return null;
  const awaiting = missingAwaitingPairOf(target);
  const rows = target.missingReview.filter((padron) => !awaiting.oldIds.has(padron.oldId)).map(missingPadronViewOf);
  const serverCut = target.missingReview.length < target.missing;
  const total = serverCut ? Math.max(rows.length, target.missing - awaiting.count) : rows.length;
  return {
    title: listSummaryOf(MISSING_SECTION_TITLE, rows.length, total),
    counts: REPLACEMENT_CLASS_ORDER.map((replacementClass) => ({
      label: REPLACEMENT_COUNT_LABEL[replacementClass],
      value: target.missingByClass[replacementClass],
    })),
    rows,
    awaitingPairNote: awaitingNoteOf(awaiting),
    total,
    shown: rows.length,
  };
}
