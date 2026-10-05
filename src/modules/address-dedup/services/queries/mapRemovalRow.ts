import type { TargetVerdict } from "../../domain/removal";
import { RemovalTable, type RemovalBlockReason } from "../../removalConstants";
import type { RemovalCounts, RemovalPlanTarget, RemovalTargets } from "../../removalTypes";

type RawRow = Record<string, unknown>;

/** The one row `REMOVAL_PLAN_SQL` returns, with the JSON columns already parsed by the driver. */
export interface RemovalPlanRow {
  readonly outOfScopeCount: number;
  readonly counts: RemovalCounts;
  readonly verdicts: ReadonlyArray<TargetVerdict>;
  readonly targets: RemovalTargets;
  readonly planTargets: ReadonlyArray<RemovalPlanTarget>;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly fingerprint: string;
}

/** Ids arrive as JSON strings (cast to text in SQL); String() keeps a bigint beyond 2^53 exact. */
function toIdList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function toCountRecord<TKey extends string>(value: unknown, keys: ReadonlyArray<TKey>): Record<TKey, number> {
  const raw = (typeof value === "object" && value !== null ? value : {}) as RawRow;
  const record = {} as Record<TKey, number>;
  for (const key of keys) record[key] = Number(raw[key] ?? 0);
  return record;
}

function toByFuente(value: unknown): Record<string, number> {
  const raw = (typeof value === "object" && value !== null ? value : {}) as RawRow;
  return Object.fromEntries(Object.entries(raw).map(([fuente, count]) => [fuente, Number(count)]));
}

function toVerdict(value: unknown): TargetVerdict {
  const raw = value as RawRow;
  return {
    urn: String(raw.urn ?? ""),
    masterIds: toIdList(raw.masterIds),
    reasonCodes: (Array.isArray(raw.reasons) ? raw.reasons : []) as RemovalBlockReason[],
  };
}

function toPlanTarget(value: unknown): RemovalPlanTarget {
  const raw = value as RawRow;
  return { urn: String(raw.urn ?? ""), fuente: String(raw.fuente ?? "") };
}

export function mapRemovalPlanRow(row: RawRow): RemovalPlanRow {
  return {
    outOfScopeCount: Number(row.out_of_scope_count),
    counts: {
      total: Number(row.target_count),
      byFuente: toByFuente(row.by_fuente),
      rowsByTable: toCountRecord(row.rows_by_table, Object.values(RemovalTable)),
    },
    verdicts: (Array.isArray(row.verdicts) ? row.verdicts : []).map(toVerdict),
    targets: {
      addressIds: toIdList(row.address_ids),
      masterIds: toIdList(row.master_ids),
      urns: toIdList(row.urns),
    },
    planTargets: (Array.isArray(row.target_list) ? row.target_list : []).map(toPlanTarget),
    snapshot: row.snapshot as Readonly<Record<string, unknown>>,
    fingerprint: String(row.fingerprint),
  };
}
