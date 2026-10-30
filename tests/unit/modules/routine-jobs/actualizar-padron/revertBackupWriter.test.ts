import { gunzipSync } from "node:zlib";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESTINATION_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import { buildCreateRevertTableSql, REVERT_TABLE_SQL } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/revertCapture";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { writeRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackup";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

type Row = Record<string, unknown>;

/* The store directory lives under os.tmpdir(): the default export is redirected to a fresh temp root per test. */
const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const GEOMETRY_STUBS_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE FUNCTION ST_AsEWKB(geometry) RETURNS bytea AS 'SELECT decode($1::text, ''hex'')' LANGUAGE sql;
`;

const NOW = new Date("2026-10-30T12:00:00.000Z");
const ONE_SECOND_MS = 1000;

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const TARGET: WritableTargetLayout = {
  schema: "carto",
  table: "padron",
  columns: identityOf(Object.values(DESTINATION_COLUMN)),
  srid: 32721,
  idColumn: DESTINATION_COLUMN.ID,
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const sessionOn = (database: PGlite): RunSession => ({
  async query(sql: string, values?: unknown[]) {
    const result = await database.query(sql, values);
    return { rows: result.rows as Row[] };
  },
  async close() {},
});

describe("actualizar-padron revert backup writer on a real temp directory (AP-70, AP-72, AP-73)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-revert-writer-"));
    tempRoot.directory = directory;
    database = new PGlite();
    await database.exec(GEOMETRY_STUBS_SQL);
  });

  afterEach(async () => {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("should write a gzip revert file that starts with the psql preamble, register it, and leave no file when the counts differ", async () => {
    await database.exec(`BEGIN; ${buildCreateRevertTableSql()}`);
    await database.exec(
      `INSERT INTO ${REVERT_TABLE_SQL} (kind, id, geometry) VALUES ('U', 1, '20'), ('I', 7, NULL), ('I', 8, NULL);`
    );
    const session = sessionOn(database);

    const backup = await writeRevertBackup(session, { target: TARGET, expected: { inserted: 2, updated: 1, paired: 0 } }, NOW);

    const filePath = path.join(directory, "gis-tools-routine-jobs", backup.fileName);
    const lines = gunzipSync(await readFile(filePath)).toString("utf8").split("\n");
    const updateLines = lines.filter((line) => line.startsWith("UPDATE "));
    const deleteLines = lines.filter((line) => line.startsWith("DELETE FROM "));
    expect(lines.slice(0, 2)).toEqual(["\\set ON_ERROR_STOP on", "SET client_encoding = 'UTF8';"]);
    expect(lines.indexOf("BEGIN;")).toBeGreaterThan(1);
    expect(backup.fileName).toMatch(/^padron-revert-carto-padron-\d{8}-\d{6}\.sql\.gz$/);
    expect(backup.counts).toEqual({ updated: 1, paired: 0, inserted: 2, addressMasterRows: 0 });
    expect(updateLines).toHaveLength(1);
    expect(deleteLines).toHaveLength(1);
    expect(backup.bytes).toBe((await stat(filePath)).size);
    expect(getRevertBackup(backup.token)).toMatchObject({ filePath, fileName: backup.fileName, bytes: backup.bytes });

    const mismatchNow = new Date(NOW.getTime() + ONE_SECOND_MS);
    await expect(
      writeRevertBackup(session, { target: TARGET, expected: { inserted: 1, updated: 1, paired: 0 } }, mismatchNow)
    ).rejects.toThrow(
      /No se pudo generar el respaldo para revertir: Los padrones insertados guardados \(2\) no coinciden con los insertados \(1\)\./
    );
    expect(await readdir(path.join(directory, "gis-tools-routine-jobs"))).toEqual([backup.fileName]);

    await database.exec("ROLLBACK");
  });
});
