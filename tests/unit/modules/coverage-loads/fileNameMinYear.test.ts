import { describe, expect, it, vi } from "vitest";
import { createIndicatorsHandlers } from "@/modules/coverage-loads/indicators/api/handlers";
import { buildLoadResult } from "@/modules/coverage-loads/indicators/domain/loadResult";
import { parseIndicatorsFileName } from "@/modules/coverage-loads/indicators/domain/fileName";
import type { IndicatorsRepository } from "@/modules/coverage-loads/indicators/services/IndicatorsRepository";
import { csvBytes, validDataLines } from "./csvBuilders";

const BASE_URL = "http://localhost/api/m/coverage-loads/indicators";
const CONNECTION_FIELDS = { host: "db.example", port: "5433", db_name: "carto", user: "operator", password: "pw" };
const ZERO_YEAR_FILE = "IndicadoresLTE_00000101.csv";
const GOOD_FILE = "IndicadoresLTE_20260901.csv";
const DECLARED_UPLOAD_BYTES = "2048";

function invalidNameMessage(fileName: string): string {
  return `El archivo "${fileName}" no tiene un nombre válido: debe ser IndicadoresLTE_aaaammdd.csv con una fecha real.`;
}

function makeRepository() {
  return {
    inspectHistory: vi.fn(async () => ({ existingRowsByDate: {}, shortfalls: [] })),
    loadCuts: vi.fn(async (_connection, request) => buildLoadResult(request.cuts, [])),
    readReport: vi.fn(async () => []),
  } satisfies IndicatorsRepository;
}

function uploadRequest(path: string, names: ReadonlyArray<string>, confirm = false): Request {
  const form = new FormData();
  form.append("connection", JSON.stringify(CONNECTION_FIELDS));
  for (const name of names) {
    form.append("files", new File([csvBytes(validDataLines(3)) as BlobPart], name, { type: "text/csv" }));
  }
  if (confirm) form.append("confirm", "true");
  return new Request(`${BASE_URL}/${path}`, { method: "POST", headers: { "content-length": DECLARED_UPLOAD_BYTES }, body: form });
}

describe("parseIndicatorsFileName minimum year", () => {
  it("should reject year 0000 with the invalid-name message", () => {
    // Arrange & Act
    const result = parseIndicatorsFileName(ZERO_YEAR_FILE);

    // Assert
    expect(result).toEqual({ ok: false, message: invalidNameMessage(ZERO_YEAR_FILE) });
  });

  it("should reject 31 December of year 0000", () => {
    // Arrange & Act
    const result = parseIndicatorsFileName("IndicadoresLTE_00001231.csv");

    // Assert
    expect(result).toEqual({ ok: false, message: invalidNameMessage("IndicadoresLTE_00001231.csv") });
  });

  it("should accept year 0001 as the first valid year", () => {
    // Arrange & Act
    const result = parseIndicatorsFileName("IndicadoresLTE_00010101.csv");

    // Assert
    expect(result).toEqual({ ok: true, fechaact: "0001-01-01" });
  });
});

describe("indicators handlers with a year-0 file name", () => {
  it("should answer 200 with a per-file error and still plan the valid cut", async () => {
    // Arrange
    const repository = makeRepository();
    const handlers = createIndicatorsHandlers({ repository });

    // Act
    const response = await handlers.plan(uploadRequest("plan", [ZERO_YEAR_FILE, GOOD_FILE]));
    const payload = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(payload.plan.fileErrors).toEqual([{ fileName: ZERO_YEAR_FILE, message: invalidNameMessage(ZERO_YEAR_FILE) }]);
    expect(payload.plan.cuts.map((cut: { fechaact: string }) => cut.fechaact)).toEqual(["2026-09-01"]);
    expect(payload.plan.canLoad).toBe(false);
  });

  it("should never ask the repository to inspect the invalid date", async () => {
    // Arrange
    const repository = makeRepository();
    const handlers = createIndicatorsHandlers({ repository });

    // Act
    await handlers.plan(uploadRequest("plan", [ZERO_YEAR_FILE, GOOD_FILE]));

    // Assert
    const asked = repository.inspectHistory.mock.calls.flatMap((call) => Array.from((call as unknown[])[1] as string[]));
    expect(asked).toEqual(["2026-09-01"]);
    expect(asked).not.toContain("0000-01-01");
  });

  it("should answer 200 with only the file error and no cut when the year-0 file is alone", async () => {
    // Arrange
    const repository = makeRepository();
    const handlers = createIndicatorsHandlers({ repository });

    // Act
    const response = await handlers.plan(uploadRequest("plan", [ZERO_YEAR_FILE]));
    const payload = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(payload.plan.cuts).toEqual([]);
    expect(payload.plan.fileErrors).toHaveLength(1);
    const asked = repository.inspectHistory.mock.calls.flatMap((call) => Array.from((call as unknown[])[1] as string[]));
    expect(asked).not.toContain("0000-01-01");
  });

  it("should answer 409 and write nothing when a load includes the year-0 file", async () => {
    // Arrange
    const repository = makeRepository();
    const handlers = createIndicatorsHandlers({ repository });

    // Act
    const response = await handlers.load(uploadRequest("load", [ZERO_YEAR_FILE, GOOD_FILE], true));
    const payload = await response.json();

    // Assert
    expect(response.status).toBe(409);
    expect(payload.error).toContain(`"${ZERO_YEAR_FILE}"`);
    expect(repository.loadCuts).not.toHaveBeenCalled();
  });
});
