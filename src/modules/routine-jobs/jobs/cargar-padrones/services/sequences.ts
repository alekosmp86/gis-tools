import {
  buildRepairSequenceStatement,
  buildResetSequenceStatement,
} from "@/core/services/sqlStatements";
import { discoverTargetSequences, type SequenceRef } from "@/core/services/replaceSequences";
import type { RunSession } from "../types";
import type { ResolvedLayouts } from "./resolveLayouts";

function unmappedSequences(layouts: ResolvedLayouts): SequenceRef[] {
  const mapped = new Set(Object.values(layouts.target.columns));
  return discoverTargetSequences(layouts.targetCatalog, [], layouts.target.schema).sequences.filter((sequence) =>
    sequence.columns.every((column) => !mapped.has(column))
  );
}

export async function resetUnmappedSequences(session: RunSession, layouts: ResolvedLayouts): Promise<void> {
  for (const sequence of unmappedSequences(layouts)) {
    await session.query(buildResetSequenceStatement(sequence.schema, sequence.name));
  }
}

export async function repairUnmappedSequences(session: RunSession, layouts: ResolvedLayouts): Promise<void> {
  const { schema, table } = layouts.target;
  for (const sequence of unmappedSequences(layouts)) {
    await session.query(buildRepairSequenceStatement(sequence.schema, sequence.name, schema, table, sequence.columns));
  }
}

export async function repairUnmappedSequencesAfterRollback(session: RunSession, layouts: ResolvedLayouts): Promise<void> {
  await repairUnmappedSequences(session, layouts).catch(() => undefined);
}
