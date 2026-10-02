import { describe, expect, it } from "vitest";
import { STATEMENT_TIMEOUT_MS } from "@/modules/address-dedup/constants";
import { PgAddressRepository, type PgClientLike } from "@/modules/address-dedup/services/PgAddressRepository";
import { DUPLICATE_ANALYSIS_SQL } from "@/modules/address-dedup/services/queries/duplicateAnalysisQuery";
import type { DbConnection, RepositoryRequest } from "@/modules/address-dedup/types";
import { DEFAULT_PARAMETERS } from "./pgliteHarness";

const CONNECTION: DbConnection = {
  host: "db.example",
  port: 5432,
  db_name: "carto",
  user: "reader",
  password: "s3cret-password",
};

const REQUEST: RepositoryRequest = {
  connection: CONNECTION,
  parameters: { ...DEFAULT_PARAMETERS, provinceId: 4242 },
};

const WRITE_STATEMENT = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|COMMIT)\b/i;

interface RecordedQuery {
  readonly text: string;
  readonly values: unknown[];
}

class FakeClient implements PgClientLike {
  public readonly queries: RecordedQuery[] = [];
  public endCount = 0;
  public connectCount = 0;
  public readonly errorListeners: Array<(error: Error) => void> = [];
  public listenerCountAtConnect = -1;
  public emitErrorDuringQuery: string | null = null;

  constructor(
    private readonly options: { failOnQuery?: string; failOnConnect?: boolean } = {}
  ) {}

  async connect(): Promise<void> {
    this.connectCount += 1;
    this.listenerCountAtConnect = this.errorListeners.length;
    if (this.options.failOnConnect) throw new Error("connect failed");
  }

  async query(text: string, values: unknown[]): Promise<{ rows: ReadonlyArray<unknown> }> {
    this.queries.push({ text, values });
    if (this.emitErrorDuringQuery && text === this.emitErrorDuringQuery) {
      this.emitError(new Error("terminating connection"));
      throw new Error("terminating connection");
    }
    if (this.options.failOnQuery && text === this.options.failOnQuery) {
      throw new Error("query failed");
    }
    return { rows: [] };
  }

  on(_event: "error", listener: (error: Error) => void): void {
    this.errorListeners.push(listener);
  }

  /** Mirrors EventEmitter: an 'error' emitted with no listener throws. */
  emitError(error: Error): void {
    if (this.errorListeners.length === 0) throw error;
    for (const listener of this.errorListeners) listener(error);
  }

  async end(): Promise<void> {
    this.endCount += 1;
  }
}

function repositoryWith(client: FakeClient): { repository: PgAddressRepository; factoryCalls: DbConnection[] } {
  const factoryCalls: DbConnection[] = [];
  const repository = new PgAddressRepository((connection) => {
    factoryCalls.push(connection);
    return client;
  });
  return { repository, factoryCalls };
}

describe("PgAddressRepository", () => {
  it("should open a read-only transaction first and roll back last on success", async () => {
    // Arrange
    const client = new FakeClient();
    const { repository } = repositoryWith(client);

    // Act
    await repository.runDuplicateAnalysis(REQUEST);

    // Assert
    const texts = client.queries.map((query) => query.text);
    expect(texts[0]).toBe("BEGIN READ ONLY");
    expect(texts[texts.length - 1]).toBe("ROLLBACK");
    expect(client.endCount).toBe(1);
  });

  it("should set the statement timeout inside the transaction before the analysis query", async () => {
    // Arrange
    const client = new FakeClient();
    const { repository } = repositoryWith(client);

    // Act
    await repository.runDuplicateAnalysis(REQUEST);

    // Assert
    const texts = client.queries.map((query) => query.text);
    expect(texts[1]).toBe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    expect(texts[2]).toBe(DUPLICATE_ANALYSIS_SQL);
  });

  it("should bind the request values and never interpolate them into the query text", async () => {
    // Arrange
    const client = new FakeClient();
    const { repository } = repositoryWith(client);

    // Act
    await repository.runDuplicateAnalysis(REQUEST);

    // Assert
    const analysisQuery = client.queries[2];
    expect(analysisQuery.values).toHaveLength(8);
    expect(analysisQuery.values[1]).toBe(4242);
    for (const query of client.queries) {
      expect(query.text).not.toContain("4242");
      expect(query.text).not.toContain(CONNECTION.password);
    }
  });

  it("should issue no write statement, only the read-only transaction control and the analysis", async () => {
    // Arrange
    const client = new FakeClient();
    const { repository } = repositoryWith(client);

    // Act
    await repository.runDuplicateAnalysis(REQUEST);

    // Assert
    for (const query of client.queries) {
      expect(query.text.replace(/'[^']*'/g, "")).not.toMatch(WRITE_STATEMENT);
    }
    expect(client.queries).toHaveLength(4);
  });

  it("should roll back and close the connection when the analysis query fails", async () => {
    // Arrange
    const client = new FakeClient({ failOnQuery: DUPLICATE_ANALYSIS_SQL });
    const { repository } = repositoryWith(client);

    // Act & Assert
    await expect(repository.runDuplicateAnalysis(REQUEST)).rejects.toThrow("query failed");
    expect(client.queries[client.queries.length - 1].text).toBe("ROLLBACK");
    expect(client.endCount).toBe(1);
  });

  it("should close the connection without a rollback when connecting fails", async () => {
    // Arrange
    const client = new FakeClient({ failOnConnect: true });
    const { repository } = repositoryWith(client);

    // Act & Assert
    await expect(repository.runDuplicateAnalysis(REQUEST)).rejects.toThrow("connect failed");
    expect(client.queries).toEqual([]);
    expect(client.endCount).toBe(1);
  });

  it("should use one connection per call, built from the request connection", async () => {
    // Arrange
    const client = new FakeClient();
    const { repository, factoryCalls } = repositoryWith(client);

    // Act
    await repository.runDuplicateAnalysis(REQUEST);
    await repository.runDuplicateAnalysis(REQUEST);

    // Assert
    expect(factoryCalls).toEqual([CONNECTION, CONNECTION]);
    expect(client.connectCount).toBe(2);
    expect(client.endCount).toBe(2);
  });

  it("should register an error listener before connecting", async () => {
    // Arrange
    const client = new FakeClient();
    const { repository } = repositoryWith(client);

    // Act
    await repository.runDuplicateAnalysis(REQUEST);

    // Assert
    expect(client.listenerCountAtConnect).toBe(1);
  });

  it("should reject with the query failure, not throw an uncaught error, when the client emits error mid-query", async () => {
    // Arrange
    const client = new FakeClient();
    client.emitErrorDuringQuery = DUPLICATE_ANALYSIS_SQL;
    const { repository } = repositoryWith(client);

    // Act & Assert
    await expect(repository.runDuplicateAnalysis(REQUEST)).rejects.toThrow("terminating connection");
    expect(client.endCount).toBe(1);
  });
});
