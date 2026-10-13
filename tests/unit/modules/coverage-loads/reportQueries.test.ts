import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ReportKind } from "@/modules/coverage-loads/indicators/constants";
import { buildReportCsv } from "@/modules/coverage-loads/indicators/domain/reportCsv";
import { readReport } from "@/modules/coverage-loads/indicators/services/queries/runIndicatorsQueries";
import { mapExistingRow, mapReportRow } from "@/modules/coverage-loads/indicators/services/queries/mapRows";
import { isoDateFromNow, toDdMmYyyy } from "./csvBuilders";
import { createCoverageDatabase, resetCoverageDatabase, seedHistory, type HistorySeed } from "./pgliteHarness";

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

function seed(fechaact: string, departamento: string, localidad: string, porcentaje: string, cobertura = "SI"): HistorySeed {
  return { departamento, localidad, porcentaje, cobertura, fechaact };
}

function names(rows: ReadonlyArray<{ departamento: string; localidad: string }>): string[] {
  return rows.map((row) => `${row.departamento}|${row.localidad}`);
}

async function csvText(kind: ReportKind): Promise<string> {
  return Buffer.from(buildReportCsv(kind, await readReport(database, kind))).toString("latin1");
}

describe("report queries on PGlite", () => {
  describe("localidad (AC-16, AC-18, AC-19)", () => {
    it("should return only the rows of the latest cut, ordered by departamento and localidad", async () => {
      // Arrange
      await seedHistory(database, [
        seed("2026-08-01", "ARTIGAS", "VIEJA", "10"),
        seed("2026-09-01", "SALTO", "BETA", "80.5"),
        seed("2026-09-01", "ARTIGAS", "ZETA", "91.30"),
        seed("2026-09-01", "ARTIGAS", "ALFA", "100"),
      ]);

      // Act
      const rows = await readReport(database, ReportKind.LOCALIDAD);

      // Assert
      expect(names(rows)).toEqual(["ARTIGAS|ALFA", "ARTIGAS|ZETA", "SALTO|BETA"]);
    });

    it("should give the percentage with two decimals and the date as dd-MM-yyyy text", async () => {
      // Arrange
      await seedHistory(database, [seed("2026-09-01", "A", "UNO", "91.3"), seed("2026-09-01", "A", "DOS", "0")]);

      // Act
      const rows = await readReport(database, ReportKind.LOCALIDAD);

      // Assert
      expect(rows).toEqual([
        { departamento: "A", localidad: "DOS", porcentajecobertura: "0.00", fecha_novedad: "01-09-2026" },
        { departamento: "A", localidad: "UNO", porcentajecobertura: "91.30", fecha_novedad: "01-09-2026" },
      ]);
      expect(typeof rows[0].fecha_novedad).toBe("string");
    });

    it("should print 31 December as 31-12-2026 and pick the latest date over an earlier one", async () => {
      // Arrange: 31 December must not drift a day through a timezone
      await seedHistory(database, [seed("2026-12-31", "A", "UNO", "50"), seed("2026-01-01", "A", "DOS", "50")]);

      // Act
      const rows = await readReport(database, ReportKind.LOCALIDAD);

      // Assert
      expect(rows.map((row) => row.fecha_novedad)).toEqual(["31-12-2026"]);
    });

    it("should return no rows for an empty history", async () => {
      // Arrange, Act & Assert
      expect(await readReport(database, ReportKind.LOCALIDAD)).toEqual([]);
    });

    it("should render CSV text with the header and trimmed percentages", async () => {
      // Arrange
      await seedHistory(database, [seed("2026-09-01", "ARTIGAS", "ARTIGAS", "91.3"), seed("2026-09-01", "ARTIGAS", "ZED", "100")]);

      // Act
      const text = await csvText(ReportKind.LOCALIDAD);

      // Assert
      expect(text).toBe(
        "departamento;localidad;porcentajecobertura;fecha_novedad\nARTIGAS;ARTIGAS;91.3;01-09-2026\nARTIGAS;ZED;100;01-09-2026\n"
      );
    });
  });

  describe("mayor50 (AC-16, AC-18)", () => {
    it("should keep only SI localities above 49.99 in the latest cut", async () => {
      // Arrange
      await seedHistory(database, [
        seed("2026-08-01", "A", "VIEJA", "90"),
        seed("2026-09-01", "A", "SOBRE", "50"),
        seed("2026-09-01", "A", "JUSTO", "50.00"),
        seed("2026-09-01", "A", "BAJO", "49.99"),
        seed("2026-09-01", "A", "NO", "90", "NO"),
        seed("2026-09-01", "A", "ALTO", "100"),
      ]);

      // Act
      const rows = await readReport(database, ReportKind.MAYOR50);

      // Assert
      expect(names(rows)).toEqual(["A|ALTO", "A|JUSTO", "A|SOBRE"]);
    });

    it("should compare after rounding to two decimals", async () => {
      // Arrange: 49.996 rounds to 50.00 and passes, 49.994 rounds to 49.99 and does not
      await seedHistory(database, [seed("2026-09-01", "A", "REDONDEA", "49.996"), seed("2026-09-01", "A", "CAE", "49.994")]);

      // Act
      const rows = await readReport(database, ReportKind.MAYOR50);

      // Assert
      expect(names(rows)).toEqual(["A|REDONDEA"]);
    });

    it("should render the three-column CSV and an empty one when nothing qualifies", async () => {
      // Arrange
      await seedHistory(database, [seed("2026-09-01", "A", "BAJA", "10")]);

      // Act & Assert
      expect(await csvText(ReportKind.MAYOR50)).toBe("");
      await seedHistory(database, [seed("2026-09-01", "A", "ALTA", "75")]);
      expect(await csvText(ReportKind.MAYOR50)).toBe("departamento;localidad;fecha_novedad\nA;ALTA;01-09-2026\n");
    });
  });

  describe("novedad (AC-16, AC-20, AC-33)", () => {
    const RECENT = isoDateFromNow(-10);
    const OLDER_RECENT = isoDateFromNow(-30);
    const BEFORE_WINDOW = isoDateFromNow(-200);

    it("should list a locality that reaches 50 for the first time and one that never existed before", async () => {
      // Arrange
      await seedHistory(database, [
        seed(BEFORE_WINDOW, "A", "YA ESTABA", "80"),
        seed(BEFORE_WINDOW, "B", "SUBE", "30"),
        seed(RECENT, "A", "YA ESTABA", "85"),
        seed(RECENT, "B", "SUBE", "70"),
        seed(RECENT, "C", "NUEVA", "55"),
      ]);

      // Act
      const rows = await readReport(database, ReportKind.NOVEDAD);

      // Assert
      expect(names(rows)).toEqual(["B|SUBE", "C|NUEVA"]);
      expect(rows.map((row) => row.fecha_novedad)).toEqual([toDdMmYyyy(RECENT), toDdMmYyyy(RECENT)]);
    });

    it("should return nothing when no locality is new", async () => {
      // Arrange
      await seedHistory(database, [
        seed(BEFORE_WINDOW, "A", "UNO", "80"),
        seed(BEFORE_WINDOW, "A", "DOS", "60"),
        seed(RECENT, "A", "UNO", "81"),
        seed(RECENT, "A", "DOS", "61"),
      ]);

      // Act
      const rows = await readReport(database, ReportKind.NOVEDAD);

      // Assert
      expect(rows).toEqual([]);
      expect(buildReportCsv(ReportKind.NOVEDAD, rows)).toHaveLength(0);
    });

    it("should return nothing when the only cut is older than three months", async () => {
      // Arrange
      await seedHistory(database, [seed(BEFORE_WINDOW, "A", "UNO", "80")]);

      // Act & Assert
      expect(await readReport(database, ReportKind.NOVEDAD)).toEqual([]);
    });

    it("should include a recent locality at exactly 50 and exclude one at 49.99", async () => {
      // Arrange
      await seedHistory(database, [seed(RECENT, "A", "EXACTA", "50"), seed(RECENT, "A", "CASI", "49.99")]);

      // Act
      const rows = await readReport(database, ReportKind.NOVEDAD);

      // Assert
      expect(names(rows)).toEqual(["A|EXACTA"]);
    });

    it("should exclude localities whose Cobertura is NO", async () => {
      // Arrange
      await seedHistory(database, [seed(RECENT, "A", "SIN SERVICIO", "90", "NO"), seed(RECENT, "A", "CON SERVICIO", "90")]);

      // Act
      const rows = await readReport(database, ReportKind.NOVEDAD);

      // Assert
      expect(names(rows)).toEqual(["A|CON SERVICIO"]);
    });

    it("should not treat a locality as known when it was above 50 only inside the three-month window", async () => {
      // Arrange
      await seedHistory(database, [seed(OLDER_RECENT, "A", "UNO", "80"), seed(RECENT, "A", "UNO", "82")]);

      // Act
      const rows = await readReport(database, ReportKind.NOVEDAD);

      // Assert: one row per locality, dated by one of the two recent cuts
      expect(names(rows)).toEqual(["A|UNO"]);
      expect([toDdMmYyyy(OLDER_RECENT), toDdMmYyyy(RECENT)]).toContain(rows[0].fecha_novedad);
    });

    it("should treat a locality above 50 before the window as known even if that row said NO (legacy SQL)", async () => {
      // Arrange
      await seedHistory(database, [seed(BEFORE_WINDOW, "A", "UNO", "80", "NO"), seed(RECENT, "A", "UNO", "82")]);

      // Act & Assert
      expect(await readReport(database, ReportKind.NOVEDAD)).toEqual([]);
    });

    it("should treat a locality below 50 before the window as new once it reaches 50", async () => {
      // Arrange
      await seedHistory(database, [seed(BEFORE_WINDOW, "A", "UNO", "49.99"), seed(RECENT, "A", "UNO", "50")]);

      // Act
      const rows = await readReport(database, ReportKind.NOVEDAD);

      // Assert
      expect(names(rows)).toEqual(["A|UNO"]);
    });

    it("should not confuse localities whose departamento and localidad concatenate alike", async () => {
      // Arrange
      await seedHistory(database, [seed(BEFORE_WINDOW, "AB", "C", "80"), seed(RECENT, "AB", "C", "80"), seed(RECENT, "A", "BC", "80")]);

      // Act
      const rows = await readReport(database, ReportKind.NOVEDAD);

      // Assert
      expect(names(rows)).toEqual(["A|BC"]);
    });

    it("should render the three-column CSV with the cut date", async () => {
      // Arrange
      await seedHistory(database, [seed(RECENT, "C", "NUEVA", "55")]);

      // Act
      const text = await csvText(ReportKind.NOVEDAD);

      // Assert
      expect(text).toBe(`departamento;localidad;fecha_novedad\nC;NUEVA;${toDdMmYyyy(RECENT)}\n`);
    });
  });
});

describe("mapRows", () => {
  it("should turn null, undefined and numbers into text and keep missing report columns empty", () => {
    // Arrange & Act
    const row = mapReportRow({ departamento: null, localidad: "X", porcentajecobertura: 12.5 });

    // Assert
    expect(row).toEqual({ departamento: "", localidad: "X", porcentajecobertura: "12.5", fecha_novedad: "" });
  });

  it("should read the existing-rows count as a number and the date as text", () => {
    // Arrange & Act & Assert
    expect(mapExistingRow({ fechaact: "2026-09-01", total: "615" })).toEqual({ fechaact: "2026-09-01", total: 615 });
    expect(mapExistingRow({ total: 1 })).toEqual({ fechaact: "", total: 1 });
  });
});
