import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, LOCALITY_TYPE_COLUMN, PROVINCE_COLUMN, SKIP_REASON, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { toReportView } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportMapping";
import { buildReportSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportSql";
import type { PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const SETUP_TIMEOUT_MS = 30000;

const STUBS_SQL = `
  CREATE DOMAIN geometry AS text;
  CREATE FUNCTION ST_IsValid(geometry) RETURNS boolean AS 'SELECT true' LANGUAGE sql;
  CREATE FUNCTION ST_MakeValid(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_CollectionExtract(geometry, int) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION GeometryType(geometry) RETURNS text AS 'SELECT ''MULTIPOLYGON''' LANGUAGE sql;
  CREATE FUNCTION ST_SRID(geometry) RETURNS int AS 'SELECT 32721' LANGUAGE sql;
  CREATE FUNCTION ST_Transform(geometry, int) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_Multi(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_Force2D(geometry) RETURNS geometry AS 'SELECT $1' LANGUAGE sql;
  CREATE FUNCTION ST_IsEmpty(geometry) RETURNS boolean AS 'SELECT $1 = ''''' LANGUAGE sql;
`;

const SCHEMA_SQL = `
  CREATE SCHEMA stg;
  CREATE SCHEMA carto;
  CREATE TABLE stg.padron_staging (unidadcat text, nomdepto text, nomloccat text, padron numeric, geom geometry);
  CREATE TABLE carto.province (id int, name text);
  CREATE TABLE carto.loc (id int, name text, id_province int, id_territorial_unit_type int);
  CREATE TABLE carto.padron (
    id serial PRIMARY KEY, number varchar(10), type_padron varchar(30),
    id_cadastral_locality int, id_province int, geometry geometry, id_address_master int
  );
  INSERT INTO carto.province VALUES (1, 'CANELONES'), (2, 'COLONIA'), (3, 'ROCHA'), (4, 'SALTO'), (5, 'ARTIGAS'), (6, 'DURAZNO'), (7, 'FLORES'), (8, 'MALDONADO');
`;

const identityOf = (columns: readonly string[]): Record<string, string> => Object.fromEntries(columns.map((column) => [column, column]));
const tableOf = (schema: string, table: string, columns: readonly string[]): TableLayout => ({ schema, table, columns: identityOf(columns) });

const TARGET: WritableTargetLayout = {
  ...tableOf("carto", "padron", Object.values(DESTINATION_COLUMN)),
  srid: 32721,
  idColumn: DESTINATION_COLUMN.ID,
  idSequence: "carto.padron_id_seq",
  identityColumns: [],
  catalog: [],
};

const layoutsOf = (localityTypeId?: number): PadronLayouts => ({
  staging: tableOf("stg", "padron_staging", Object.values(STAGING_COLUMN)),
  target: TARGET,
  province: tableOf("carto", "province", Object.values(PROVINCE_COLUMN)),
  locality: tableOf("carto", "loc", [...Object.values(LOCALITY_COLUMN), LOCALITY_TYPE_COLUMN.ID_TERRITORIAL_UNIT_TYPE]),
  ...(localityTypeId === undefined ? {} : { localityTypeId }),
});

type LocalityRowSpec = [id: number, name: string, province: number, type: number];

describe("actualizar-padron other departments of a locality not found on embedded Postgres (AP-119)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(STUBS_SQL);
    await database.exec(SCHEMA_SQL);
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  });

  const stage = async (rows: Array<[department: string, locality: string]>): Promise<void> => {
    for (const [index, [department, locality]] of rows.entries()) {
      await database.query("INSERT INTO stg.padron_staging VALUES ('URBANO', $1, $2, $3, '1')", [department, locality, index + 1]);
    }
  };

  const localities = async (rows: LocalityRowSpec[]): Promise<void> => {
    for (const [id, name, province, type] of rows) {
      await database.query("INSERT INTO carto.loc VALUES ($1, $2, $3, $4)", [id, name, province, type]);
    }
  };

  const groupsOf = async (localityTypeId?: number) => {
    const row = (await database.query<Record<string, unknown>>(buildReportSql(layoutsOf(localityTypeId)))).rows[0];
    return toReportView(row).skipped.byLocalityAndReason;
  };

  const groupOf = (groups: Awaited<ReturnType<typeof groupsOf>>, locality: string) => groups.find((group) => group.locality === locality);

  it("should list COLONIA for NUEVA HELVECIA and FLORENCIO SANCHEZ staged under CANELONES that exist only under COLONIA", async () => {
    await localities([[10, "NUEVA HELVECIA", 2, 1], [11, "FLORENCIO SANCHEZ", 2, 1]]);
    await stage([["CANELONES", "NUEVA HELVECIA"], ["CANELONES", "FLORENCIO SANCHEZ"]]);

    const groups = await groupsOf();

    expect(groupOf(groups, "NUEVA HELVECIA")).toMatchObject({ reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, otherDepartments: ["COLONIA"] });
    expect(groupOf(groups, "FLORENCIO SANCHEZ")).toMatchObject({ reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, otherDepartments: ["COLONIA"] });
  });

  it("should match the locality name ignoring case", async () => {
    await localities([[10, "Nueva Helvecia", 2, 1]]);
    await stage([["CANELONES", "NUEVA HELVECIA"]]);

    const groups = await groupsOf();

    expect(groupOf(groups, "NUEVA HELVECIA")?.otherDepartments).toEqual(["COLONIA"]);
  });

  it("should return an empty list when the name exists in no department", async () => {
    await localities([[10, "OTRA", 2, 1]]);
    await stage([["CANELONES", "NOWHERE"]]);

    const groups = await groupsOf();

    expect(groupOf(groups, "NOWHERE")).toMatchObject({ reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, otherDepartments: [] });
  });

  it("should not fold accents: a name with an accent does not match the one without it", async () => {
    await localities([[10, "SANCHEZ", 2, 1]]);
    await stage([["CANELONES", "SÁNCHEZ"]]);

    const groups = await groupsOf();

    expect(groupOf(groups, "SÁNCHEZ")?.otherDepartments).toEqual([]);
  });

  it("should return both departments sorted when the name exists in two other departments", async () => {
    await localities([[10, "LA PALOMA", 3, 1], [11, "LA PALOMA", 2, 1]]);
    await stage([["CANELONES", "LA PALOMA"]]);

    const groups = await groupsOf();

    expect(groupOf(groups, "LA PALOMA")?.otherDepartments).toEqual(["COLONIA", "ROCHA"]);
  });

  it("should list a department once when it holds the name twice", async () => {
    await localities([[10, "LA PALOMA", 2, 1], [11, "LA PALOMA", 2, 1]]);
    await stage([["CANELONES", "LA PALOMA"]]);

    const groups = await groupsOf();

    expect(groupOf(groups, "LA PALOMA")?.otherDepartments).toEqual(["COLONIA"]);
  });

  it("should keep the first five departments in name order when the name exists in more than five", async () => {
    await localities([[10, "CENTRO", 2, 1], [11, "CENTRO", 3, 1], [12, "CENTRO", 4, 1], [13, "CENTRO", 5, 1], [14, "CENTRO", 6, 1], [15, "CENTRO", 7, 1], [16, "CENTRO", 8, 1]]);
    await stage([["CANELONES", "CENTRO"]]);

    const groups = await groupsOf();

    expect(groupOf(groups, "CENTRO")?.otherDepartments).toEqual(["ARTIGAS", "COLONIA", "DURAZNO", "FLORES", "MALDONADO"]);
  });

  it("should give no otherDepartments key to an ambiguous row", async () => {
    await localities([[10, "NUEVA HELVECIA", 1, 1], [11, "NUEVA HELVECIA", 1, 1], [12, "NUEVA HELVECIA", 2, 1]]);
    await stage([["CANELONES", "NUEVA HELVECIA"]]);

    const groups = await groupsOf();

    const group = groupOf(groups, "NUEVA HELVECIA");
    expect(group?.reason).toBe(SKIP_REASON.LOCALIDAD_AMBIGUA);
    expect(group).not.toHaveProperty("otherDepartments");
  });

  describe("locality type filter", () => {
    it("should ignore localities of other types when a locality type id is set", async () => {
      await localities([[10, "NUEVA HELVECIA", 2, 2], [11, "NUEVA HELVECIA", 3, 1]]);
      await stage([["CANELONES", "NUEVA HELVECIA"]]);

      const groups = await groupsOf(1);

      expect(groupOf(groups, "NUEVA HELVECIA")?.otherDepartments).toEqual(["ROCHA"]);
    });

    it("should list departments of every type when no locality type id is set", async () => {
      await localities([[10, "NUEVA HELVECIA", 2, 2], [11, "NUEVA HELVECIA", 3, 1]]);
      await stage([["CANELONES", "NUEVA HELVECIA"]]);

      const groups = await groupsOf();

      expect(groupOf(groups, "NUEVA HELVECIA")?.otherDepartments).toEqual(["COLONIA", "ROCHA"]);
    });

    it("should leave out the own department when its same-named locality has another type and is the reason of the not found", async () => {
      await localities([[10, "NUEVA HELVECIA", 1, 2], [11, "NUEVA HELVECIA", 2, 1]]);
      await stage([["CANELONES", "NUEVA HELVECIA"]]);

      const groups = await groupsOf(1);

      expect(groupOf(groups, "NUEVA HELVECIA")).toMatchObject({ reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, otherDepartments: ["COLONIA"] });
    });
  });
});
