import { RemovalState, RemovalTable, REMOVAL_PENDING_MESSAGE } from "@/modules/address-dedup/removalConstants";
import type { RemovalConfirmation, RemovalCounts, RemovalPlan, RemovalResult } from "@/modules/address-dedup/removalTypes";
import type { RemovalRepository } from "@/modules/address-dedup/services/RemovalRepository";
import type { RepositoryRequest } from "@/modules/address-dedup/types";

export const FINGERPRINT = "0123456789abcdef0123456789abcdef";
export const OPERATION_ID = "6f1c2a3e-8b4d-4e5f-9a0b-1c2d3e4f5a6b";

const ZERO_ROWS = Object.fromEntries(Object.values(RemovalTable).map((table) => [table, 0])) as Record<
  RemovalTable,
  number
>;

export const COUNTS: RemovalCounts = {
  total: 2,
  byFuente: { ANTEL: 1, TLK: 1 },
  rowsByTable: { ...ZERO_ROWS, address: 2, access_point: 2, addresses_master: 2 },
};

export const PLAN: RemovalPlan = {
  fingerprint: FINGERPRINT,
  counts: COUNTS,
  blockers: [],
  targets: [
    { urn: "cgeo:Antel:address:id:2", fuente: "ANTEL" },
    { urn: "cgeo:TLK:wstlk:id:3", fuente: "TLK" },
  ],
  snapshot: { version: 1, direcciones: [{ secret: "stays-server-side" }] },
};

export const RESULT: RemovalResult = {
  operationId: OPERATION_ID,
  fingerprint: FINGERPRINT,
  state: RemovalState.DELETED_PENDING_INDEXES,
  counts: COUNTS,
  deletedByTable: COUNTS.rowsByTable,
  pending: REMOVAL_PENDING_MESSAGE,
  recovered: false,
};

export class FakeRemovalRepository implements RemovalRepository {
  public readonly simulated: RepositoryRequest[] = [];
  public readonly executed: Array<{ request: RepositoryRequest; confirmation: RemovalConfirmation }> = [];

  constructor(
    private readonly plan: RemovalPlan = PLAN,
    private readonly failure?: Error
  ) {}

  async simulateRemoval(request: RepositoryRequest): Promise<RemovalPlan> {
    this.simulated.push(request);
    if (this.failure) throw this.failure;
    return this.plan;
  }

  async executeRemoval(request: RepositoryRequest, confirmation: RemovalConfirmation): Promise<RemovalResult> {
    this.executed.push({ request, confirmation });
    if (this.failure) throw this.failure;
    return { ...RESULT, operationId: confirmation.operationId };
  }
}
