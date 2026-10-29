import type { StepTimer } from "../cargar-padrones/services/runSteps";
import type { RunSession } from "../cargar-padrones/types";
import { DETAIL_LIST_LIMIT } from "./limits";
import { listOf, numberOf, textOf, type Row } from "./rowMapping";
import type { AddressMasterSubjectSpec } from "./addressMasterLinkSpec";
import {
  buildAddressMasterApplySql,
  buildAddressMasterClassifySql,
  buildAddressMasterRemainingSql,
  type AddressMasterLinkLayouts,
} from "./addressMasterLinkSql";
import { plural } from "./text";
import { labelOf } from "./targetPreflight";

export interface AddressMasterKey {
  id: number;
  name: string | null;
  provinceId: string | null;
}

export interface AddressMasterLinked extends AddressMasterKey {
  addressMasterId: number;
  created: boolean;
}

export interface AddressMasterAmbiguous extends AddressMasterKey {
  records: number;
}

/** Created and linked count what the apply step wrote; the other counts come from the classification. */
export interface AddressMasterCounts {
  withoutAddressMaster: number;
  created: number;
  linked: number;
  alreadyHadRecord: number;
  ambiguous: number;
}

export interface AddressMasterPassBody {
  counts: AddressMasterCounts;
  toCreate: number;
  remaining: number;
  linkedList: AddressMasterLinked[];
  ambiguousSamples: AddressMasterAmbiguous[];
}

export interface AddressMasterPassSteps {
  classify: string;
  apply: string;
  verify: string;
}

interface AddressMasterClassification {
  counts: Omit<AddressMasterCounts, "linked">;
  ambiguousSamples: AddressMasterAmbiguous[];
}

interface AddressMasterApply {
  created: number;
  linked: number;
  linkedList: AddressMasterLinked[];
}

const keyOf = (entry: Row): AddressMasterKey => ({
  id: numberOf(entry.id),
  name: textOf(entry.name),
  provinceId: textOf(entry.provinceId),
});

const linkedOf = (entry: Row): AddressMasterLinked => ({
  ...keyOf(entry),
  addressMasterId: numberOf(entry.addressMasterId),
  created: entry.created === true,
});

const ambiguousOf = (entry: Row): AddressMasterAmbiguous => ({ ...keyOf(entry), records: numberOf(entry.records) });

export function toAddressMasterClassification(row: Row): AddressMasterClassification {
  return {
    counts: {
      withoutAddressMaster: numberOf(row.without_address_master),
      created: numberOf(row.to_create),
      alreadyHadRecord: numberOf(row.already_had_record),
      ambiguous: numberOf(row.ambiguous),
    },
    ambiguousSamples: listOf(row.ambiguous_samples).map(ambiguousOf),
  };
}

export function toAddressMasterApply(row: Row): AddressMasterApply {
  return {
    created: numberOf(row.created),
    linked: numberOf(row.linked),
    linkedList: listOf(row.linked_list).map(linkedOf),
  };
}

export const toRemainingCount = (row: Row): number => numberOf(row.remaining);

export const addressMasterCountsOf = (classification: AddressMasterClassification, apply: AddressMasterApply): AddressMasterCounts => ({
  ...classification.counts,
  created: apply.created,
  linked: apply.linked,
});

async function readClassification(
  session: RunSession,
  layouts: AddressMasterLinkLayouts,
  spec: AddressMasterSubjectSpec
): Promise<AddressMasterClassification> {
  const result = await session.query(buildAddressMasterClassifySql(layouts, spec));
  return toAddressMasterClassification(result.rows[0] ?? {});
}

async function readApply(
  session: RunSession,
  layouts: AddressMasterLinkLayouts,
  spec: AddressMasterSubjectSpec
): Promise<AddressMasterApply> {
  const result = await session.query(buildAddressMasterApplySql(layouts, spec));
  return toAddressMasterApply(result.rows[0] ?? {});
}

async function readRemaining(
  session: RunSession,
  layouts: AddressMasterLinkLayouts,
  spec: AddressMasterSubjectSpec
): Promise<number> {
  const result = await session.query(buildAddressMasterRemainingSql(layouts, spec));
  return toRemainingCount(result.rows[0] ?? {});
}

function assertLinkApplyMatches(
  layouts: AddressMasterLinkLayouts,
  spec: AddressMasterSubjectSpec,
  classification: AddressMasterClassification,
  apply: AddressMasterApply
): void {
  const { counts } = classification;
  const { texts } = spec;
  if (apply.created !== counts.created) {
    throw new Error(
      `Los registros de dirección maestra creados${texts.createdScope} (${apply.created}) no coinciden con los esperados (${counts.created}) en ${labelOf(layouts.addressMaster)}.`
    );
  }
  const expectedLinked = counts.withoutAddressMaster - counts.ambiguous;
  if (apply.linked !== expectedLinked) {
    throw new Error(
      `${texts.linkedMessageStart} (${apply.linked}) no coinciden con ${texts.expectedPhrase} (${expectedLinked}) en ${labelOf(layouts.subject)}.`
    );
  }
}

function assertLinkRemainingMatches(
  layouts: AddressMasterLinkLayouts,
  spec: AddressMasterSubjectSpec,
  classification: AddressMasterClassification,
  remaining: number
): void {
  const { ambiguous } = classification.counts;
  if (remaining !== ambiguous) {
    const { texts } = spec;
    throw new Error(
      `${texts.remainingMessageStart} (${remaining}) no coinciden con ${texts.ambiguousPhrase} (${ambiguous}) en ${labelOf(layouts.subject)}.`
    );
  }
}

/** Classify, apply and verify one subject's address master links, inside the caller's transaction. */
export async function runAddressMasterLinkPass(
  session: RunSession,
  layouts: AddressMasterLinkLayouts,
  spec: AddressMasterSubjectSpec,
  steps: AddressMasterPassSteps,
  timer: StepTimer
): Promise<AddressMasterPassBody> {
  const classification = await timer.run(steps.classify, () => readClassification(session, layouts, spec));
  // Ordered: classify must run before apply in the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const apply = await timer.run(steps.apply, () => readApply(session, layouts, spec));
  assertLinkApplyMatches(layouts, spec, classification, apply);
  const remaining = await timer.run(steps.verify, () => readRemaining(session, layouts, spec));
  assertLinkRemainingMatches(layouts, spec, classification, remaining);
  return {
    counts: addressMasterCountsOf(classification, apply),
    toCreate: classification.counts.created,
    remaining,
    linkedList: apply.linkedList,
    ambiguousSamples: classification.ambiguousSamples,
  };
}

export function addressMasterCountWarnings(
  spec: AddressMasterSubjectSpec,
  table: string,
  counts: Pick<AddressMasterCounts, "ambiguous" | "linked">
): string[] {
  const warnings: string[] = [];
  if (counts.ambiguous > 0) {
    warnings.push(
      `${plural(counts.ambiguous, ...spec.texts.ambiguousNouns)} en ${table}: tienen más de un registro de dirección maestra con su URN, no se crearon ni enlazaron.`
    );
  }
  if (counts.linked > DETAIL_LIST_LIMIT) {
    warnings.push(`Se listan las primeras ${DETAIL_LIST_LIMIT} ${spec.texts.linkedNoun} en ${table}.`);
  }
  return warnings;
}
