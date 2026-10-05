import { STATEMENT_TIMEOUT_MS } from "../constants";
import { assertConfirmation, assertExecutable } from "../domain/removal";
import { REMOVAL_LOCK_TIMEOUT, REMOVAL_PENDING_MESSAGE, RemovalState } from "../removalConstants";
import type {
  RemovalConfirmation,
  RemovalPlan,
  RemovalResult,
  ResolvedRemoval,
} from "../removalTypes";
import type { RepositoryRequest } from "../types";
import { createPgClient, type PgClientFactory, type PgClientLike } from "./PgAddressRepository";
import type { RemovalRepository } from "./RemovalRepository";
import {
  acquireOperationLock,
  assertRemovalPreconditions,
  findPriorOperation,
  recordOperation,
} from "./queries/removalAudit";
import {
  assertGlobalGuardsClear,
  deleteRemovalTargets,
  lockMasterReferenceTables,
  lockRemovalTables,
} from "./queries/removalExecution";
import { resolveRemovalPlan } from "./queries/resolveRemovalPlan";
import { runInTransaction, type TransactionSettings } from "./runInTransaction";

const STATEMENT_TIMEOUT_SETTING = `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`;

const SIMULATION_TRANSACTION: TransactionSettings = {
  begin: "BEGIN READ ONLY",
  settings: [STATEMENT_TIMEOUT_SETTING],
};

/** The write transaction: READ COMMITTED as `carto.baja_direccion` requires, and a short lock wait. */
const EXECUTION_TRANSACTION: TransactionSettings = {
  begin: "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE",
  settings: [`SET LOCAL lock_timeout = '${REMOVAL_LOCK_TIMEOUT}'`, STATEMENT_TIMEOUT_SETTING],
};

function toRemovalResult(
  confirmation: RemovalConfirmation,
  resolved: ResolvedRemoval,
  deletedByTable: RemovalResult["deletedByTable"]
): RemovalResult {
  return {
    operationId: confirmation.operationId,
    fingerprint: resolved.plan.fingerprint,
    state: RemovalState.DELETED_PENDING_INDEXES,
    counts: resolved.plan.counts,
    deletedByTable,
    pending: REMOVAL_PENDING_MESSAGE,
    recovered: false,
  };
}

/**
 * The module's only write path. Each call opens its own connection, separate from the read-only
 * one `PgAddressRepository` uses; `simulateRemoval` is itself a read-only transaction that is
 * always rolled back. `executeRemoval` deletes only a plan it recomputed itself, inside the
 * transaction, whose fingerprint equals the one the user confirmed.
 */
export class PgRemovalRepository implements RemovalRepository {
  constructor(private readonly createClient: PgClientFactory = createPgClient) {}

  async simulateRemoval(request: RepositoryRequest): Promise<RemovalPlan> {
    const client = this.createClient(request.connection);
    const resolved = await runInTransaction(client, SIMULATION_TRANSACTION, false, async (transactionClient) => {
      await assertRemovalPreconditions(transactionClient);
      return resolveRemovalPlan(transactionClient, request.parameters);
    });
    return resolved.plan;
  }

  async executeRemoval(
    request: RepositoryRequest,
    confirmation: RemovalConfirmation
  ): Promise<RemovalResult> {
    assertConfirmation(confirmation);
    const client = this.createClient(request.connection);
    return runInTransaction(client, EXECUTION_TRANSACTION, true, (transactionClient) =>
      this.executeInTransaction(transactionClient, request, confirmation)
    );
  }

  private async executeInTransaction(
    client: PgClientLike,
    request: RepositoryRequest,
    confirmation: RemovalConfirmation
  ): Promise<RemovalResult> {
    await acquireOperationLock(client, confirmation.operationId);
    await assertRemovalPreconditions(client);
    const priorResult = await findPriorOperation(client, confirmation, request.parameters);
    if (priorResult) return priorResult;

    await lockRemovalTables(client);
    await assertGlobalGuardsClear(client);
    await lockMasterReferenceTables(client);

    const resolved = await resolveRemovalPlan(client, request.parameters);
    assertExecutable(resolved.plan, confirmation.expectedFingerprint);

    const deletedByTable = await deleteRemovalTargets(client, resolved.plan, resolved.targets);
    const removalResult = toRemovalResult(confirmation, resolved, deletedByTable);
    await recordOperation(client, confirmation, request.parameters, resolved.plan, removalResult);
    return removalResult;
  }
}
