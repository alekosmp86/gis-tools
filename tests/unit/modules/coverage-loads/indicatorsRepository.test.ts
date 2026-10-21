import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { FUENTE } from "@/modules/coverage-loads/indicators/constants";
import { LoadRefusedError } from "@/modules/coverage-loads/indicators/domain/plan";
import { parseIndicatorsFile } from "@/modules/coverage-loads/indicators/domain/csvIndicators";
import { PgIndicatorsRepository } from "@/modules/coverage-loads/indicators/services/PgIndicatorsRepository";
import { STORED_ROWS_SQL } from "@/modules/coverage-loads/indicators/services/queries/historyQueries";
import { ParseKind } from "@/modules/coverage-loads/indicators/types";
import type { ParsedCut } from "@/modules/coverage-loads/indicators/types";
import type { DbConnection } from "@/modules/coverage-loads/types";
import { csvBytes, makeCut, makeRejected, makeRows, validDataLines } from "./csvBuilders";
import {
  allStampedToday,
  countHistory,
  createCoverageDatabase,
  readHistory,
  readStaging,
  RecordingPgliteClient,
  resetCoverageDatabase,
  seedHistory,
  seedStaging,
  snapshotTables,
  withLimitedRole,
} from "./pgliteHarness";

const CONNECTION: DbConnection = {
  host: "db.example",
  port: 5432,
  db_name: "carto",
  user: "operator",
  password: "s3cret-password",
};

const HISTORY = "historico.h_cobertura_lte_localidad";
const AUGUST = "2026-08-01";
const SEPTEMBER = "2026-09-01";

let database: PGlite;
let clients: RecordingPgliteClient[];

beforeAll(async () => {
  database = await createCoverageDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetCoverageDatabase(database);
  clients = [];
});

function newRepository(): PgIndicatorsRepository {
  return new PgIndicatorsRepository(() => {
    const client = new RecordingPgliteClient(database);
    clients.push(client);
    return client;
  });
}

function lastClient(): RecordingPgliteClient {
  return clients[clients.length - 1];
}

function writes(client: RecordingPgliteClient): string[] {
  return client.statementsMatching(/^(INSERT|DELETE|UPDATE|COMMIT)|WITH borrado/i);
}

async function seedCut(fechaact: string, count: number, porcentaje = "10", prefix = "OLD"): Promise<void> {
  await seedHistory(
    database,
    makeRows(count, prefix, porcentaje).map((row) => ({
      departamento: row.departamento,
      localidad: row.localidad,
      porcentaje: row.porcentaje,
      cobertura: "SI",
      fechaact,
    }))
  );
}

function parsedFile(fechaact: string, lines: string[]): ParsedCut {
  const outcome = parseIndicatorsFile(`IndicadoresLTE_${fechaact.replace(/-/g, "")}.csv`, csvBytes(lines));
  if (outcome.kind !== ParseKind.CUT) throw new Error(outcome.error.message);
  return outcome.cut;
}

describe("PgIndicatorsRepository against PGlite", () => {
  describe("inspectHistory (AC-14, AC-15, AC-23)", () => {
    it("should count the stored rows per date and key them by YYYY-MM-DD text", async () => {
      // Arrange
      await seedCut(AUGUST, 3);
      await seedCut(SEPTEMBER, 5);

      // Act
      const state = await newRepository().inspectHistory(CONNECTION, [AUGUST, SEPTEMBER, "2026-10-01"]);

      // Assert
      expect(state.existingRowsByDate).toEqual({ [AUGUST]: 3, [SEPTEMBER]: 5 });
      expect(state.shortfalls).toEqual([]);
      for (const total of Object.values(state.existingRowsByDate)) expect(typeof total).toBe("number");
    });

    it("should run in a read-only transaction that is rolled back and writes nothing", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 3);
      const before = await snapshotTables(database);

      // Act
      await newRepository().inspectHistory(CONNECTION, [SEPTEMBER]);

      // Assert
      const client = lastClient();
      expect(client.statements[0]).toBe("BEGIN READ ONLY");
      expect(client.statements.at(-1)).toBe("ROLLBACK");
      expect(writes(client)).toEqual([]);
      expect(await snapshotTables(database)).toEqual(before);
      expect(client.endCount).toBe(1);
    });

    it("should not query the counts when no date is asked for", async () => {
      // Arrange & Act
      const state = await newRepository().inspectHistory(CONNECTION, []);

      // Assert
      expect(state.existingRowsByDate).toEqual({});
      expect(lastClient().statementsMatching(/count\(\*\)/)).toEqual([]);
    });
  });

  describe("loadCuts: writing the history (AC-10..13)", () => {
    it("should save the valid rows of a partial file and report the rejected ones (AC-5)", async () => {
      // Arrange
      const lines = validDataLines(615);
      lines[10] = "BAD;ROW;abc;Si";
      lines[300] = "TOO;FEW";
      lines[500] = "A;B;101;Si";
      const cut = parsedFile(SEPTEMBER, lines);

      // Act
      const result = await newRepository().loadCuts(CONNECTION, { cuts: [cut], acceptShrink: false });

      // Assert
      expect(await countHistory(database, SEPTEMBER)).toBe(612);
      expect(result.cuts).toEqual([
        {
          fileName: "IndicadoresLTE_20260901.csv",
          fechaact: SEPTEMBER,
          replacedRows: 0,
          insertedRows: 612,
          storedRows: 612,
          rejectedRows: 3,
          incomplete: true,
          incompleteMessage: "corte 2026-09-01 incompleto: 612 de 615 filas, 3 rechazadas",
        },
      ]);
      expect(result.totalInserted).toBe(612);
      expect(result.hasIncompleteCut).toBe(true);
      expect(result.rejectedRows.map((row) => row.line)).toEqual([12, 302, 502]);
    });

    it("should not duplicate rows when the same cut is loaded again (615 -> 615)", async () => {
      // Arrange
      const cut = makeCut(SEPTEMBER, makeRows(615));
      await newRepository().loadCuts(CONNECTION, { cuts: [cut], acceptShrink: false });

      // Act
      const second = await newRepository().loadCuts(CONNECTION, { cuts: [cut], acceptShrink: false });

      // Assert
      expect(await countHistory(database, SEPTEMBER)).toBe(615);
      expect(second.cuts[0]).toMatchObject({ replacedRows: 615, insertedRows: 615, storedRows: 615 });
      expect(second.totalReplaced).toBe(615);
    });

    it("should replace the stored values when the reloaded cut has changed values", async () => {
      // Arrange
      await newRepository().loadCuts(CONNECTION, {
        cuts: [makeCut(SEPTEMBER, makeRows(4, "LOC", "10", "No"))],
        acceptShrink: false,
      });

      // Act
      await newRepository().loadCuts(CONNECTION, {
        cuts: [makeCut(SEPTEMBER, makeRows(4, "LOC", "60.5", "Si"))],
        acceptShrink: false,
      });

      // Assert
      const rows = await readHistory(database, SEPTEMBER);
      expect(rows).toHaveLength(4);
      expect(rows.map((row) => [row.porcentajecobertura, row.cobertura_lte])).toEqual(Array(4).fill(["60.50", "SI"]));
    });

    it("should leave the other dates untouched", async () => {
      // Arrange
      await seedCut(AUGUST, 3, "33");
      const augustBefore = await readHistory(database, AUGUST);
      await seedCut(SEPTEMBER, 5);

      // Act
      await newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, makeRows(2))], acceptShrink: true });

      // Assert
      expect(await readHistory(database, AUGUST)).toEqual(augustBefore);
      expect(await countHistory(database, SEPTEMBER)).toBe(2);
    });

    it("should write two cuts of one run, each replacing only its own date (AC-9)", async () => {
      // Arrange
      await seedCut(AUGUST, 3);
      const cuts = [makeCut(SEPTEMBER, makeRows(4, "NEW")), makeCut(AUGUST, makeRows(6, "NEW"))];

      // Act
      const result = await newRepository().loadCuts(CONNECTION, { cuts, acceptShrink: false });

      // Assert
      expect(await countHistory(database, AUGUST)).toBe(6);
      expect(await countHistory(database, SEPTEMBER)).toBe(4);
      expect(result.cuts.map((cut) => [cut.fechaact, cut.replacedRows, cut.insertedRows])).toEqual([
        [AUGUST, 3, 6],
        [SEPTEMBER, 0, 4],
      ]);
      expect(result.totalInserted).toBe(10);
      expect(result.totalReplaced).toBe(3);
    });

    it("should stamp today's date as fecha_historico and the constant FUENTE as usuario", async () => {
      // Arrange & Act
      await newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, makeRows(3))], acceptShrink: false });

      // Assert
      expect(await allStampedToday(database, SEPTEMBER)).toBe(true);
      const rows = await readHistory(database, SEPTEMBER);
      expect(new Set(rows.map((row) => row.usuario))).toEqual(new Set([FUENTE]));
      expect(FUENTE).toBe("EXTERNO/F.Maresca");
    });

    it("should round the percentage to two decimals and upper-case the Cobertura in the history", async () => {
      // Arrange
      const rows = [
        { departamento: "A", localidad: "UNO", porcentaje: "91.345", cobertura: "Si" },
        { departamento: "A", localidad: "DOS", porcentaje: "99.994", cobertura: "no" },
        { departamento: "A", localidad: "TRES", porcentaje: "100", cobertura: "sI" },
        { departamento: "A", localidad: "CUATRO", porcentaje: "0", cobertura: "NO" },
      ];

      // Act
      await newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, rows)], acceptShrink: false });

      // Assert
      const stored = await readHistory(database, SEPTEMBER);
      expect(stored.map((row) => [row.nombloc, row.porcentajecobertura, row.cobertura_lte])).toEqual([
        ["CUATRO", "0.00", "NO"],
        ["DOS", "99.99", "NO"],
        ["TRES", "100.00", "SI"],
        ["UNO", "91.35", "SI"],
      ]);
    });

    it("should refill staging with the file text as is: YYYY-MM-DD text, FUENTE, text percentage", async () => {
      // Arrange
      const rows = [{ departamento: "A", localidad: "UNO", porcentaje: "91.345", cobertura: "Si" }];

      // Act
      await newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, rows)], acceptShrink: false });

      // Assert
      expect(await readStaging(database)).toEqual([
        { nombdepto: "A", nombloc: "UNO", cobertura_lte: "Si", fechaact: SEPTEMBER, fuente: FUENTE, porcentaje: "91.345" },
      ]);
    });

    it("should leave the rows of all the cuts in staging, oldest cut first, whatever the upload order", async () => {
      // Arrange
      await seedStaging(database, [
        { nombdepto: "OLD", nombloc: "OLD", cobertura_lte: "Si", fechaact: "2000-01-01", fuente: "PREVIOUS", porcentaje: "1" },
      ]);
      const cuts = [makeCut(SEPTEMBER, makeRows(4, "SEP")), makeCut(AUGUST, makeRows(2, "AUG"))];

      // Act
      await newRepository().loadCuts(CONNECTION, { cuts, acceptShrink: false });

      // Assert
      const staging = await readStaging(database);
      expect(staging.map((row) => [row.fechaact, row.nombloc])).toEqual([
        ...makeRows(2, "AUG").map((row) => [AUGUST, row.localidad]),
        ...makeRows(4, "SEP").map((row) => [SEPTEMBER, row.localidad]),
      ]);
      expect(new Set(staging.map((row) => row.fuente))).toEqual(new Set([FUENTE]));
      expect(staging.some((row) => row.fuente === "PREVIOUS")).toBe(false);
    });

    it("should run one connection and one READ COMMITTED transaction that commits once", async () => {
      // Arrange
      const cuts = [makeCut(AUGUST, makeRows(2)), makeCut(SEPTEMBER, makeRows(2))];

      // Act
      await newRepository().loadCuts(CONNECTION, { cuts, acceptShrink: false });

      // Assert
      expect(clients).toHaveLength(1);
      const client = lastClient();
      expect(client.statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      expect(client.statements[1]).toBe("SET LOCAL lock_timeout = '10s'");
      expect(client.statements[2]).toBe("SET LOCAL statement_timeout = 120000");
      expect(client.statements.at(-1)).toBe("COMMIT");
      expect(client.statementsMatching(/^COMMIT$/)).toHaveLength(1);
      expect(client.statementsMatching(/^ROLLBACK$/)).toHaveLength(0);
      expect(client.statementsMatching(/^DELETE FROM public\.indicadores_lte$/)).toHaveLength(1);
      expect(client.statementsMatching(/WITH borrado/)).toHaveLength(1);
      expect(client.statementsMatching(/^INSERT INTO public\.indicadores_lte/)).toHaveLength(1);
      expect(client.connectCount).toBe(1);
      expect(client.endCount).toBe(1);
    });

    it("should fill staging with one INSERT holding every row of the oldest cut before those of the newer one", async () => {
      // Arrange
      const cuts = [makeCut(SEPTEMBER, makeRows(3, "SEP")), makeCut(AUGUST, makeRows(2, "AUG"))];

      // Act
      await newRepository().loadCuts(CONNECTION, { cuts, acceptShrink: false });

      // Assert
      const stagingFills = lastClient().calls.filter((call) => /INSERT INTO public\.indicadores_lte/.test(call.text));
      expect(stagingFills).toHaveLength(1);
      const values = stagingFills[0].values;
      expect(values[0]).toEqual([AUGUST, AUGUST, SEPTEMBER, SEPTEMBER, SEPTEMBER]);
      expect(values[1]).toBe(FUENTE);
      expect(values[2]).toEqual([...makeRows(2, "AUG"), ...makeRows(3, "SEP")].map((row) => row.localidad));
    });

    it("should count the stored rows of each cut oldest first, after the single replace", async () => {
      // Arrange
      const cuts = [makeCut(SEPTEMBER, makeRows(3)), makeCut(AUGUST, makeRows(2))];

      // Act
      await newRepository().loadCuts(CONNECTION, { cuts, acceptShrink: false });

      // Assert
      const statements = lastClient().statements;
      const replaceAt = statements.findIndex((sql) => /WITH borrado/.test(sql));
      const storedCalls = lastClient().calls.filter((call) => call.text.trim() === STORED_ROWS_SQL.trim());
      const storedAt = statements.map((sql, index) => (sql === STORED_ROWS_SQL.trim() ? index : -1)).filter((i) => i >= 0);
      expect(storedCalls.map((call) => call.values)).toEqual([[AUGUST], [SEPTEMBER]]);
      expect(storedAt.every((index) => index > replaceAt)).toBe(true);
      expect(statements.at(-1)).toBe("COMMIT");
    });
  });

  describe("loadCuts: staging parity with the legacy job", () => {
    const RUN_SIZES: ReadonlyArray<readonly [string, number]> = [
      ["2026-05-01", 30],
      ["2026-06-01", 28],
      ["2026-07-01", 25],
      ["2026-08-01", 20],
      ["2026-09-01", 22],
    ];
    const TOTAL = 125;

    function runCutsNewestFirst(): ParsedCut[] {
      return [...RUN_SIZES].reverse().map(([fechaact, count]) => makeCut(fechaact, makeRows(count, `N${fechaact.slice(5, 7)}`)));
    }

    it("should leave all the rows of a 5-cut run in staging with YYYY-MM-DD text, the staging DELETE and REPLACE running once", async () => {
      // Arrange
      const cuts = runCutsNewestFirst();

      // Act
      const result = await newRepository().loadCuts(CONNECTION, { cuts, acceptShrink: false });

      // Assert
      const staging = await readStaging(database);
      expect(result.totalInserted).toBe(TOTAL);
      expect(staging).toHaveLength(TOTAL);
      for (const row of staging) expect(row.fechaact).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(staging.map((row) => row.fechaact)).toEqual(RUN_SIZES.flatMap(([fechaact, count]) => Array(count).fill(fechaact)));
      const client = lastClient();
      expect(client.statementsMatching(/^DELETE FROM public\.indicadores_lte$/)).toHaveLength(1);
      expect(client.statementsMatching(/WITH borrado/)).toHaveLength(1);
      expect(client.statementsMatching(/^INSERT INTO public\.indicadores_lte/)).toHaveLength(1);
      expect(client.calls.filter((call) => call.text.trim() === STORED_ROWS_SQL.trim())).toHaveLength(RUN_SIZES.length);
      expect(client.statementsMatching(/^COMMIT$/)).toHaveLength(1);
    });

    it("should report replaced and stored rows per date, with and without existing rows, and leave other dates alone", async () => {
      // Arrange
      await seedCut("2026-05-01", 10, "10", "OLD");
      await seedCut("2026-07-01", 40, "10", "OLD");
      await seedCut("2026-01-01", 3, "33", "KEEP");
      const keptBefore = await readHistory(database, "2026-01-01");

      // Act
      const result = await newRepository().loadCuts(CONNECTION, { cuts: runCutsNewestFirst(), acceptShrink: true });

      // Assert
      expect(result.cuts.map((cut) => [cut.fechaact, cut.replacedRows, cut.insertedRows, cut.storedRows])).toEqual([
        ["2026-05-01", 10, 30, 30],
        ["2026-06-01", 0, 28, 28],
        ["2026-07-01", 40, 25, 25],
        ["2026-08-01", 0, 20, 20],
        ["2026-09-01", 0, 22, 22],
      ]);
      expect(result.totalReplaced).toBe(50);
      expect(result.totalInserted).toBe(TOTAL);
      for (const [fechaact, count] of RUN_SIZES) expect(await countHistory(database, fechaact)).toBe(count);
      expect(await readHistory(database, "2026-01-01")).toEqual(keptBefore);
    });

    it("should not duplicate anything when the same 5-cut run is loaded again", async () => {
      // Arrange
      await newRepository().loadCuts(CONNECTION, { cuts: runCutsNewestFirst(), acceptShrink: false });

      // Act
      const second = await newRepository().loadCuts(CONNECTION, { cuts: runCutsNewestFirst(), acceptShrink: false });

      // Assert
      expect(await countHistory(database)).toBe(TOTAL);
      expect(second.cuts.map((cut) => [cut.replacedRows, cut.storedRows])).toEqual(RUN_SIZES.map(([, count]) => [count, count]));
      expect(await readStaging(database)).toHaveLength(TOTAL);
    });
  });

  describe("loadCuts: rollback on failure (AC-10, AC-33)", () => {
    const OLD_STAGING = {
      nombdepto: "PREV",
      nombloc: "PREV",
      cobertura_lte: "Si",
      fechaact: "2000-01-01",
      fuente: "PREVIOUS",
      porcentaje: "1",
    };

    async function seedPreviousWorld(): Promise<void> {
      await seedCut(AUGUST, 3, "10", "OLD");
      await seedCut(SEPTEMBER, 2, "20", "OLD");
      await seedStaging(database, [OLD_STAGING]);
    }

    const BAD_ROWS: ReadonlyArray<[string, { departamento: string; localidad: string; porcentaje: string; cobertura: string }]> = [
      ["a localidad over varchar(40)", { departamento: "DEP", localidad: "X".repeat(41), porcentaje: "10", cobertura: "Si" }],
      ["a departamento over varchar(15)", { departamento: "D".repeat(16), localidad: "LOC", porcentaje: "10", cobertura: "Si" }],
      ["a Cobertura over varchar(2)", { departamento: "DEP", localidad: "LOC", porcentaje: "10", cobertura: "Sis" }],
      ["a non-numeric percentage", { departamento: "DEP", localidad: "LOC", porcentaje: "abc", cobertura: "Si" }],
    ];

    it.each(BAD_ROWS)(
      "should keep the previous history and staging when the newer cut of the run has %s and the older one is valid",
      async (_label, badRow) => {
        // Arrange
        await seedPreviousWorld();
        const before = await snapshotTables(database);
        const cuts = [makeCut(AUGUST, makeRows(5, "NEW")), makeCut(SEPTEMBER, [badRow])];

        // Act
        const attempt = newRepository().loadCuts(CONNECTION, { cuts, acceptShrink: true });

        // Assert
        await expect(attempt).rejects.toThrow();
        expect(await snapshotTables(database)).toEqual(before);
        const client = lastClient();
        expect(client.statementsMatching(/^DELETE FROM public\.indicadores_lte$/)).toHaveLength(1);
        expect(client.statementsMatching(/^INSERT INTO public\.indicadores_lte/)).toHaveLength(1);
        expect(client.statementsMatching(/WITH borrado/)).toHaveLength(1);
        expect(client.calls.filter((call) => call.text.trim() === STORED_ROWS_SQL.trim())).toHaveLength(0);
        expect(client.statements.at(-1)).toBe("ROLLBACK");
        expect(client.statementsMatching(/^COMMIT$/)).toHaveLength(0);
        expect(client.endCount).toBe(1);
      }
    );

    it.each(BAD_ROWS)(
      "should keep the previous history and staging when the older cut of the run has %s and the newer one is valid",
      async (_label, badRow) => {
        // Arrange
        await seedPreviousWorld();
        const before = await snapshotTables(database);
        const cuts = [makeCut(AUGUST, [badRow]), makeCut(SEPTEMBER, makeRows(5, "NEW"))];

        // Act
        const attempt = newRepository().loadCuts(CONNECTION, { cuts, acceptShrink: true });

        // Assert
        await expect(attempt).rejects.toThrow();
        expect(await snapshotTables(database)).toEqual(before);
        const client = lastClient();
        expect(client.statementsMatching(/WITH borrado/)).toHaveLength(1);
        expect(client.statements.at(-1)).toBe("ROLLBACK");
        expect(client.statementsMatching(/^COMMIT$/)).toHaveLength(0);
        expect(client.endCount).toBe(1);
      }
    );

    it("should keep the previous history and staging when the only cut fails", async () => {
      // Arrange
      await seedPreviousWorld();
      const before = await snapshotTables(database);
      const cut = makeCut(SEPTEMBER, [{ departamento: "DEP", localidad: "X".repeat(41), porcentaje: "10", cobertura: "Si" }]);

      // Act
      const attempt = newRepository().loadCuts(CONNECTION, { cuts: [cut], acceptShrink: true });

      // Assert
      await expect(attempt).rejects.toThrow(/value too long/);
      expect(await snapshotTables(database)).toEqual(before);
      expect(lastClient().statements.at(-1)).toBe("ROLLBACK");
    });

    it("should be able to load again after a failed attempt left no trace", async () => {
      // Arrange
      await seedPreviousWorld();
      const failing = makeCut(SEPTEMBER, [{ departamento: "D".repeat(16), localidad: "LOC", porcentaje: "10", cobertura: "Si" }]);
      await newRepository().loadCuts(CONNECTION, { cuts: [failing], acceptShrink: true }).catch(() => undefined);

      // Act
      await newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, makeRows(3, "FIX"))], acceptShrink: true });

      // Assert
      expect(await countHistory(database, SEPTEMBER)).toBe(3);
      expect(await countHistory(database, AUGUST)).toBe(3);
    });
  });

  describe("loadCuts: shrink guard (AC-8, AC-33)", () => {
    it("should refuse with LoadRefusedError and write nothing when a cut shrinks and the reduction is not accepted", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 615);
      const before = await snapshotTables(database);
      const partial = makeCut(SEPTEMBER, makeRows(612), makeRejected("f.csv", 3));

      // Act
      const attempt = newRepository().loadCuts(CONNECTION, { cuts: [partial], acceptShrink: false });

      // Assert
      await expect(attempt).rejects.toThrow(LoadRefusedError);
      await expect(attempt).rejects.toThrow(/aceptar explícitamente la reducción/);
      expect(await snapshotTables(database)).toEqual(before);
      const client = lastClient();
      expect(writes(client)).toEqual([]);
      expect(client.statements.at(-1)).toBe("ROLLBACK");
    });

    it("should carry the plan that explains the refusal", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 5);
      const partial = makeCut(SEPTEMBER, makeRows(2));

      // Act
      const error = await newRepository()
        .loadCuts(CONNECTION, { cuts: [partial], acceptShrink: false })
        .catch((caught: unknown) => caught);

      // Assert
      expect(error).toBeInstanceOf(LoadRefusedError);
      expect((error as LoadRefusedError).plan.requiresAcceptShrink).toBe(true);
      expect((error as LoadRefusedError).plan.cuts[0]).toMatchObject({ existingRows: 5, validRows: 2, shrinks: true });
    });

    it("should replace the cut with the partial one when the reduction is accepted, and a fixed file restores it without duplicates", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 615);
      const partial = makeCut(SEPTEMBER, makeRows(612), makeRejected("f.csv", 3));
      const full = makeCut(SEPTEMBER, makeRows(615));

      // Act
      const shrunk = await newRepository().loadCuts(CONNECTION, { cuts: [partial], acceptShrink: true });
      const countAfterPartial = await countHistory(database, SEPTEMBER);
      await newRepository().loadCuts(CONNECTION, { cuts: [full], acceptShrink: false });

      // Assert
      expect(shrunk.cuts[0]).toMatchObject({ replacedRows: 615, insertedRows: 612, storedRows: 612 });
      expect(countAfterPartial).toBe(612);
      expect(await countHistory(database, SEPTEMBER)).toBe(615);
    });

    it("should not require acceptance when the new cut is not smaller", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 5);

      // Act
      await newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, makeRows(5, "NEW"))], acceptShrink: false });

      // Assert
      expect(await countHistory(database, SEPTEMBER)).toBe(5);
    });
  });

  describe("privileges (AC-14, AC-33)", () => {
    const FULL_GRANTS = `
      GRANT SELECT, INSERT, DELETE ON ${HISTORY} TO app_limited;
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA historico, public TO app_limited;
      GRANT SELECT, INSERT, DELETE ON public.indicadores_lte TO app_limited;
    `;

    it("should report no shortfall when the role holds every required privilege, and let the load through", async () => {
      // Arrange
      await withLimitedRole(database, FULL_GRANTS, async () => {
        // Act
        const state = await newRepository().inspectHistory(CONNECTION, [SEPTEMBER]);
        await newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, makeRows(2))], acceptShrink: false });

        // Assert
        expect(state.shortfalls).toEqual([]);
      });
      expect(await countHistory(database, SEPTEMBER)).toBe(2);
    });

    it("should report SELECT on staging as missing, up front, because the replace statement reads it", async () => {
      // Arrange: the documented privileges only; REPLACE_HISTORY_SQL selects FROM public.indicadores_lte
      const documentedOnly = `
        GRANT SELECT, INSERT, DELETE ON ${HISTORY} TO app_limited;
        GRANT USAGE ON ALL SEQUENCES IN SCHEMA historico, public TO app_limited;
        GRANT INSERT, DELETE ON public.indicadores_lte TO app_limited;
      `;
      await withLimitedRole(database, documentedOnly, async () => {
        // Act
        const state = await newRepository().inspectHistory(CONNECTION, [SEPTEMBER]);

        // Assert
        expect(state.shortfalls).toEqual([
          { table: "public.indicadores_lte", tableExists: true, missing: ["SELECT"] },
        ]);
      });
    });

    it("should name DELETE on staging as missing, because the replace now empties it with DELETE instead of TRUNCATE", async () => {
      // Arrange
      const noStagingDelete = `
        GRANT SELECT, INSERT, DELETE ON ${HISTORY} TO app_limited;
        GRANT USAGE ON ALL SEQUENCES IN SCHEMA historico, public TO app_limited;
        GRANT SELECT, INSERT ON public.indicadores_lte TO app_limited;
      `;
      await withLimitedRole(database, noStagingDelete, async () => {
        // Act
        const state = await newRepository().inspectHistory(CONNECTION, [SEPTEMBER]);

        // Assert
        expect(state.shortfalls).toEqual([{ table: "public.indicadores_lte", tableExists: true, missing: ["DELETE"] }]);
      });
    });

    it("should list the missing privileges of both tables", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 2);
      await withLimitedRole(database, `GRANT SELECT ON ${HISTORY} TO app_limited;`, async () => {
        // Act
        const state = await newRepository().inspectHistory(CONNECTION, [SEPTEMBER]);

        // Assert
        expect(state.shortfalls).toHaveLength(2);
        expect(state.shortfalls[0]).toEqual({ table: HISTORY, tableExists: true, missing: ["INSERT", "DELETE"] });
        expect(state.shortfalls[1].table).toBe("public.indicadores_lte");
        expect(state.shortfalls[1].missing).toEqual(expect.arrayContaining(["SELECT", "INSERT", "DELETE"]));
        expect(state.existingRowsByDate).toEqual({ [SEPTEMBER]: 2 });
      });
    });

    it("should skip the count query and report no existing rows when SELECT on the history is missing", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 2);
      await withLimitedRole(database, `GRANT INSERT, DELETE ON ${HISTORY} TO app_limited;`, async () => {
        // Act
        const state = await newRepository().inspectHistory(CONNECTION, [SEPTEMBER]);

        // Assert
        expect(state.shortfalls[0]).toEqual({ table: HISTORY, tableExists: true, missing: ["SELECT"] });
        expect(state.existingRowsByDate).toEqual({});
        expect(lastClient().statementsMatching(/count\(\*\)/)).toEqual([]);
      });
    });

    it("should refuse a load with zero writes when a privilege is missing", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 3);
      const before = await snapshotTables(database);

      await withLimitedRole(
        database,
        `GRANT SELECT, INSERT ON ${HISTORY} TO app_limited; GRANT INSERT, DELETE ON public.indicadores_lte TO app_limited;`,
        async () => {
          // Act
          const attempt = newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, makeRows(3))], acceptShrink: true });

          // Assert
          await expect(attempt).rejects.toThrow(LoadRefusedError);
          await expect(attempt).rejects.toThrow(`Faltan privilegios sobre ${HISTORY}: DELETE.`);
          expect(writes(lastClient())).toEqual([]);
        }
      );
      expect(await snapshotTables(database)).toEqual(before);
    });

    it("should report a missing staging table and refuse the load without writing", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 3);
      await database.exec("DROP TABLE public.indicadores_lte");

      // Act
      const state = await newRepository().inspectHistory(CONNECTION, [SEPTEMBER]);
      const attempt = newRepository().loadCuts(CONNECTION, { cuts: [makeCut(SEPTEMBER, makeRows(3))], acceptShrink: true });

      // Assert
      expect(state.shortfalls).toEqual([{ table: "public.indicadores_lte", tableExists: false, missing: [] }]);
      expect(state.existingRowsByDate).toEqual({ [SEPTEMBER]: 3 });
      await expect(attempt).rejects.toThrow("La tabla public.indicadores_lte no existe en esta base de datos.");
      expect(writes(lastClient())).toEqual([]);
      expect(await countHistory(database, SEPTEMBER)).toBe(3);
    });

    it("should report a missing history table without trying to read it", async () => {
      // Arrange
      await database.exec("DROP TABLE historico.h_cobertura_lte_localidad");

      // Act
      const state = await newRepository().inspectHistory(CONNECTION, [SEPTEMBER]);

      // Assert
      expect(state.shortfalls).toEqual([{ table: HISTORY, tableExists: false, missing: [] }]);
      expect(state.existingRowsByDate).toEqual({});
    });
  });

  describe("readReport transaction (AC-16)", () => {
    it("should run in a read-only transaction that rolls back and never writes", async () => {
      // Arrange
      await seedCut(SEPTEMBER, 3);
      const before = await snapshotTables(database);

      // Act
      const rows = await newRepository().readReport(CONNECTION, "localidad");

      // Assert
      expect(rows).toHaveLength(3);
      const client = lastClient();
      expect(client.statements[0]).toBe("BEGIN READ ONLY");
      expect(client.statements.at(-1)).toBe("ROLLBACK");
      expect(writes(client)).toEqual([]);
      expect(await snapshotTables(database)).toEqual(before);
    });
  });
});
