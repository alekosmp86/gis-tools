import type { ClientConnection } from "./clientTypes";

/** Returns the trimmed schema to commit, or null when the draft is blank (nothing to commit). */
export function commitSchema(draft: string): string | null {
  const trimmed = draft.trim();
  return trimmed === "" ? null : trimmed;
}

export interface SchemaCommitPlan {
  commit: boolean;
  schema: string | null;
}

/** Whether a draft must be committed: blank drafts and drafts equal to the committed schema are not. */
export function schemaCommitPlan(draft: string, committed: string): SchemaCommitPlan {
  const next = commitSchema(draft);
  if (next === null || next === committed.trim()) return { commit: false, schema: null };
  return { commit: true, schema: next };
}

/**
 * Identifies one catalog: the server, port, database, user and schema. The password is left out on
 * purpose, so the key never carries a secret; each part is length-prefixed so that values which only
 * differ in where the fields split cannot collide.
 */
export function catalogKey(connection: ClientConnection, schema: string): string {
  return [connection.host, connection.port, connection.db_name, connection.user, schema]
    .map((part) => `${part.length}:${part}`)
    .join("|");
}

/**
 * Shares one pending call per key: callers that arrive while a call with the same key is pending
 * receive that same promise. The entry is removed once the call settles, so a retry starts a new call.
 */
export function createInFlightMemo<K, V>(): (key: K, load: () => Promise<V>) => Promise<V> {
  const pending = new Map<K, Promise<V>>();
  return (key, load) => {
    const existing = pending.get(key);
    if (existing) return existing;
    const started = load().finally(() => {
      pending.delete(key);
    });
    pending.set(key, started);
    return started;
  };
}
