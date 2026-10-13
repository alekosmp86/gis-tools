import { describe, expect, it } from "vitest";
import { createIndicatorsHandlers } from "@/modules/coverage-loads/indicators/api/handlers";
import { buildLoadResult } from "@/modules/coverage-loads/indicators/domain/loadResult";
import { parseIndicatorsFile } from "@/modules/coverage-loads/indicators/domain/csvIndicators";
import type { HistoryState } from "@/modules/coverage-loads/indicators/domain/plan";
import type {
  IndicatorsRepository,
  LoadRequest,
} from "@/modules/coverage-loads/indicators/services/IndicatorsRepository";
import { ParseKind } from "@/modules/coverage-loads/indicators/types";
import type { LoadResult, ReportRow } from "@/modules/coverage-loads/indicators/types";
import type { DbConnection } from "@/modules/coverage-loads/types";
import { csvBytes, dataLine, validDataLines } from "./csvBuilders";

const FILE_NAME = "IndicadoresLTE_20260901.csv";
const MARKER = "…";
const ECHO_MAX = 50;
const MAX_REASON_LENGTH = 150;
const HUGE = 10000;

function rejectionReason(porcentaje: string, cobertura = "Si", departamento = "D", localidad = "L"): string {
  const line = dataLine(departamento, localidad, porcentaje, cobertura);
  const outcome = parseIndicatorsFile(FILE_NAME, csvBytes([...validDataLines(1), line]));
  if (outcome.kind !== ParseKind.CUT) throw new Error(`expected a cut, got: ${outcome.error.message}`);
  expect(outcome.cut.rejected).toHaveLength(1);
  return outcome.cut.rejected[0].reason;
}

describe("rejected value echo cap", () => {
  describe("huge values", () => {
    it("should cap a huge non-numeric porcentaje to 50 characters plus the marker", () => {
      // Arrange
      const value = "a".repeat(HUGE);

      // Act
      const reason = rejectionReason(value);

      // Assert
      expect(reason).toContain("a".repeat(ECHO_MAX) + MARKER);
      expect(reason).not.toContain("a".repeat(ECHO_MAX + 1));
      expect(reason.length).toBeLessThan(MAX_REASON_LENGTH);
    });

    it("should cap a huge numeric porcentaje that is out of range", () => {
      // Arrange
      const value = "9".repeat(HUGE);

      // Act
      const reason = rejectionReason(value);

      // Assert
      expect(reason).toContain("9".repeat(ECHO_MAX) + MARKER);
      expect(reason).not.toContain("9".repeat(ECHO_MAX + 1));
      expect(reason.length).toBeLessThan(MAX_REASON_LENGTH);
    });

    it("should cap a huge cobertura", () => {
      // Arrange
      const value = "X".repeat(HUGE);

      // Act
      const reason = rejectionReason("10", value);

      // Assert
      expect(reason).toContain("X".repeat(ECHO_MAX) + MARKER);
      expect(reason).not.toContain("X".repeat(ECHO_MAX + 1));
      expect(reason.length).toBeLessThan(MAX_REASON_LENGTH);
    });
  });

  describe("at the limit", () => {
    it("should echo a 50-character non-numeric porcentaje in full without the marker", () => {
      // Arrange
      const value = "a".repeat(ECHO_MAX);

      // Act
      const reason = rejectionReason(value);

      // Assert
      expect(reason).toBe(`El porcentaje "${value}" no es un número.`);
      expect(reason).not.toContain(MARKER);
    });

    it("should echo a 50-digit out-of-range porcentaje in full without the marker", () => {
      // Arrange
      const value = "9".repeat(ECHO_MAX);

      // Act
      const reason = rejectionReason(value);

      // Assert
      expect(reason).toContain(value);
      expect(reason).not.toContain(MARKER);
    });

    it("should echo a 50-character cobertura in full without the marker", () => {
      // Arrange
      const value = "X".repeat(ECHO_MAX);

      // Act
      const reason = rejectionReason("10", value);

      // Assert
      expect(reason).toBe(`La cobertura "${value}" no es SI ni NO.`);
      expect(reason).not.toContain(MARKER);
    });
  });

  describe("one over the limit", () => {
    it("should cut a 51-character non-numeric porcentaje to its first 50 plus the marker", () => {
      // Arrange
      const value = "a".repeat(ECHO_MAX) + "b";

      // Act
      const reason = rejectionReason(value);

      // Assert
      expect(reason).toBe(`El porcentaje "${"a".repeat(ECHO_MAX)}${MARKER}" no es un número.`);
      expect(reason).not.toContain("b");
    });

    it("should cut a 51-digit out-of-range porcentaje to its first 50 plus the marker", () => {
      // Arrange
      const value = "9".repeat(ECHO_MAX) + "8";

      // Act
      const reason = rejectionReason(value);

      // Assert
      expect(reason).toContain("9".repeat(ECHO_MAX) + MARKER);
      expect(reason).not.toContain("8");
    });

    it("should cut a 51-character cobertura to its first 50 plus the marker", () => {
      // Arrange
      const value = "X".repeat(ECHO_MAX) + "Y";

      // Act
      const reason = rejectionReason("10", value);

      // Assert
      expect(reason).toBe(`La cobertura "${"X".repeat(ECHO_MAX)}${MARKER}" no es SI ni NO.`);
      expect(reason).not.toContain("Y");
    });
  });

  describe("unchanged short values", () => {
    it("should render short values exactly as before", () => {
      // Arrange & Act & Assert
      expect(rejectionReason("abc")).toBe('El porcentaje "abc" no es un número.');
      expect(rejectionReason("101")).toBe("El porcentaje 101 supera el máximo de 100.");
      expect(rejectionReason("10", "Quizas")).toBe('La cobertura "Quizas" no es SI ni NO.');
    });
  });

  describe("too-long names", () => {
    it("should report only the length for a too-long departamento", () => {
      // Arrange
      const name = "DEPNAME".repeat(1000);

      // Act
      const reason = rejectionReason("10", "Si", name);

      // Assert
      expect(reason).toContain(String(name.length));
      expect(reason).not.toContain("DEPNAME");
      expect(reason).not.toContain(MARKER);
    });

    it("should report only the length for a too-long localidad", () => {
      // Arrange
      const name = "LOCNAME".repeat(1000);

      // Act
      const reason = rejectionReason("10", "Si", "D", name);

      // Assert
      expect(reason).toContain(String(name.length));
      expect(reason).not.toContain("LOCNAME");
      expect(reason).not.toContain(MARKER);
    });
  });
});

class FakeRepository implements IndicatorsRepository {
  async inspectHistory(): Promise<HistoryState> {
    return { existingRowsByDate: {}, shortfalls: [] };
  }

  async loadCuts(_connection: DbConnection, request: LoadRequest): Promise<LoadResult> {
    return buildLoadResult(request.cuts, []);
  }

  async readReport(): Promise<ReportRow[]> {
    return [];
  }
}

describe("plan response with a 5 MB porcentaje", () => {
  it("should keep the plan JSON under 20 KB, reason included", async () => {
    // Arrange
    const handlers = createIndicatorsHandlers({ repository: new FakeRepository(), now: () => new Date(2026, 9, 9, 12) });
    const hugeLine = dataLine("D", "L", "a".repeat(5 * 1024 * 1024), "Si");
    const bytes = csvBytes([...validDataLines(2), hugeLine]);
    const form = new FormData();
    form.append(
      "connection",
      JSON.stringify({ host: "db.example", port: "5433", db_name: "carto", user: "operator", password: "pw" })
    );
    form.append("files", new File([bytes as BlobPart], FILE_NAME, { type: "text/csv" }));
    const request = new Request("http://localhost/api/m/coverage-loads/indicators/plan", { method: "POST", body: form });

    // Act
    const response = await handlers.plan(request);
    const text = await response.text();
    const payload = JSON.parse(text);

    // Assert
    expect(response.status).toBe(200);
    expect(payload.plan.cuts[0].rejectedRows).toHaveLength(1);
    expect(payload.plan.cuts[0].rejectedRows[0].reason).toContain("a".repeat(ECHO_MAX) + MARKER);
    expect(text.length).toBeLessThan(20 * 1024);
  });
});
