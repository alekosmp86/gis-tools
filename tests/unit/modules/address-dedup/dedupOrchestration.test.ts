import { describe, expect, it } from "vitest";
import { Decision, DecisionReason, DedupScope, Fuente } from "@/modules/address-dedup/constants";
import { DedupOrchestrator } from "@/modules/address-dedup/services/DedupOrchestrator";
import type { AddressRepository } from "@/modules/address-dedup/services/AddressRepository";
import { toQueryValues } from "@/modules/address-dedup/services/queries/duplicateAnalysisQuery";
import type { AnalysisRow, DbConnection, RepositoryRequest } from "@/modules/address-dedup/types";
import { makeRow } from "./rowFactory";

const CONNECTION: DbConnection = {
  host: "db.example",
  port: 5432,
  db_name: "carto",
  user: "reader",
  password: "s3cret",
};

class FakeRepository implements AddressRepository {
  public readonly received: RepositoryRequest[] = [];

  constructor(private readonly rows: AnalysisRow[] = [], private readonly failure?: Error) {}

  async runDuplicateAnalysis(request: RepositoryRequest): Promise<AnalysisRow[]> {
    this.received.push(request);
    if (this.failure) throw this.failure;
    return this.rows;
  }
}

describe("DedupOrchestrator", () => {
  it("should map a minimal request to the eight query parameters in order, with defaults", async () => {
    // Arrange
    const repository = new FakeRepository();
    const orchestrator = new DedupOrchestrator(repository);

    // Act
    await orchestrator.analyze({ connection: CONNECTION, provinceId: 7 });

    // Assert
    expect(repository.received[0].connection).toEqual(CONNECTION);
    expect(toQueryValues(repository.received[0].parameters)).toEqual([
      [Fuente.ANTEL, Fuente.TLK, Fuente.IDE],
      7,
      [Fuente.ANTEL, Fuente.TLK],
      [Fuente.IDE],
      2,
      3,
      false,
      DedupScope.REMOVAL_GROUPS,
    ]);
  });

  it("should pass the request overrides for province, toggle and scope", async () => {
    // Arrange
    const repository = new FakeRepository();
    const orchestrator = new DedupOrchestrator(repository);

    // Act
    await orchestrator.analyze({
      connection: CONNECTION,
      provinceId: 3,
      protectedSiblingRemovesLone: true,
      scope: DedupScope.ALL_DUPLICATE_GROUPS,
    });

    // Assert
    const values = toQueryValues(repository.received[0].parameters);
    expect(values[1]).toBe(3);
    expect(values[6]).toBe(true);
    expect(values[7]).toBe(DedupScope.ALL_DUPLICATE_GROUPS);
  });

  it("should return the repository rows with a matching summary", async () => {
    // Arrange
    const rows = [
      makeRow({ group_id: 1, fuente: Fuente.ANTEL, decision: Decision.KEEP, decision_reason: DecisionReason.LOWEST_URN_KEPT }),
      makeRow({ group_id: 1, fuente: Fuente.ANTEL, decision: Decision.REMOVE, decision_reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN }),
    ];
    const orchestrator = new DedupOrchestrator(new FakeRepository(rows));

    // Act
    const result = await orchestrator.analyze({ connection: CONNECTION, provinceId: 7 });

    // Assert
    expect(result.rows).toBe(rows);
    expect(result.summary.groupCount).toBe(1);
    expect(result.summary.byDecisionAndFuente[Decision.REMOVE][Fuente.ANTEL]).toBe(1);
  });

  it("should return an empty result when the repository finds nothing", async () => {
    // Arrange
    const orchestrator = new DedupOrchestrator(new FakeRepository());

    // Act
    const result = await orchestrator.analyze({ connection: CONNECTION, provinceId: 7 });

    // Assert
    expect(result.rows).toEqual([]);
    expect(result.summary.rowCount).toBe(0);
  });

  it("should propagate a repository failure", async () => {
    // Arrange
    const orchestrator = new DedupOrchestrator(new FakeRepository([], new Error("connection refused")));

    // Act & Assert
    await expect(orchestrator.analyze({ connection: CONNECTION, provinceId: 7 })).rejects.toThrow(
      "connection refused"
    );
  });
});
