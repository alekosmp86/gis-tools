import { STATEMENT_TIMEOUT_MS } from "../../constants";
import { createPgClient, type PgClientFactory } from "../../shared/pgClient";
import { runInTransaction, type TransactionSettings } from "../../shared/runInTransaction";
import type { DbConnection } from "../../types";
import { LOAD_LOCK_TIMEOUT, LOAD_STATEMENT_TIMEOUT_MS, type SigraLayerId } from "../constants";
import { failureReader } from "../domain/failureReader";
import { resolveLayerColumns } from "../domain/layerColumns";
import { getSigraLayer } from "../domain/layerRegistry";
import { buildLayerResult, dryRunOutcome, failedOutcome, loadedOutcome, newProgress, rejectedOutcome } from "../domain/loadResult";
import {
  LayerLoadStep,
  type LayerLoadResult,
  type LoadLayerOptions,
  type LoadOutcome,
  type LoadProgress,
  type SigraDbState,
  type SigraRepositoryOptions,
  type WfsPageFetcher,
} from "../types";
import { finishAudit, skippedAudit, startAudit } from "./auditLog";
import { LoadStepError, ValidationRejectedError } from "./loadErrors";
import { readSigraDbState } from "./queries/runStateQueries";
import { loadInsideTransaction, type LayerRun } from "./runLayerTransaction";
import type { SigraLayersRepository } from "./SigraLayersRepository";
import { createWfsPageFetcher } from "./WfsClient";

const READ_ONLY_TRANSACTION: TransactionSettings = {
  begin: "BEGIN READ ONLY",
  settings: [`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`],
};

const LOAD_TRANSACTION: TransactionSettings = {
  begin: "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE",
  settings: [`SET LOCAL lock_timeout = '${LOAD_LOCK_TIMEOUT}'`, `SET LOCAL statement_timeout = ${LOAD_STATEMENT_TIMEOUT_MS}`],
};

/**
 * One transaction per layer: TEMP staging, pages, validation and the DELETE + INSERT swap. A dry
 * run is the same path ending in ROLLBACK, before any lock. Expected failures never throw: they
 * become a `LayerLoadResult` that says which step failed.
 */
export class PgSigraLayersRepository implements SigraLayersRepository {
  private readonly createClient: PgClientFactory;
  private readonly fetcher: WfsPageFetcher;
  private readonly now: () => number;

  constructor(options: SigraRepositoryOptions = {}) {
    this.createClient = options.createClient ?? createPgClient;
    this.fetcher = options.fetcher ?? createWfsPageFetcher();
    this.now = options.now ?? Date.now;
  }

  inspect(connection: DbConnection, layerIds: ReadonlyArray<SigraLayerId>): Promise<SigraDbState> {
    return runInTransaction(this.createClient(connection), READ_ONLY_TRANSACTION, false, (client) =>
      readSigraDbState(client, layerIds),
    );
  }

  async loadLayer(connection: DbConnection, layerId: SigraLayerId, options: LoadLayerOptions): Promise<LayerLoadResult> {
    const startedAt = this.now();
    const layer = getSigraLayer(layerId);
    const describeFailure = failureReader(connection.password);
    const progress = newProgress();
    const audit = options.dryRun ? skippedAudit() : await startAudit(this.createClient, connection, layer.etlName, describeFailure);

    const run: LayerRun = { layer, columns: resolveLayerColumns(layer), dryRun: options.dryRun, source: this.fetcher, progress };
    const outcome = await this.runTransaction(connection, run, describeFailure);
    const elapsedMs = this.now() - startedAt;

    const auditWarning = options.dryRun
      ? null
      : await finishAudit(this.createClient, connection, audit, { outcome, progress }, describeFailure);
    return buildLayerResult(layerId, outcome, progress, elapsedMs, auditWarning);
  }

  private async runTransaction(
    connection: DbConnection,
    run: LayerRun,
    describeFailure: (error: unknown) => string,
  ): Promise<LoadOutcome> {
    try {
      await runInTransaction(this.createClient(connection), LOAD_TRANSACTION, !run.dryRun, (client) =>
        loadInsideTransaction(client, run),
      );
      return run.dryRun ? dryRunOutcome(run.progress) : loadedOutcome(run.progress);
    } catch (error) {
      return describeError(error, run.progress, describeFailure);
    }
  }
}

function stepOf(error: unknown, progress: LoadProgress): LayerLoadStep | null {
  if (error instanceof LoadStepError) return error.step;
  return progress.finalCount === null ? null : LayerLoadStep.SWAP;
}

function describeError(error: unknown, progress: LoadProgress, describeFailure: (error: unknown) => string): LoadOutcome {
  if (error instanceof ValidationRejectedError) return rejectedOutcome(error.message);
  return failedOutcome(stepOf(error, progress), describeFailure(error));
}
