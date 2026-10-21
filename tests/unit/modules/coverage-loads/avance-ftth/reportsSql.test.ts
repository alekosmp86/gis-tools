import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  AvanceFileKind,
  ELIMINATED_STATUS,
  EXCLUDED_DISTRICT_STATUSES,
  EXCLUDED_ZONE_NAMES,
  REPORT_COLUMNS,
  REPORT_KINDS,
  ReportKind,
} from "@/modules/coverage-loads/avance-ftth/constants";
import { buildReportText } from "@/modules/coverage-loads/avance-ftth/domain/reportFiles";
import { REPORT_QUERIES } from "@/modules/coverage-loads/avance-ftth/services/queries/reportQueries";
import { runReportsGuarded } from "@/modules/coverage-loads/avance-ftth/services/queries/runReportQueries";
import { RecordingPgliteClient } from "../pgliteHarness";
import {
  EDIF_ONE,
  EDIF_TWO,
  STANDARD_ZONES,
  createAvanceDatabase,
  resetAvanceDatabase,
  seedAvance,
  seedHistoryRows,
  seedPlanillaRows,
  seedZones,
} from "./avanceHarness";

let database: PGlite;

beforeAll(async () => {
  database = await createAvanceDatabase();
}, 60000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetAvanceDatabase(database);
});

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

async function runReport(kind: ReportKind): Promise<ReadonlyArray<ReadonlyArray<string>>> {
  const client = new RecordingPgliteClient(database);
  await client.query("BEGIN READ ONLY", []);
  const [report] = await runReportsGuarded(client, [kind], (error) => (error instanceof Error ? error.message : "?"));
  await client.query("ROLLBACK", []);
  if (report.rows === null) throw new Error(`report ${kind} failed: ${report.error}`);
  return report.rows;
}

const column = (kind: ReportKind, name: string): number => REPORT_COLUMNS[kind].findIndex((entry) => entry.name === name);

describe("avance-ftth report SQL (AC-21, AC-22)", () => {
  describe("every report on empty tables", () => {
    it.each(REPORT_KINDS)("should run %s without error and return no rows", async (kind) => {
      // Arrange & Act
      const rows = await runReport(kind);

      // Assert
      expect(rows).toEqual([]);
      expect(Buffer.from(buildReportText(kind, rows)).toString("latin1")).toBe(`${REPORT_COLUMNS[kind].map((entry) => entry.name).join(";")}\n`);
    });
  });

  describe("duplicado_planilla_obras", () => {
    it("should list every row of a repeated (edificio, cable, zona) key in each staging table and leave out DO, Primario and PRIMARIO", async () => {
      // Arrange
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: "A1", cable: "01", zona: "01", conca: "A1 primero" },
        { edificio: "A1", cable: "01", zona: "01", conca: "A1 segundo" },
        { edificio: "B1", cable: "01", zona: "02", conca: "B1 solo" },
        { edificio: "C1", cable: "01", zona: "DO", conca: "C1 DO 1" },
        { edificio: "C1", cable: "01", zona: "DO", conca: "C1 DO 2" },
        { edificio: "C1", cable: "01", zona: "Primario", conca: "C1 P 1" },
        { edificio: "C1", cable: "01", zona: "Primario", conca: "C1 P 2" },
        { edificio: "C1", cable: "01", zona: "PRIMARIO", conca: "C1 PP 1" },
        { edificio: "C1", cable: "01", zona: "PRIMARIO", conca: "C1 PP 2" },
        { edificio: "N1", cable: "01", zona: null, conca: "N1 null 1" },
        { edificio: "N1", cable: "01", zona: null, conca: "N1 null 2" },
      ]);
      await seedPlanillaRows(database, AvanceFileKind.UDPEM, [
        { edificio: "D1", cable: "02", zona: "03", conca: "D1 uno" },
        { edificio: "D1", cable: "02", zona: "03", conca: "D1 dos" },
        { edificio: "D1", cable: "02", zona: "03", conca: "D1 tres" },
        { edificio: "A1", cable: "01", zona: "01", conca: "A1 en la otra tabla" },
      ]);

      // Act
      const rows = await runReport(ReportKind.DUPLICADO);

      // Assert
      const conca = column(ReportKind.DUPLICADO, "conca");
      expect(rows.map((row) => row[conca])).toEqual(["A1 primero", "A1 segundo", "D1 dos", "D1 tres", "D1 uno"]);
      expect(rows[0]).toEqual(["CENTRAL", "01", "01", "EMP", "01/01/2020", "EJE", "DIR", "EJECUTADA", "A1 primero", "A1", "01012020", "OLD", expect.stringMatching(DATE_TEXT)]);
      expect([...EXCLUDED_ZONE_NAMES]).toEqual(["DO", "Primario", "PRIMARIO"]);
    });

    it("should format fechacarga as yyyy-MM-dd text", async () => {
      // Arrange
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: "A1", cable: "01", zona: "01" },
        { edificio: "A1", cable: "01", zona: "01" },
      ]);
      await database.exec("UPDATE public.avance_planilla_int SET fechacarga = '2026-02-03'");

      // Act
      const rows = await runReport(ReportKind.DUPLICADO);

      // Assert
      expect(rows.map((row) => row[column(ReportKind.DUPLICADO, "fechacarga")])).toEqual(["2026-02-03", "2026-02-03"]);
    });

    it("should order the union by conca, cable, zona and etiqueta", async () => {
      // Arrange
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: "A", cable: "01", zona: "01", conca: "ZZZ" },
        { edificio: "A", cable: "01", zona: "01", conca: "ZZZ" },
      ]);
      await seedPlanillaRows(database, AvanceFileKind.UDPEM, [
        { edificio: "B", cable: "01", zona: "01", conca: "AAA" },
        { edificio: "B", cable: "01", zona: "01", conca: "AAA" },
      ]);

      // Act
      const rows = await runReport(ReportKind.DUPLICADO);

      // Assert
      expect(rows.map((row) => row[column(ReportKind.DUPLICADO, "conca")])).toEqual(["AAA", "AAA", "ZZZ", "ZZZ"]);
    });
  });

  describe("error_estados_modificados (compares against the latest history batch only)", () => {
    const HISTORY_ROWS = [
      { edificio: "E1", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2026-02-02" },
      { edificio: "E1", cable: "001", zona: "02", estado: "EJECUTADA", fechacarga: "2026-02-02" },
      { edificio: "E2", cable: "001", zona: "01", estado: "EN TRABAJO", fechacarga: "2026-02-02" },
      { edificio: "E2", cable: "001", zona: "02", estado: "EN TRABAJO", fechacarga: "2026-02-02" },
      { edificio: "E3", cable: "001", zona: "01", estado: "PLAN 2017", fechacarga: "2026-02-02" },
      { edificio: "E3", cable: "001", zona: "02", estado: "PLAN 2017", fechacarga: "2026-02-02" },
      { edificio: "E4", cable: "001", zona: "01", estado: "EJECUTADA SIN PLANOSALCOM", fechacarga: "2026-02-02" },
      { edificio: "E4", cable: "001", zona: "02", estado: "EJECUTADA SIN PLANOSALCOM", fechacarga: "2026-02-02" },
      { edificio: "E5", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2026-02-02" },
      { edificio: "E6", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2026-01-01" },
    ];

    const AVANCE_ROWS = [
      { edificio: "E1", cable: "001", zona: "01", estado: "EN TRABAJO" },
      { edificio: "E1", cable: "001", zona: "02", estado: "ejecutada" },
      { edificio: "E2", cable: "001", zona: "01", estado: "PLAN 2017" },
      { edificio: "E2", cable: "001", zona: "02", estado: "EJECUTADA" },
      { edificio: "E3", cable: "001", zona: "01", estado: "EN TRABAJO" },
      { edificio: "E3", cable: "001", zona: "02", estado: "OTRO" },
      { edificio: "E4", cable: "001", zona: "01", estado: "EN TRABAJO" },
      { edificio: "E4", cable: "001", zona: "02", estado: "EJECUTADA" },
      { edificio: "E6", cable: "001", zona: "01", estado: "X" },
    ].map((row) => ({ ...row, fechacarga: null }));

    it("should report an Avance state that regressed from the latest history batch, per the legacy rules, and ignore older batches", async () => {
      // Arrange
      await seedHistoryRows(database, HISTORY_ROWS);
      await seedAvance(database, AVANCE_ROWS);

      // Act
      const rows = await runReport(ReportKind.ERROR_ESTADOS);

      // Assert
      const pairs = rows.map((row) => [
        row[column(ReportKind.ERROR_ESTADOS, "edificio")],
        row[column(ReportKind.ERROR_ESTADOS, "zona")],
        row[column(ReportKind.ERROR_ESTADOS, "estado")],
        row[column(ReportKind.ERROR_ESTADOS, "historico_estado")],
      ]);
      expect(pairs).toEqual([
        ["E1", "01", "EN TRABAJO", "EJECUTADA"],
        ["E2", "01", "PLAN 2017", "EN TRABAJO"],
        ["E3", "02", "OTRO", "PLAN 2017"],
        ["E4", "01", "EN TRABAJO", "EJECUTADA SIN PLANOSALCOM"],
        ["", "", "", "EJECUTADA"],
      ]);
    });

    it("should report a history EJECUTADA row that no longer exists in the Avance, with empty Avance columns, last", async () => {
      // Arrange
      await seedHistoryRows(database, HISTORY_ROWS);
      await seedAvance(database, AVANCE_ROWS);

      // Act
      const rows = await runReport(ReportKind.ERROR_ESTADOS);

      // Assert
      const last = rows.at(-1) ?? [];
      expect(last[column(ReportKind.ERROR_ESTADOS, "historico_edificio")]).toBe("E5");
      expect(last[column(ReportKind.ERROR_ESTADOS, "edificio")]).toBe("");
      expect(last[column(ReportKind.ERROR_ESTADOS, "historico_fechacarga")]).toBe("2026-02-02");
    });

    it("should not report a state that differs only in case", async () => {
      // Arrange
      await seedHistoryRows(database, [{ edificio: "E1", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2026-02-02" }]);
      await seedAvance(database, [{ edificio: "E1", cable: "001", zona: "01", estado: "Ejecutada", fechacarga: null }]);

      // Act
      const rows = await runReport(ReportKind.ERROR_ESTADOS);

      // Assert
      expect(rows).toEqual([]);
    });

    it("should only look at the newest fechacarga of the history, whichever batch has more rows", async () => {
      // Arrange
      await seedHistoryRows(database, [
        { edificio: "O1", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2026-01-01" },
        { edificio: "O2", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2026-01-01" },
        { edificio: "O3", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2026-01-01" },
        { edificio: "N1", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2026-03-03" },
      ]);
      await seedAvance(database, [
        { edificio: "O1", cable: "001", zona: "01", estado: "X", fechacarga: null },
        { edificio: "N1", cable: "001", zona: "01", estado: "X", fechacarga: null },
      ]);

      // Act
      const rows = await runReport(ReportKind.ERROR_ESTADOS);

      // Assert
      expect(rows.map((row) => row[column(ReportKind.ERROR_ESTADOS, "historico_edificio")])).toEqual(["N1"]);
    });

    it("should not trim the Avance edificio column (the legacy output field has no trim)", async () => {
      // Arrange
      await seedHistoryRows(database, [{ edificio: "E1", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2026-02-02" }]);
      await seedAvance(database, [{ edificio: "E1", cable: "001", zona: "01", estado: "X", fechacarga: null }]);

      // Act
      const rows = await runReport(ReportKind.ERROR_ESTADOS);

      // Assert
      expect(REPORT_COLUMNS[ReportKind.ERROR_ESTADOS][0]).toEqual({ name: "edificio", trims: false });
      expect(rows).toHaveLength(1);
    });
  });

  describe("zonas_en_planilla_no_en_SIGRA (decision O1 applies)", () => {
    async function seedPlanillas(): Promise<void> {
      await seedZones(database, STANDARD_ZONES);
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: EDIF_ONE, cable: "01", zona: "01", conca: "en SIGRA", etiqueta: "EJECUTADA" },
        { edificio: "EDIF000009", cable: "01", zona: "01", conca: "falta uno", etiqueta: "EJECUTADA" },
        { edificio: "EDIF000009", cable: "01", zona: "01", conca: "falta uno", etiqueta: "EJECUTADA" },
        { edificio: EDIF_ONE, cable: "01", zona: "DO", conca: "DO", etiqueta: "EJECUTADA" },
        { edificio: EDIF_TWO, cable: "01", zona: "01", conca: "zona eliminada", etiqueta: "EJECUTADA" },
      ]);
      await seedPlanillaRows(database, AvanceFileKind.UDPEM, [
        { edificio: "EDIF000008", cable: "02", zona: "03", conca: "falta dos", etiqueta: "EJECUTADA" },
        { edificio: EDIF_ONE, cable: "01", zona: "Primario", conca: "Primario", etiqueta: "EJECUTADA" },
      ]);
    }

    it("should list the planilla keys that find no zone, de-duplicated by the GROUP BY, from both tables, without DO or Primario", async () => {
      // Arrange
      await seedPlanillas();

      // Act
      const rows = await runReport(ReportKind.EN_PLANILLA_NO_EN_SIGRA);

      // Assert
      expect(rows).toEqual([
        ["EDIF000008", "02", "03", "falta dos", "EJECUTADA"],
        ["EDIF000009", "01", "01", "falta uno", "EJECUTADA"],
      ]);
    });

    it("should treat the eliminated zone as present under parity (empty filter) and as missing under the intent filter", async () => {
      // Arrange
      await seedPlanillas();
      const { sql } = REPORT_QUERIES[ReportKind.EN_PLANILLA_NO_EN_SIGRA];

      // Act
      const parity = await database.query<{ conca: string }>(sql, [[...EXCLUDED_ZONE_NAMES], [...EXCLUDED_DISTRICT_STATUSES]]);
      const intent = await database.query<{ conca: string }>(sql, [[...EXCLUDED_ZONE_NAMES], [ELIMINATED_STATUS]]);

      // Assert
      expect(parity.rows.map((row) => row.conca)).not.toContain("zona eliminada");
      expect(intent.rows.map((row) => row.conca)).toContain("zona eliminada");
    });

    it("should bind the query parameters from the constants: DO/Primario names, then the status list", () => {
      // Arrange & Act & Assert
      expect(REPORT_QUERIES[ReportKind.EN_PLANILLA_NO_EN_SIGRA].params).toEqual([[...EXCLUDED_ZONE_NAMES], [...EXCLUDED_DISTRICT_STATUSES]]);
      expect(REPORT_QUERIES[ReportKind.EN_SIGRA_NO_EN_PLANILLA].params).toEqual([[...EXCLUDED_DISTRICT_STATUSES], [...EXCLUDED_ZONE_NAMES]]);
      expect(REPORT_QUERIES[ReportKind.DUPLICADO].params).toEqual([[...EXCLUDED_ZONE_NAMES]]);
    });
  });

  describe("zonas_en_SIGRA_no_en_planilla (decision O1 applies)", () => {
    async function seedWorld(): Promise<void> {
      await seedZones(database, STANDARD_ZONES);
      await seedPlanillaRows(database, AvanceFileKind.INT, [{ edificio: EDIF_ONE, cable: "01", zona: "01" }]);
    }

    it("should list the zones that no planilla row covers, ordered by key, with the legacy columns", async () => {
      // Arrange
      await seedWorld();

      // Act
      const rows = await runReport(ReportKind.EN_SIGRA_NO_EN_PLANILLA);

      // Assert
      expect(rows).toEqual([
        ["1", EDIF_ONE, "IDC", "C001Z02", "CENTRAL", "001", "02", "C001Z02", "Proyectado/Instalacion", "T1", "CT1"],
        ["1", EDIF_TWO, "IDC", "C001Z01", "CENTRAL", "001", "01", "C001Z01", ELIMINATED_STATUS, "T1", "CT1"],
      ]);
    });

    it("should match a zone from the UDPEM planilla too", async () => {
      // Arrange
      await seedWorld();
      await seedPlanillaRows(database, AvanceFileKind.UDPEM, [{ edificio: EDIF_ONE, cable: "01", zona: "02" }]);

      // Act
      const rows = await runReport(ReportKind.EN_SIGRA_NO_EN_PLANILLA);

      // Assert
      expect(rows.map((row) => row[column(ReportKind.EN_SIGRA_NO_EN_PLANILLA, "codigo_distrito")])).toEqual(["C001Z01"]);
    });

    it("should leave the eliminated zone out of the list under the intent filter, and list it under parity", async () => {
      // Arrange
      await seedWorld();
      const { sql } = REPORT_QUERIES[ReportKind.EN_SIGRA_NO_EN_PLANILLA];

      // Act
      const parity = await database.query<{ situacion_distrito: string }>(sql, [[...EXCLUDED_DISTRICT_STATUSES], [...EXCLUDED_ZONE_NAMES]]);
      const intent = await database.query<{ situacion_distrito: string }>(sql, [[ELIMINATED_STATUS], [...EXCLUDED_ZONE_NAMES]]);

      // Assert
      expect(parity.rows.map((row) => row.situacion_distrito)).toContain(ELIMINATED_STATUS);
      expect(intent.rows.map((row) => row.situacion_distrito)).not.toContain(ELIMINATED_STATUS);
    });

    it("should list every zone when the planilla tables are empty", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);

      // Act
      const rows = await runReport(ReportKind.EN_SIGRA_NO_EN_PLANILLA);

      // Assert
      expect(rows).toHaveLength(3);
    });
  });

  describe("anti-join rewrite of the two NOT IN reports (statement text)", () => {
    const ANTI_JOIN_KINDS = [ReportKind.EN_PLANILLA_NO_EN_SIGRA, ReportKind.EN_SIGRA_NO_EN_PLANILLA] as const;

    it.each(ANTI_JOIN_KINDS)("should not use NOT IN in %s (Postgres plans it as a rescanning SubPlan)", (kind) => {
      expect(REPORT_QUERIES[kind].sql).not.toMatch(/\bNOT\s+IN\b/i);
    });

    it.each(ANTI_JOIN_KINDS)("should use NOT EXISTS in %s", (kind) => {
      expect(REPORT_QUERIES[kind].sql).toMatch(/\bNOT\s+EXISTS\b/i);
    });

    it.each(ANTI_JOIN_KINDS)("should not use the MATERIALIZED keyword in %s (the target Postgres may be 11)", (kind) => {
      expect(REPORT_QUERIES[kind].sql).not.toMatch(/\bMATERIALIZED\b/i);
    });

    it.each(ANTI_JOIN_KINDS)("should compute the matched set once in a WITH CTE in %s", (kind) => {
      expect(REPORT_QUERIES[kind].sql).toMatch(/\bWITH\s+\w+\s+AS\s*\(/i);
    });
  });

  describe("NOT IN parity of the rewritten reports (NULL keys behave as the legacy NOT IN)", () => {
    const INTENT = [ELIMINATED_STATUS];

    async function planillaNoEnSigra(statuses: ReadonlyArray<string>): Promise<string[][]> {
      const { sql } = REPORT_QUERIES[ReportKind.EN_PLANILLA_NO_EN_SIGRA];
      const result = await database.query<Record<string, string>>(sql, [[...EXCLUDED_ZONE_NAMES], [...statuses]]);
      return result.rows.map((row) => REPORT_COLUMNS[ReportKind.EN_PLANILLA_NO_EN_SIGRA].map((entry) => String(row[entry.name])));
    }

    async function sigraNoEnPlanilla(statuses: ReadonlyArray<string>): Promise<string[][]> {
      const { sql } = REPORT_QUERIES[ReportKind.EN_SIGRA_NO_EN_PLANILLA];
      const result = await database.query<Record<string, string>>(sql, [[...statuses], [...EXCLUDED_ZONE_NAMES]]);
      return result.rows.map((row) => REPORT_COLUMNS[ReportKind.EN_SIGRA_NO_EN_PLANILLA].map((entry) => String(row[entry.name])));
    }

    it("should keep the planilla column list and order of the legacy report", () => {
      expect(REPORT_COLUMNS[ReportKind.EN_PLANILLA_NO_EN_SIGRA].map((entry) => entry.name)).toEqual(["edificio", "cable", "zona", "conca", "etiqueta"]);
    });

    it("should keep the SIGRA column list and order of the legacy report", () => {
      expect(REPORT_COLUMNS[ReportKind.EN_SIGRA_NO_EN_PLANILLA].map((entry) => entry.name)).toEqual([
        "id_distrito", "edificio", "identificacion_de_la_central", "codigo_distrito", "nombre_central",
        "cable", "zona", "conca", "situacion_distrito", "id_terminalfibraoptica", "codigo_terminalfibraoptica",
      ]);
    });

    it("should return the planilla rows absent from SIGRA and not the matched ones (en_planilla_no_en_SIGRA)", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: EDIF_ONE, cable: "01", zona: "01", conca: "matched" },
        { edificio: "EDIF000009", cable: "01", zona: "01", conca: "absent" },
      ]);

      // Act
      const rows = await planillaNoEnSigra(EXCLUDED_DISTRICT_STATUSES);

      // Assert
      expect(rows).toEqual([["EDIF000009", "01", "01", "absent", "EJECUTADA"]]);
    });

    it("should not return a planilla row whose key has a NULL part: NULL NOT IN (...) is never true (en_planilla_no_en_SIGRA)", async () => {
      // Arrange: legacy `key NOT IN (subquery)` yields NULL, not true, for a NULL left key, so no row
      await seedZones(database, STANDARD_ZONES);
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: null, cable: "01", zona: "01", conca: "null edificio" },
        { edificio: "EDIF000009", cable: null, zona: "01", conca: "null cable" },
        { edificio: "EDIF000009", cable: "01", zona: null, conca: "null zona" },
        { edificio: "EDIF000009", cable: "01", zona: "01", conca: "absent" },
        { edificio: EDIF_ONE, cable: "01", zona: "01", conca: "matched, keeps the matched set non-empty" },
      ]);

      // Act
      const rows = await planillaNoEnSigra(EXCLUDED_DISTRICT_STATUSES);

      // Assert
      expect(rows.map((row) => row[3])).toEqual(["absent"]);
    });

    it("should return NULL-key planilla rows when the matched set is EMPTY: NULL NOT IN (empty) is true (en_planilla_no_en_SIGRA)", async () => {
      // Arrange: legacy NOT IN over an empty subquery is true even for a NULL left key; zona NULL is dropped earlier by zona <> ALL(...)
      await seedZones(database, STANDARD_ZONES);
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: null, cable: "01", zona: "01", conca: "null edificio" },
        { edificio: "EDIF000009", cable: null, zona: "01", conca: "null cable" },
        { edificio: "EDIF000009", cable: "01", zona: null, conca: "null zona" },
        { edificio: "EDIF000009", cable: "01", zona: "01", conca: "absent" },
      ]);

      // Act
      const rows = await planillaNoEnSigra(EXCLUDED_DISTRICT_STATUSES);

      // Assert
      expect(rows.map((row) => row[3]).sort()).toEqual(["absent", "null cable", "null edificio"]);
    });

    it("should still return the absent rows when NULL-key rows exist elsewhere: a NULL-key left row must not blank the report (en_planilla_no_en_SIGRA)", async () => {
      // Arrange: the matched set (non-NULL by construction of its join) is not poisoned by NULL-key planilla rows
      await seedZones(database, STANDARD_ZONES);
      await seedPlanillaRows(database, AvanceFileKind.UDPEM, [
        { edificio: null, cable: null, zona: "01", conca: "all null" },
        { edificio: EDIF_ONE, cable: "01", zona: "01", conca: "matched" },
        { edificio: "EDIF000008", cable: "02", zona: "03", conca: "absent" },
      ]);

      // Act
      const rows = await planillaNoEnSigra(EXCLUDED_DISTRICT_STATUSES);

      // Assert
      expect(rows).toEqual([["EDIF000008", "02", "03", "absent", "EJECUTADA"]]);
    });

    it("should behave as before with the O1 list [Proyectado/Eliminacion]: the eliminated zone counts as missing, rows ordered (en_planilla_no_en_SIGRA)", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: EDIF_TWO, cable: "01", zona: "01", conca: "zona eliminada" },
        { edificio: EDIF_ONE, cable: "01", zona: "01", conca: "matched" },
        { edificio: "EDIF000009", cable: "01", zona: "01", conca: "absent" },
        { edificio: EDIF_ONE, cable: "01", zona: "DO", conca: "DO" },
      ]);
      await seedPlanillaRows(database, AvanceFileKind.UDPEM, [{ edificio: "EDIF000001", cable: "01", zona: "Primario", conca: "Primario" }]);

      // Act
      const rows = await planillaNoEnSigra(INTENT);

      // Assert: ordered by edificio, cable, zona
      expect(rows).toEqual([
        [EDIF_TWO, "01", "01", "zona eliminada", "EJECUTADA"],
        ["EDIF000009", "01", "01", "absent", "EJECUTADA"],
      ]);
    });

    it("should return the zones absent from the planilla and not the matched ones (en_SIGRA_no_en_planilla)", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);
      await seedPlanillaRows(database, AvanceFileKind.INT, [{ edificio: EDIF_ONE, cable: "01", zona: "01" }]);

      // Act
      const rows = await sigraNoEnPlanilla(EXCLUDED_DISTRICT_STATUSES);

      // Assert
      expect(rows.map((row) => [row[1], row[3]])).toEqual([
        [EDIF_ONE, "C001Z02"],
        [EDIF_TWO, "C001Z01"],
      ]);
    });

    it("should not return a SIGRA row whose key has a NULL part (NULL edificio or NULL codigo_distrito): NULL NOT IN (...) is never true (en_SIGRA_no_en_planilla)", async () => {
      // Arrange
      await seedZones(database, [
        ...STANDARD_ZONES,
        { edificio: "EDIFNULLED", codigoDistrito: "C009Z09", status: "Existente" },
        { edificio: "EDIFNULLCD", codigoDistrito: "C008Z08", status: "Existente" },
      ]);
      await database.exec("UPDATE public.area_zonas_ftth_f SET edificio = NULL WHERE codigo_distrito = 'C009Z09'");
      await database.exec("UPDATE public.area_zonas_ftth_f SET codigo_distrito = NULL WHERE edificio = 'EDIFNULLCD'");
      await seedPlanillaRows(database, AvanceFileKind.INT, [{ edificio: EDIF_ONE, cable: "01", zona: "01" }]);

      // Act
      const rows = await sigraNoEnPlanilla(EXCLUDED_DISTRICT_STATUSES);

      // Assert: the NULL-key zones are absent, the non-NULL unmatched ones are still reported (report not blanked)
      expect(rows.map((row) => [row[1], row[3]])).toEqual([
        [EDIF_ONE, "C001Z02"],
        [EDIF_TWO, "C001Z01"],
      ]);
    });

    it("should return NULL-key SIGRA rows when the matched set is EMPTY: NULL NOT IN (empty) is true (en_SIGRA_no_en_planilla)", async () => {
      // Arrange: no planilla row, so the legacy subquery is empty
      await seedZones(database, [{ edificio: "EDIFNULLED", codigoDistrito: "C009Z09", status: "Existente" }]);
      await database.exec("UPDATE public.area_zonas_ftth_f SET edificio = NULL");

      // Act
      const rows = await sigraNoEnPlanilla(EXCLUDED_DISTRICT_STATUSES);

      // Assert
      expect(rows.map((row) => row[3])).toEqual(["C009Z09"]);
    });

    it("should behave as before with the O1 list [Proyectado/Eliminacion]: the eliminated zone is left out (en_SIGRA_no_en_planilla)", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);
      await seedPlanillaRows(database, AvanceFileKind.INT, [{ edificio: EDIF_ONE, cable: "01", zona: "01" }]);

      // Act
      const rows = await sigraNoEnPlanilla(INTENT);

      // Assert
      expect(rows).toEqual([["1", EDIF_ONE, "IDC", "C001Z02", "CENTRAL", "001", "02", "C001Z02", "Proyectado/Instalacion", "T1", "CT1"]]);
    });

    it("should order the SIGRA report by edificio, cable part, zone part (en_SIGRA_no_en_planilla)", async () => {
      // Arrange
      await seedZones(database, [
        { edificio: "EDIF000005", codigoDistrito: "C002Z01", status: "Existente" },
        { edificio: "EDIF000005", codigoDistrito: "C001Z02", status: "Existente" },
        { edificio: "EDIF000003", codigoDistrito: "C009Z09", status: "Existente" },
      ]);

      // Act
      const rows = await sigraNoEnPlanilla(EXCLUDED_DISTRICT_STATUSES);

      // Assert
      expect(rows.map((row) => row[3])).toEqual(["C009Z09", "C001Z02", "C002Z01"]);
    });
  });

  describe("ZONAS_FTTH_fuera_central (stub spatial functions; threshold 90 %)", () => {
    it("should contain the 90 % threshold and the UNION ALL with the no-central branch (statement text)", () => {
      // Arrange
      const { sql } = REPORT_QUERIES[ReportKind.FUERA_CENTRAL];

      // Act & Assert
      expect(sql).toContain("< 90::double precision");
      expect(sql).toContain("UNION ALL");
      expect(sql).toContain("WHERE lc.geom IS NULL");
      expect(sql).toContain("public.limite_central_ftth");
      expect(sql).toContain("st_intersects(a.geom, lc.geom)");
      expect(sql).toContain("HAVING");
      expect(REPORT_QUERIES[ReportKind.FUERA_CENTRAL].params).toEqual([]);
    });

    it("should report a polygon covered less than 90 % by the central limits and one with no central at all, not 90 % or more", async () => {
      // Arrange
      const geoms = ["A".repeat(10), "B".repeat(3), "Z".repeat(3), "C".repeat(10), "D".repeat(100)];
      await seedAvance(
        database,
        geoms.map((geom, index) => ({ cable: "001", zona: `0${index + 1}`, edificio: EDIF_ONE, geom, fechacarga: null }))
      );
      await database.exec(`
        INSERT INTO public.limite_central_ftth (geom) VALUES ('${"A".repeat(5)}'), ('${"B".repeat(3)}'), ('${"C".repeat(9)}'), ('${"D".repeat(89)}');
      `);

      // Act
      const rows = await runReport(ReportKind.FUERA_CENTRAL);

      // Assert: A is 50 %, B 100 %, Z has no central, C is exactly 90 % (not < 90), D is 89 %
      const gids = rows.map((row) => row[column(ReportKind.FUERA_CENTRAL, "gid")]).sort();
      expect(gids).toEqual(["1", "3", "5"]);
    });

    it("should add the areas of several central limits that overlap one polygon", async () => {
      // Arrange
      await seedAvance(database, [{ cable: "001", zona: "01", edificio: EDIF_ONE, geom: "E".repeat(10), fechacarga: null }]);
      await database.exec(`INSERT INTO public.limite_central_ftth (geom) VALUES ('${"E".repeat(5)}'), ('${"E".repeat(4)}');`);

      // Act
      const rows = await runReport(ReportKind.FUERA_CENTRAL);

      // Assert: 5 + 4 = 9 of 10 is 90 %, so the polygon is inside
      expect(rows).toEqual([]);
    });

    it("should return the legacy columns with fechacarga as yyyy-MM-dd text", async () => {
      // Arrange
      await seedAvance(database, [{ cable: "001", zona: "01", edificio: EDIF_ONE, geom: "Q", fechacarga: "2026-05-06" }]);

      // Act
      const rows = await runReport(ReportKind.FUERA_CENTRAL);

      // Assert
      expect(rows).toEqual([["1", "CENTRAL", "001", "01", "CONCA", EDIF_ONE, "01/01/2020", "EJECUTADA", "2026-05-06"]]);
    });
  });

  describe("savepoints", () => {
    it("should release the savepoint of every report that succeeds", async () => {
      // Arrange
      const client = new RecordingPgliteClient(database);

      // Act
      await client.query("BEGIN READ ONLY", []);
      await runReportsGuarded(client, [ReportKind.DUPLICADO, ReportKind.ERROR_ESTADOS], () => "x");
      await client.query("ROLLBACK", []);

      // Assert
      expect(client.statements.filter((statement) => statement === "SAVEPOINT avance_report")).toHaveLength(2);
      expect(client.statements.filter((statement) => statement === "RELEASE SAVEPOINT avance_report")).toHaveLength(2);
      expect(client.statements.filter((statement) => statement === "ROLLBACK TO SAVEPOINT avance_report")).toHaveLength(0);
    });
  });
});
