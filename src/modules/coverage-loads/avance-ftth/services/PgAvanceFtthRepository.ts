import { STATEMENT_TIMEOUT_MS, WRITE_LOCK_TIMEOUT } from "../../constants";
import { createPgClient, type PgClientFactory, type PgClientLike } from "../../shared/pgClient";
import { runInTransaction, type TransactionSettings } from "../../shared/runInTransaction";
import type { DbConnection } from "../../types";
import {
  DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS,
  REPORT_GROUPS,
  REPORT_STATEMENT_TIMEOUT_MS,
  WRITE_STATEMENT_TIMEOUT_MS,
  type ReportKind,
} from "../constants";
import { buildLoadResult } from "../domain/loadResult";
import { assertLoadable, buildPlan } from "../domain/plan";
import type { AvanceDbState, AvanceLoadResult, ParsedAvanceFile, ReportData } from "../types";
import type { AvanceFtthRepository, LoadRequest } from "./AvanceFtthRepository";
import { runReportsGuarded } from "./queries/runReportQueries";
import { lockStaging, rebuildAvance, type RebuildOutcome } from "./queries/runRebuildQueries";
import { readDbState } from "./queries/runStateQueries";

const SCRUBBED_SECRET = "***";
const UNKNOWN_FAILURE = "error desconocido";

const READ_ONLY_TRANSACTION: TransactionSettings = {
  begin: "BEGIN READ ONLY",
  settings: [`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`],
};

const REPORT_TRANSACTION: TransactionSettings = {
  begin: "BEGIN READ ONLY",
  settings: [`SET LOCAL statement_timeout = ${REPORT_STATEMENT_TIMEOUT_MS}`],
};

const WRITE_TRANSACTION: TransactionSettings = {
  begin: "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE",
  settings: [
    `SET LOCAL lock_timeout = '${WRITE_LOCK_TIMEOUT}'`,
    `SET LOCAL statement_timeout = ${WRITE_STATEMENT_TIMEOUT_MS}`,
  ],
};

interface WrittenTransaction {
  readonly rebuilt: RebuildOutcome;
  /** Only a dry run computes the reports inside the (rolled back) write transaction. */
  readonly reports: ReportData[];
}

function failureReader(secret: string): (error: unknown) => string {
  return (error) => {
    const message = error instanceof Error ? error.message : UNKNOWN_FAILURE;
    return secret.length > 0 ? message.split(secret).join(SCRUBBED_SECRET) : message;
  };
}

/** Pre-write check, made under the staging locks: the plan recomputed from what the database says right now. */
async function assertPlanStillHolds(client: PgClientLike, files: ReadonlyArray<ParsedAvanceFile>): Promise<void> {
  assertLoadable(buildPlan(files, [], await readDbState(client)));
}

/**
 * Plan and reports run in `BEGIN READ ONLY`, so a write attempt is refused by Postgres itself. The
 * load is the one write path: one connection, one transaction, COMMIT only when every step and the
 * consistency check passed; any failure rolls everything back and the previous content stays. A dry
 * run is the same path ending in ROLLBACK, with the reports computed before it.
 */
export class PgAvanceFtthRepository implements AvanceFtthRepository {
  constructor(
    private readonly createClient: PgClientFactory = createPgClient,
    private readonly clock: () => number = Date.now
  ) {}

  inspect(connection: DbConnection): Promise<AvanceDbState> {
    return runInTransaction(this.createClient(connection), READ_ONLY_TRANSACTION, false, readDbState);
  }

  async load(connection: DbConnection, request: LoadRequest): Promise<AvanceLoadResult> {
    const startedAt = this.clock();
    const written = await this.writeTransaction(connection, request);
    const reports = request.dryRun ? written.reports : await this.readReports(connection, REPORT_GROUPS.flat());
    return buildLoadResult({
      dryRun: request.dryRun,
      files: written.rebuilt.files,
      history: written.rebuilt.history,
      byStatus: written.rebuilt.byStatus,
      reports,
      elapsedMs: this.clock() - startedAt,
      parsed: request.files,
    });
  }

  async readReports(connection: DbConnection, kinds: ReadonlyArray<ReportKind>): Promise<ReportData[]> {
    const describeFailure = failureReader(connection.password);
    const wanted = new Set(kinds);
    const groups = REPORT_GROUPS.flatMap((group) => {
      const selected = group.filter((kind) => wanted.has(kind));
      return selected.length > 0 ? [selected] : [];
    });
    const readGroups = await Promise.all(groups.map((group) => this.readGroup(connection, group, describeFailure)));
    return readGroups.flat();
  }

  private writeTransaction(connection: DbConnection, request: LoadRequest): Promise<WrittenTransaction> {
    const describeFailure = failureReader(connection.password);
    return runInTransaction(this.createClient(connection), WRITE_TRANSACTION, !request.dryRun, async (client) => {
      await lockStaging(client);
      await assertPlanStillHolds(client, request.files);
      const rebuilt = await rebuildAvance(client, request.files);
      if (!request.dryRun) return { rebuilt, reports: [] };
      const reports = await runReportsGuarded(client, REPORT_GROUPS.flat(), describeFailure, DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS);
      return { rebuilt, reports };
    });
  }

  /** One read-only transaction per group; if the group itself cannot run, each of its reports is a failure. */
  private async readGroup(
    connection: DbConnection,
    kinds: ReadonlyArray<ReportKind>,
    describeFailure: (error: unknown) => string
  ): Promise<ReportData[]> {
    try {
      return await runInTransaction(this.createClient(connection), REPORT_TRANSACTION, false, (client) =>
        runReportsGuarded(client, kinds, describeFailure)
      );
    } catch (error: unknown) {
      return kinds.map((kind) => ({ kind, rows: null, error: describeFailure(error) }));
    }
  }
}
