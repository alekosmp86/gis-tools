/** Fake answers for the sequence-state check (SQ-5): shared by the job run tests so each fake session answers the same queries. */
export interface FakeSequenceState {
  /** Quoted table name as it appears in the max(id) query, for example "padron". */
  table: string;
  sequence: string;
  lastValue: number | null;
  maxId: number | null;
}

const AHEAD_SEQUENCE = { lastValue: 1000, maxId: 10 } as const;

/** Returns the rows for a sequence-state statement, or undefined when the statement is something else. A table without a configured state is ahead of its ids. */
export function sequenceStateRows(
  sql: string,
  params: readonly unknown[] | undefined,
  states: readonly FakeSequenceState[]
): Array<Record<string, unknown>> | undefined {
  if (sql.includes("pg_sequence_last_value")) {
    const state = states.find((candidate) => candidate.sequence === params?.[0]);
    const lastValue = state === undefined ? AHEAD_SEQUENCE.lastValue : state.lastValue;
    return [{ readable: true, last_value: lastValue }];
  }
  if (sql.startsWith("SELECT max(")) {
    const state = states.find((candidate) => sql.includes(`"${candidate.table}"`));
    return [{ max_id: state === undefined ? AHEAD_SEQUENCE.maxId : state.maxId }];
  }
  return undefined;
}
