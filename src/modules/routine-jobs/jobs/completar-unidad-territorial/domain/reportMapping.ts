import type {
  CompletarAmbiguousUnit,
  CompletarApplyOutcome,
  CompletarClassification,
  CompletarCounts,
  CompletarLinkedUnit,
  CompletarUnitKey,
} from "../types";
import { numberOf, textOf, listOf, type Row } from "../../shared/rowMapping";

const unitKeyOf = (entry: Row): CompletarUnitKey => ({
  id: numberOf(entry.id),
  name: textOf(entry.name),
  provinceId: textOf(entry.provinceId),
});

const linkedOf = (entry: Row): CompletarLinkedUnit => ({
  ...unitKeyOf(entry),
  addressMasterId: numberOf(entry.addressMasterId),
  created: entry.created === true,
});

const ambiguousOf = (entry: Row): CompletarAmbiguousUnit => ({ ...unitKeyOf(entry), records: numberOf(entry.records) });

export function toCompletarClassification(row: Row): CompletarClassification {
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

export function toCompletarApplyOutcome(row: Row): CompletarApplyOutcome {
  return {
    created: numberOf(row.created),
    linked: numberOf(row.linked),
    linkedList: listOf(row.linked_list).map(linkedOf),
  };
}

export const toRemainingCount = (row: Row): number => numberOf(row.remaining);

export const completarCountsOf = (classification: CompletarClassification, apply: CompletarApplyOutcome): CompletarCounts => ({
  ...classification.counts,
  created: apply.created,
  linked: apply.linked,
});
