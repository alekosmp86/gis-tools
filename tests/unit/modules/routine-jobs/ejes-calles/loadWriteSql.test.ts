import { describe, expect, it } from "vitest";
import {
  EJES_DEFAULT_TABLES,
  EJES_LOAD_ROLES,
  EJES_REQUIRED_COLUMNS_BY_ROLE,
  EJES_TABLE_ROLE,
  LOAD_CHUNK_SIZE,
  LOAD_LOCK_TIMEOUT_MS,
} from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ejesLoadContextOf, nextvalSql, physicalOf, qualifiedOf, typedAs } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadContext";
import {
  buildAnalyzeLoadedSql,
  buildDeleteSectionsSql,
  buildInsertMastersSql,
  buildInsertSectionsSql,
  buildInsertWaysSql,
  buildLockSql,
  buildLockTimeoutSql,
  buildMovePointsSql,
  buildRenumberSectionsSql,
  buildUpdateFontSql,
  buildUpdateGeometrySql,
  buildUpdateIdcalleSql,
  buildUpdateTypeSql,
  distanceSql,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadWriteSql";
import { buildInsertWayInputSql, newWayOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadWays";
import {
  buildCreateWayInputSql,
  buildLoadCountsSql,
  buildNewTableSql,
  buildNewWaysSql,
  buildPairTableSql,
  buildSurplusListSql,
  buildRenumberedListSql,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadSelectionSql";
import {
  buildRevertCountSql,
  buildRevertInsertsSql,
  buildRevertPageSql,
  buildRevertPointsSql,
  buildRevertSectionsSql,
  REVERT_ORDER,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/revertSql";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";
import { ejesLayouts, ejesTables } from "./ejesFixtures";

const TYPES: Record<string, string> = {
  id: "integer",
  addresses_master_id: "integer",
  reftramo_ideuy: "integer",
  id_circulation_way: "integer",
  id_road_section_type: "integer",
  id_font: "integer",
  id_address_master: "integer",
  source: "integer",
  target: "integer",
  distance: "character varying",
  geometry: "USER-DEFINED",
  name: "text",
  short_name: "text",
  id_road_type: "integer",
  id_calle: "integer",
  urn: "text",
  latitud: "double precision",
  longitud: "double precision",
  id_road_section: "character varying",
};

const SEQUENCES: Record<string, string | null> = {
  [EJES_TABLE_ROLE.ROAD_SECTION]: "carto.road_section_id_seq",
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: "carto.circulation_way_id_seq",
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: "carto.addresses_master_addresses_master_id_seq",
  [EJES_TABLE_ROLE.ACCESS_POINT]: "carto.access_point_id_seq",
};

const targetOf = (role: (typeof EJES_LOAD_ROLES)[number], sequence: string | null | undefined = undefined): WritableTargetLayout => {
  const layout = ejesLayouts()[role];
  const columns = EJES_REQUIRED_COLUMNS_BY_ROLE[role];
  return {
    ...layout,
    srid: 32721,
    idColumn: columns[0],
    idSequence: sequence === undefined ? SEQUENCES[role] : sequence,
    identityColumns: [],
    catalog: columns.map((column) => ({ column_name: column, data_type: TYPES[column] ?? "text", is_nullable: true, column_default: null })),
  };
};

const targets = (): WritableTargetLayout[] => EJES_LOAD_ROLES.map((role) => targetOf(role));
const contextOf = () => ejesLoadContextOf(ejesLayouts(), ejesTables(), targets());

describe("ejes load write SQL (EJL-2, EJL-5, EJL-8, EJL-9, EJL-10, EJL-11)", () => {
  describe("lock and analyze (EJL-2)", () => {
    it("should set a local lock_timeout", () => {
      expect(buildLockTimeoutSql()).toBe(`SET LOCAL lock_timeout = ${LOAD_LOCK_TIMEOUT_MS}`);
      expect(LOAD_LOCK_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it("should lock road_section, circulation_way, addresses_master, access_point and the vertices table in SHARE ROW EXCLUSIVE MODE", () => {
      const sql = buildLockSql(contextOf());

      expect(sql).toBe(
        'LOCK TABLE "carto"."road_section", "carto"."circulation_way", "carto"."addresses_master", "carto"."access_point", "carto"."road_section_vertices_pgr" IN SHARE ROW EXCLUSIVE MODE'
      );
    });

    it("should lock the vertices table, which the topology step writes (EJ-14)", () => {
      expect(buildLockSql(contextOf())).toContain('"carto"."road_section_vertices_pgr"');
    });

    it.each(EJES_LOAD_ROLES)("should ANALYZE the %s table", (role) => {
      const { schema, table } = EJES_DEFAULT_TABLES[role];

      expect(buildAnalyzeLoadedSql(contextOf(), role)).toBe(`ANALYZE "${schema}"."${table}";`);
    });
  });

  describe("context", () => {
    it("should throw when a write target is missing", () => {
      expect(() => ejesLoadContextOf(ejesLayouts(), ejesTables(), targets().slice(1))).toThrow(/Falta la tabla de escritura/);
    });

    it("should quote the schema-qualified name of a role", () => {
      expect(qualifiedOf(contextOf(), EJES_TABLE_ROLE.ACCESS_POINT)).toBe('"carto"."access_point"');
    });

    it("should throw for a logical column that is not resolved", () => {
      expect(() => physicalOf(contextOf(), EJES_TABLE_ROLE.ACCESS_POINT, "inexistente")).toThrow(/Falta la columna resuelta/);
    });

    it("should build a nextval over the quoted sequence", () => {
      expect(nextvalSql(contextOf(), EJES_TABLE_ROLE.ROAD_SECTION)).toBe(`nextval('"carto"."road_section_id_seq"'::regclass)`);
    });

    it("should throw when the table has no id sequence", () => {
      const context = ejesLoadContextOf(
        ejesLayouts(),
        ejesTables(),
        EJES_LOAD_ROLES.map((role) => targetOf(role, role === EJES_TABLE_ROLE.ROAD_SECTION ? null : undefined))
      );

      expect(() => nextvalSql(context, EJES_TABLE_ROLE.ROAD_SECTION)).toThrow(/no tiene secuencia/);
    });

    it("should cast a value to the real column type", () => {
      expect(typedAs(contextOf(), EJES_TABLE_ROLE.ROAD_SECTION, "reftramo_ideuy", "c.ref")).toBe("(c.ref)::integer");
      expect(typedAs(contextOf(), EJES_TABLE_ROLE.ROAD_SECTION, "distance", "x")).toBe("(x)::character varying");
    });

    it("should not cast a geometry column", () => {
      expect(typedAs(contextOf(), EJES_TABLE_ROLE.ROAD_SECTION, "geometry", "c.geom")).toBe("(c.geom)");
    });

    it("should not cast a column that has no catalog entry", () => {
      expect(typedAs(contextOf(), EJES_TABLE_ROLE.ROAD_SECTION, "sin_catalogo", "x")).toBe("(x)");
    });
  });

  describe("inserts (EJL-5, EJL-8)", () => {
    it("should compute distance as ST_Length rounded to two decimals, as text", () => {
      expect(distanceSql("c.geom")).toBe("round(ST_Length(c.geom)::numeric, 2)::text");
    });

    it("should insert NEW sections with NULL source and target, the mapped type and font and the master id", () => {
      const sql = buildInsertSectionsSql(contextOf());

      expect(sql).toMatch(/^WITH "written" AS \(INSERT INTO "carto"\."road_section"/);
      expect(sql).toContain("(NULL)::integer");
      expect(sql).toContain('"id_circulation_way"');
      expect(sql).toContain("(c.idcalle)::integer");
      expect(sql).toContain("(c.type_id)::integer");
      expect(sql).toContain("(c.font_id)::integer");
      expect(sql).toContain("(n.master_id)::integer");
      expect(sql).toContain("(round(ST_Length(c.geom)::numeric, 2)::text)::character varying");
      expect(sql).toContain("RETURNING 1");
    });

    it("should insert one master per NEW section with the urn of the section id and 0 latitud and longitud", () => {
      const sql = buildInsertMastersSql(contextOf());

      expect(sql).toContain("'cgeo:road_section:id:' || n.section_id::text");
      expect(sql).toContain("(0)::double precision, (0)::double precision");
      expect(sql).toContain("FROM pg_temp.\"ej_new\"");
    });

    it("should insert ways with the short_name and the type and font of the first section", () => {
      const sql = buildInsertWaysSql(contextOf());

      expect(sql).toContain('"short_name"');
      expect(sql).toContain("w.short_name");
      expect(sql).toContain("(w.type_id)::integer");
      expect(sql).toContain("(w.font_id)::integer");
      expect(sql).toContain("(w.idcalle)::integer");
    });

    it("should pick the way type and font from the lowest reftramo, ordered by length then text", () => {
      const sql = buildNewWaysSql(ejesLayouts());

      expect(sql).toContain("(array_agg(c.type_id ORDER BY length(c.ref), c.ref))[1]");
      expect(sql).toContain("(array_agg(c.font_id ORDER BY length(c.ref), c.ref))[1]");
    });

    it("should only select ways whose (idcalle, name) pair does not exist, for NEW sections and for sections that moved to another idcalle (EJL-5, EJL-18)", () => {
      const sql = buildNewWaysSql(ejesLayouts());

      expect(sql).toContain("NOT EXISTS");
      expect(sql).toContain('"cw_pairs"');
      expect(sql).toContain('EXISTS (SELECT 1 FROM pg_temp."ej_new" AS n WHERE n.copy_id = c.copy_id)');
      expect(sql).toContain('EXISTS (SELECT 1 FROM pg_temp."ej_state" AS s WHERE s.copy_id = c.copy_id AND s.idcalle_changed)');
    });

    it("should source the way of a moved section from every kept copy, not only from the NEW ones (EJL-18)", () => {
      const sql = buildNewWaysSql(ejesLayouts());

      expect(sql).toContain('FROM pg_temp."ej_copy" AS c');
      expect(sql).toMatch(/WHERE \(EXISTS \(SELECT 1 FROM pg_temp\."ej_new"[^)]*\)\s*OR EXISTS \(SELECT 1 FROM pg_temp\."ej_state"/);
    });

    it("should never emit an update or delete on circulation_way", () => {
      const all = [buildInsertWaysSql(contextOf()), buildNewWaysSql(ejesLayouts()), buildCreateWayInputSql()].join("\n");

      expect(all).not.toMatch(/UPDATE\s+"carto"\."circulation_way"/);
      expect(all).not.toMatch(/DELETE\s+FROM/i);
    });

    it("should take the ids from the sequences when the NEW rows are chosen, before any write", () => {
      const sql = buildNewTableSql(contextOf());

      expect(sql).toContain(`nextval('"carto"."road_section_id_seq"'::regclass)`);
      expect(sql).toContain(`nextval('"carto"."addresses_master_addresses_master_id_seq"'::regclass)`);
      expect(sql).toMatch(/^CREATE TEMP TABLE "ej_new" ON COMMIT DROP AS/);
    });
  });

  describe("updates (EJL-9, EJL-10)", () => {
    it("should update only id_circulation_way for an idcalle change", () => {
      const sql = buildUpdateIdcalleSql(contextOf());

      expect(sql).toContain('SET "id_circulation_way" = (c.idcalle)::integer');
      expect(sql).toContain("s.idcalle_changed");
      expect(sql).not.toContain('"source"');
      expect(sql).not.toContain('"geometry"');
    });

    it("should update only the type for a type change", () => {
      const sql = buildUpdateTypeSql(contextOf());

      expect(sql).toContain('SET "id_road_section_type" = (c.type_id)::integer');
      expect(sql).toContain("s.type_changed");
      expect(sql).not.toContain('"id_font"');
    });

    it("should update only the font for a font change", () => {
      const sql = buildUpdateFontSql(contextOf());

      expect(sql).toContain('SET "id_font" = (c.font_id)::integer');
      expect(sql).toContain("s.font_changed");
      expect(sql).not.toContain('"id_road_section_type"');
    });

    it("should recompute distance and clear source and target on a geometry change", () => {
      const sql = buildUpdateGeometrySql(contextOf());

      expect(sql).toContain('"geometry" = c.geom');
      expect(sql).toContain('"distance" = (round(ST_Length(c.geom)::numeric, 2)::text)::character varying');
      expect(sql).toContain('"source" = (NULL)::integer');
      expect(sql).toContain('"target" = (NULL)::integer');
      expect(sql).toContain("s.geom_changed");
    });

    it("should renumber by setting reftramo_ideuy to the new reftramo, matched by section id", () => {
      const sql = buildRenumberSectionsSql(contextOf());

      expect(sql).toContain('SET "reftramo_ideuy" = (s.renum_new)::integer');
      expect(sql).toContain('r."id" = s.road_id');
      expect(sql).toContain("s.renum_new IS NOT NULL");
      const assignments = sql.slice(sql.indexOf(" SET ") + 5, sql.indexOf(" FROM "));
      expect(assignments).toBe('"reftramo_ideuy" = (s.renum_new)::integer');
    });
  });

  describe("access_point (EJL-10, EJL-11)", () => {
    it("should move the points of the old reftramo to the new one by updating id_road_section only", () => {
      const sql = buildMovePointsSql(contextOf());

      expect(sql).toMatch(/UPDATE "carto"\."access_point" AS a SET "id_road_section" = \(n\.new_ref\)::character varying/);
      expect(sql).toContain("FROM pg_temp.\"ej_move\" AS n WHERE CASE WHEN NULLIF(btrim(a.\"id_road_section\"::text), '') ~ '^[0-9]+$' THEN (NULLIF(btrim(a.\"id_road_section\"::text), ''))::numeric::text ELSE NULLIF(btrim(a.\"id_road_section\"::text), '') END = n.old_ref");
      expect(sql).not.toMatch(/\bDELETE\b|\bINSERT\b/i);
      expect(sql.match(/SET /g)).toHaveLength(1);
    });

    it("should never emit a write on access_point or on the vertices table other than the move", () => {
      const context = contextOf();
      const statements = [
        buildInsertWaysSql(context),
        buildInsertMastersSql(context),
        buildInsertSectionsSql(context),
        buildUpdateIdcalleSql(context),
        buildUpdateTypeSql(context),
        buildUpdateFontSql(context),
        buildUpdateGeometrySql(context),
        buildRenumberSectionsSql(context),
      ];

      for (const sql of statements) {
        expect(sql).not.toContain("access_point");
        expect(sql).not.toContain("vertices");
      }
    });
  });

  describe("section delete guards (EJ-21, EJS-10)", () => {
    const ACCESS_POINT_GUARD = 'NOT EXISTS (SELECT 1 FROM "carto"."access_point" AS a WHERE ';
    const canonicalAccessPoint = 'CASE WHEN NULLIF(btrim(a."id_road_section"::text), \'\') ~ \'^[0-9]+$\' THEN (NULLIF(btrim(a."id_road_section"::text), \'\'))::numeric::text ELSE NULLIF(btrim(a."id_road_section"::text), \'\') END';

    it("should delete only the applied sections, guarded by a reftramo NOT EXISTS on access_point", () => {
      const sql = buildDeleteSectionsSql(contextOf());

      expect(sql).toMatch(/^WITH "written" AS \(DELETE FROM "carto"\."road_section" AS r USING pg_temp\."ej_del" AS d WHERE r\."[a-z_]+" = d\.road_id/);
      expect(sql).toContain(`AND ${ACCESS_POINT_GUARD}${canonicalAccessPoint} = d.ref)`);
    });

    it("should also refuse the delete of a section whose road_section.id an access point holds, with a second NOT EXISTS", () => {
      const sql = buildDeleteSectionsSql(contextOf());

      expect(sql).toContain(`AND ${ACCESS_POINT_GUARD}${canonicalAccessPoint} = d.road_id::text)`);
      expect(sql.split(ACCESS_POINT_GUARD)).toHaveLength(3);
    });

    it("should never write access_point from the delete statement", () => {
      const sql = buildDeleteSectionsSql(contextOf());

      expect(sql).not.toMatch(/\bUPDATE\b|\bINSERT\b/i);
      expect(sql).not.toMatch(/DELETE FROM "carto"\."access_point"/);
    });
  });

  describe("revert SQL (EJL-4)", () => {
    it("should keep the order restored vertices, masters, restored sections, sections, points, inserts, created vertices (EJ-28)", () => {
      expect(REVERT_ORDER).toEqual([
        "ej_rev_vertices_del",
        "ej_rev_masters",
        "ej_rev_restore",
        "ej_rev_sections",
        "ej_rev_points",
        "ej_rev_inserts",
        "ej_rev_vertices_new",
      ]);
    });

    it("should restore every column the load can change, including reftramo_ideuy", () => {
      const sql = buildRevertSectionsSql(contextOf(), ejesLayouts());

      for (const column of ["reftramo_ideuy", "id_circulation_way", "id_road_section_type", "id_font", "source", "target", "distance", "geometry"]) {
        expect(sql).toContain(`'"${column}"'`);
      }
      expect(sql).toContain("s.renum_old IS NOT NULL");
      expect(sql).toMatch(/CREATE TEMP TABLE "ej_rev_sections" ON COMMIT DROP AS/);
    });

    it("should restore access_point.id_road_section by id and never delete access points", () => {
      const sql = buildRevertPointsSql(contextOf(), ejesLayouts());

      expect(sql).toContain("UPDATE %s SET %s = %L WHERE %s IN (%s);");
      expect(sql).toContain("'\"id_road_section\"'");
      expect(sql).not.toMatch(/DELETE/i);
    });

    it("should delete the inserted ids in the order sections, masters, ways", () => {
      const sql = buildRevertInsertsSql(contextOf());

      const section = sql.indexOf("'\"carto\".\"road_section\"'");
      const master = sql.indexOf("'\"carto\".\"addresses_master\"'");
      const way = sql.indexOf("'\"carto\".\"circulation_way\"'");
      expect(section).toBeGreaterThan(-1);
      expect(master).toBeGreaterThan(section);
      expect(way).toBeGreaterThan(master);
      expect(sql).not.toContain("access_point");
    });

    it("should page by a keyset cursor", () => {
      expect(buildRevertPageSql("ej_rev_sections", 500, false)).toBe(
        'SELECT n::text AS "cursor", line AS "line" FROM pg_temp."ej_rev_sections" ORDER BY n LIMIT 500'
      );
      expect(buildRevertPageSql("ej_rev_sections", 500, true)).toContain("WHERE n > $1::bigint");
    });

    it("should count the lines of a revert table", () => {
      expect(buildRevertCountSql("ej_rev_points")).toBe('SELECT count(*) AS "total" FROM pg_temp."ej_rev_points"');
    });
  });

  describe("selection plan SQL", () => {
    it("should join renumbered pairs as they are, with the old and new reftramo", () => {
      const sql = buildPairTableSql();

      expect(sql).toContain("n.old_ref, n.new_ref");
      expect(sql).toContain("c.ref = n.new_ref");
    });

    it("should count inserted, updated, renumbered, points moved, ways and surplus", () => {
      const sql = buildLoadCountsSql();

      for (const alias of ["inserted", "updated", "idcalle", "type", "font", "geom", "renumbered", "points_moved", "ways", "surplus"]) {
        expect(sql).toContain(`AS "${alias}"`);
      }
    });

    it("should limit the renumbered and surplus lists", () => {
      expect(buildRenumberedListSql(25)).toMatch(/LIMIT 25$/);
      expect(buildSurplusListSql(25)).toMatch(/LIMIT 25$/);
    });
  });

  describe("way input rows", () => {
    it("should compute the short_name of the new name", () => {
      expect(newWayOf({ idcalle: 5, name: "AVENIDA ITALIA", type_id: "4", font_id: "1" })).toEqual({
        idcalle: "5",
        name: "AVENIDA ITALIA",
        shortName: "AV ITALIA",
        typeId: "4",
        fontId: "1",
      });
    });

    it("should keep a null name, short_name, type and font as null", () => {
      expect(newWayOf({ idcalle: "5", name: null, type_id: null, font_id: null })).toEqual({
        idcalle: "5",
        name: null,
        shortName: null,
        typeId: null,
        fontId: null,
      });
    });

    it("should write NULL for missing values and escape quotes", () => {
      const [sql] = buildInsertWayInputSql([{ idcalle: "5", name: "O'HIGGINS", shortName: "O'HIGGINS", typeId: null, fontId: null }]);

      expect(sql).toBe(`INSERT INTO "ej_way_in" (idcalle, name, short_name, type_id, font_id) VALUES ('5', 'O''HIGGINS', 'O''HIGGINS', NULL, NULL)`);
    });

    it("should return no statement for no ways", () => {
      expect(buildInsertWayInputSql([])).toEqual([]);
    });

    it("should split the insert in chunks of LOAD_CHUNK_SIZE rows", () => {
      const ways = Array.from({ length: LOAD_CHUNK_SIZE + 1 }, (_, index) => ({
        idcalle: String(index),
        name: `V${index}`,
        shortName: `V${index}`,
        typeId: "4",
        fontId: "1",
      }));

      const statements = buildInsertWayInputSql(ways);

      expect(statements).toHaveLength(2);
      expect(statements[0].match(/\('/g)).toHaveLength(LOAD_CHUNK_SIZE);
      expect(statements[1].match(/\('/g)).toHaveLength(1);
    });

    it("should keep exactly one statement at the chunk boundary", () => {
      const ways = Array.from({ length: LOAD_CHUNK_SIZE }, (_, index) => ({
        idcalle: String(index),
        name: null,
        shortName: null,
        typeId: null,
        fontId: null,
      }));

      expect(buildInsertWayInputSql(ways)).toHaveLength(1);
    });
  });
});
