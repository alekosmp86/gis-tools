import { STATEMENT_TIMEOUT_MS, WRITE_LOCK_TIMEOUT } from "../../constants";
import { createPgClient, type PgClientFactory } from "../../shared/pgClient";
import { runInTransaction, type TransactionSettings } from "../../shared/runInTransaction";
import type { DbConnection } from "../../types";
import type { ReportKind } from "../constants";
import { buildLoadResult } from "../domain/loadResult";
import { assertLoadable, buildPlan, type HistoryState } from "../domain/plan";
import type { LoadResult, ReportRow } from "../types";
import type { IndicatorsRepository, LoadRequest } from "./IndicatorsRepository";
import {
  findShortfalls,
  lockStaging,
  readHistoryState,
  readHistoryStateFor,
  readReport,
  writeCuts,
} from "./queries/runIndicatorsQueries";

const STATEMENT_TIMEOUT_SETTING = `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`;

const READ_ONLY_TRANSACTION: TransactionSettings = {
  begin: "BEGIN READ ONLY",
  settings: [STATEMENT_TIMEOUT_SETTING],
};

const WRITE_TRANSACTION: TransactionSettings = {
  begin: "BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE",
  settings: [`SET LOCAL lock_timeout = '${WRITE_LOCK_TIMEOUT}'`, STATEMENT_TIMEOUT_SETTING],
};

/**
 * Plan and reports run in `BEGIN READ ONLY`, so a write attempt is refused by Postgres itself.
 * The load is the one write path: one connection, one transaction, COMMIT only when every cut was
 * written; any failure rolls everything back and the previous rows stay.
 */
export class PgIndicatorsRepository implements IndicatorsRepository {
  constructor(private readonly createClient: PgClientFactory = createPgClient) {}

  inspectHistory(connection: DbConnection, fechaacts: ReadonlyArray<string>): Promise<HistoryState> {
    return runInTransaction(this.createClient(connection), READ_ONLY_TRANSACTION, false, (client) =>
      readHistoryState(client, fechaacts)
    );
  }

  loadCuts(connection: DbConnection, request: LoadRequest): Promise<LoadResult> {
    return runInTransaction(this.createClient(connection), WRITE_TRANSACTION, true, async (client) => {
      const fechaacts = request.cuts.map((cut) => cut.fechaact);
      const shortfalls = await findShortfalls(client);
      if (shortfalls.length > 0) {
        const refused = await readHistoryStateFor(client, fechaacts, shortfalls);
        assertLoadable(buildPlan(request.cuts, [], refused), request.acceptShrink);
      }
      await lockStaging(client);
      const history = await readHistoryStateFor(client, fechaacts, shortfalls);
      assertLoadable(buildPlan(request.cuts, [], history), request.acceptShrink);
      const loaded = await writeCuts(client, request.cuts, history.existingRowsByDate);
      return buildLoadResult(request.cuts, loaded);
    });
  }

  readReport(connection: DbConnection, kind: ReportKind): Promise<ReportRow[]> {
    return runInTransaction(this.createClient(connection), READ_ONLY_TRANSACTION, false, (client) =>
      readReport(client, kind)
    );
  }
}
