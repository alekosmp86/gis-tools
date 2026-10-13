import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ReportKind } from "@/modules/coverage-loads/indicators/constants";
import { parseIndicatorsFile } from "@/modules/coverage-loads/indicators/domain/csvIndicators";
import { buildReportCsv } from "@/modules/coverage-loads/indicators/domain/reportCsv";
import { PgIndicatorsRepository } from "@/modules/coverage-loads/indicators/services/PgIndicatorsRepository";
import { ParseKind } from "@/modules/coverage-loads/indicators/types";
import type { ParsedCut } from "@/modules/coverage-loads/indicators/types";
import type { DbConnection } from "@/modules/coverage-loads/types";
import { fixtureBytes } from "./csvBuilders";
import { createCoverageDatabase, RecordingPgliteClient } from "./pgliteHarness";

const CONNECTION: DbConnection = { host: "h", port: 5432, db_name: "d", user: "u", password: "p" };

const GOLDEN_INPUT = "IndicadoresLTE_20260901.csv";
const GOLDEN_REPORTS: Readonly<Record<ReportKind, string>> = {
  [ReportKind.LOCALIDAD]: "reporte_cobertura_lte_localidad__20261009.csv",
  [ReportKind.MAYOR50]: "reporte_cobertura_lte_localidad_mayor50__20261009.csv",
  [ReportKind.NOVEDAD]: "reporte_cobertura_lte_localidad_novedad__20261009.csv",
};

/** Cuts older than three months relative to any plausible test clock (the golden cut itself is 2026-09-01). */
const EARLIER_CUT_DATES = ["2026-05-01", "2026-06-01"] as const;

let database: PGlite;
let goldenCut: ParsedCut;
let generated: Record<ReportKind, Uint8Array>;

function asLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function splitLines(text: string): string[] {
  return text.split("\n").slice(0, -1);
}

beforeAll(async () => {
  const outcome = parseIndicatorsFile(GOLDEN_INPUT, fixtureBytes(GOLDEN_INPUT));
  if (outcome.kind !== ParseKind.CUT) throw new Error(outcome.error.message);
  goldenCut = outcome.cut;

  database = await createCoverageDatabase();
  const repository = new PgIndicatorsRepository(() => new RecordingPgliteClient(database));

  const earlierCuts = EARLIER_CUT_DATES.map((fechaact) => ({
    ...goldenCut,
    fileName: `IndicadoresLTE_${fechaact.replace(/-/g, "")}.csv`,
    fechaact,
  }));
  await repository.loadCuts(CONNECTION, { cuts: earlierCuts, acceptShrink: false });
  await repository.loadCuts(CONNECTION, { cuts: [goldenCut], acceptShrink: false });

  generated = {
    [ReportKind.LOCALIDAD]: buildReportCsv(ReportKind.LOCALIDAD, await repository.readReport(CONNECTION, ReportKind.LOCALIDAD)),
    [ReportKind.MAYOR50]: buildReportCsv(ReportKind.MAYOR50, await repository.readReport(CONNECTION, ReportKind.MAYOR50)),
    [ReportKind.NOVEDAD]: buildReportCsv(ReportKind.NOVEDAD, await repository.readReport(CONNECTION, ReportKind.NOVEDAD)),
  };
});

afterAll(async () => {
  await database.close();
});

describe("golden parity (AC-32)", () => {
  describe("the real IndicadoresLTE_20260901.csv", () => {
    it("should parse into 615 valid rows with nothing rejected", () => {
      // Arrange & Act (done in beforeAll)
      // Assert
      expect(goldenCut.fechaact).toBe("2026-09-01");
      expect(goldenCut.rows).toHaveLength(615);
      expect(goldenCut.rejected).toEqual([]);
    });

    it("should round-trip its accented names through ISO-8859-1", () => {
      // Arrange
      const accented = goldenCut.rows.filter((row) => /[^\x00-\x7f]/.test(`${row.departamento}${row.localidad}`));

      // Assert
      expect(accented.length).toBeGreaterThan(0);
      expect(accented.every((row) => !row.localidad.includes("�"))).toBe(true);
    });
  });

  describe.each([ReportKind.LOCALIDAD, ReportKind.MAYOR50])("%s report", (kind) => {
    // PGlite sorts with the C collation, while the golden files were written by a real database whose
    // collation ignores spaces ("LAGOMAR" before "LA LUCHA"). Row order may therefore differ, so the
    // header and the line count are compared exactly and the lines as a sorted multiset; every line
    // is still compared byte for byte (ISO-8859-1, LF, quoting, date and number format).
    it("should have the same header line and line count as the golden file", () => {
      // Arrange
      const golden = splitLines(asLatin1(fixtureBytes(GOLDEN_REPORTS[kind])));
      const actual = splitLines(asLatin1(generated[kind]));

      // Assert
      expect(actual[0]).toBe(golden[0]);
      expect(actual).toHaveLength(golden.length);
    });

    it("should contain exactly the golden lines, byte for byte, in any order", () => {
      // Arrange
      const golden = splitLines(asLatin1(fixtureBytes(GOLDEN_REPORTS[kind])));
      const actual = splitLines(asLatin1(generated[kind]));

      // Act
      const actualBody = actual.slice(1).sort();
      const goldenBody = golden.slice(1).sort();

      // Assert
      expect(actualBody).toEqual(goldenBody);
    });

    it("should match the golden size, use LF only and end with a line feed", () => {
      // Arrange
      const golden = fixtureBytes(GOLDEN_REPORTS[kind]);
      const actual = generated[kind];

      // Assert
      expect(actual.byteLength).toBe(golden.byteLength);
      expect(actual).not.toContain(0x0d);
      expect(actual.at(-1)).toBe(0x0a);
    });

    it("should carry the accented bytes as single ISO-8859-1 bytes like the golden file", () => {
      // Arrange
      const highBytes = (bytes: Uint8Array) => bytes.filter((value) => value >= 0x80);

      // Act
      const actualHigh = Array.from(highBytes(generated[kind])).sort();
      const goldenHigh = Array.from(highBytes(fixtureBytes(GOLDEN_REPORTS[kind]))).sort();

      // Assert
      expect(actualHigh.length).toBeGreaterThan(0);
      expect(actualHigh).toEqual(goldenHigh);
    });
  });

  it("should print fecha_novedad as 01-09-2026 on every golden line", () => {
    // Arrange
    const lines = splitLines(asLatin1(generated[ReportKind.LOCALIDAD])).slice(1);

    // Assert
    expect(lines.every((line) => line.endsWith(";01-09-2026"))).toBe(true);
  });

  it("should write the localidad percentages the way the golden file does (91.3, 99.9, 100, 0)", () => {
    // Arrange
    const golden = asLatin1(fixtureBytes(GOLDEN_REPORTS[ReportKind.LOCALIDAD]));
    const actual = asLatin1(generated[ReportKind.LOCALIDAD]);

    // Assert
    expect(golden).toContain(";91.3;");
    expect(actual).toContain(";91.3;");
    expect(actual).not.toMatch(/;\d+\.\d*0;/);
  });

  it("should reproduce the novedad report byte for byte: a 0-byte file with no header", () => {
    // Arrange
    const golden = fixtureBytes(GOLDEN_REPORTS[ReportKind.NOVEDAD]);

    // Assert
    expect(golden.byteLength).toBe(0);
    expect(Array.from(generated[ReportKind.NOVEDAD])).toEqual(Array.from(golden));
  });
});
