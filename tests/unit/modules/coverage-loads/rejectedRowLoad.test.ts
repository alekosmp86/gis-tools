import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createIndicatorsHandlers } from "@/modules/coverage-loads/indicators/api/handlers";
import { parseIndicatorsFile } from "@/modules/coverage-loads/indicators/domain/csvIndicators";
import { buildLoadResult } from "@/modules/coverage-loads/indicators/domain/loadResult";
import { PgIndicatorsRepository } from "@/modules/coverage-loads/indicators/services/PgIndicatorsRepository";
import type { IndicatorsRepository, LoadRequest } from "@/modules/coverage-loads/indicators/services/IndicatorsRepository";
import { ParseKind } from "@/modules/coverage-loads/indicators/types";
import type { DbConnection } from "@/modules/coverage-loads/types";
import { csvBytes, dataLine, validDataLines } from "./csvBuilders";
import {
  createCoverageDatabase,
  readHistory,
  readStaging,
  RecordingPgliteClient,
  resetCoverageDatabase,
} from "./pgliteHarness";

const BASE_URL = "http://localhost/api/m/coverage-loads/indicators";
const CONNECTION_FIELDS = { host: "db.example", port: "5433", db_name: "carto", user: "operator", password: "pw" };
const CONNECTION: DbConnection = { host: "db.example", port: 5432, db_name: "carto", user: "operator", password: "pw" };
const FILE_NAME = "IndicadoresLTE_20260901.csv";
const NUL = "\u0000";
const NUL_REASON = "contiene un carácter nulo (NUL).";

function makeRepository() {
  return {
    inspectHistory: vi.fn(async () => ({ existingRowsByDate: {}, shortfalls: [] })),
    loadCuts: vi.fn(async (_connection, request) => buildLoadResult(request.cuts, [])),
    readReport: vi.fn(async () => []),
  } satisfies IndicatorsRepository;
}

function hugeRejectedFile(rejectedRows: number, rowLength: number): Uint8Array {
  const bad = Array.from({ length: rejectedRows }, (_, index) => `D${index};L;abc;${"x".repeat(rowLength)}`);
  return csvBytes([...validDataLines(3), ...bad]);
}

function uploadRequest(path: string, bytes: Uint8Array, confirm = false): Request {
  const form = new FormData();
  form.append("connection", JSON.stringify(CONNECTION_FIELDS));
  form.append("files", new File([bytes as BlobPart], FILE_NAME, { type: "text/csv" }));
  if (confirm) form.append("confirm", "true");
  return new Request(`${BASE_URL}/${path}`, { method: "POST", body: form });
}

describe("response size with huge rejected rows", () => {
  const ROWS = 10;
  const ROW_LENGTH = 300_000;
  const SIZE_BOUND = 20_000;

  it("should keep the plan response JSON bounded", async () => {
    // Arrange
    const handlers = createIndicatorsHandlers({ repository: makeRepository() });

    // Act
    const response = await handlers.plan(uploadRequest("plan", hugeRejectedFile(ROWS, ROW_LENGTH)));
    const raw = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(raw.length).toBeLessThan(SIZE_BOUND);
    const { rejectedRows } = JSON.parse(raw).plan.cuts[0];
    expect(rejectedRows).toHaveLength(ROWS);
    for (const row of rejectedRows) expect(row.text).toHaveLength(501);
  });

  it("should keep the load response JSON bounded", async () => {
    // Arrange
    const repository = makeRepository();
    repository.loadCuts.mockImplementation(async (_connection, request: LoadRequest) => {
      const rejected = request.cuts.flatMap((cut) => cut.rejected);
      return { ...buildLoadResult(request.cuts, []), rejectedRows: rejected };
    });
    const handlers = createIndicatorsHandlers({ repository });

    // Act
    const response = await handlers.load(uploadRequest("load", hugeRejectedFile(ROWS, ROW_LENGTH), true));
    const raw = await response.text();

    // Assert
    expect(response.status).toBe(200);
    expect(raw.length).toBeLessThan(SIZE_BOUND);
    expect(JSON.parse(raw).result.rejectedRows).toHaveLength(ROWS);
  });
});

describe("a file with a NUL row loads against PGlite", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await createCoverageDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await resetCoverageDatabase(database);
  });

  it("should load the valid rows without error and never send the NUL to the INSERT", async () => {
    // Arrange
    const nulLine = `DEP;LOC${NUL}X;10;Si`;
    const outcome = parseIndicatorsFile(FILE_NAME, csvBytes([...validDataLines(4), nulLine, dataLine("UNO", "DOS", "3", "No")]));
    if (outcome.kind !== ParseKind.CUT) throw new Error(outcome.error.message);
    const clients: RecordingPgliteClient[] = [];
    const repository = new PgIndicatorsRepository(() => {
      const client = new RecordingPgliteClient(database);
      clients.push(client);
      return client;
    });

    // Act
    const result = await repository.loadCuts(CONNECTION, { cuts: [outcome.cut], acceptShrink: false });

    // Assert
    expect(outcome.cut.rejected.map((row) => row.reason)).toEqual([NUL_REASON]);
    expect(result.totalInserted).toBe(5);
    expect(await readHistory(database, "2026-09-01")).toHaveLength(5);
    expect(await readStaging(database)).toHaveLength(5);
    for (const client of clients) {
      for (const call of client.calls) {
        expect(call.text).not.toContain(NUL);
        expect(JSON.stringify(call.values)).not.toContain("\\u0000");
      }
    }
  });
});
