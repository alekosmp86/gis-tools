import { describe, expect, it } from "vitest";
import {
  EJES_MAP_ITEMS_LIMIT,
  EJES_MAP_STATEMENT_TIMEOUT,
  newSectionOutlineSql,
  oldSectionOutlineSql,
  zoneOutlineSql,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/geometryMap";
import { TWIN_PADRON_DISTANCE_M } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";

const ROAD_SECTION: TableLayout = {
  schema: "carto",
  table: "road_section",
  columns: { reftramo_ideuy: "reftramo_ideuy", id_circulation_way: "id_circulation_way", geometry: "geometry" },
};

const STAGING: TableLayout = {
  schema: "bdj_carto",
  table: "ide_ejesviacirculacion",
  columns: { reftramo: "reftramo", idcalle: "idcalle", geom: "geom" },
};

const PADRONES: TableLayout = {
  schema: "carto",
  table: "padron",
  columns: { type_padron: "type_padron", geometry: "geometry" },
};

describe("ejes geometry map", () => {
  it("should limit a request to 30 outlines with a 20 s statement timeout", () => {
    expect(EJES_MAP_ITEMS_LIMIT).toBe(30);
    expect(EJES_MAP_STATEMENT_TIMEOUT).toBe("20s");
  });

  describe("oldSectionOutlineSql", () => {
    const sql = oldSectionOutlineSql(ROAD_SECTION);

    it("should read the section by its reftramo_ideuy through a parameter", () => {
      expect(sql).toContain('FROM "carto"."road_section"');
      expect(sql).toContain('"reftramo_ideuy" = $1');
    });

    it("should return a simplified WGS84 outline and skip a section without geometry", () => {
      expect(sql).toContain("ST_Transform(ST_SimplifyPreserveTopology(");
      expect(sql).toContain("4326");
      expect(sql).toContain('"geometry" IS NOT NULL');
    });

    it("should only read", () => {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
    });
  });

  describe("newSectionOutlineSql", () => {
    const sql = newSectionOutlineSql(STAGING);

    it("should find the staging row by its trimmed reftramo through a parameter", () => {
      expect(sql).toContain('FROM "bdj_carto"."ide_ejesviacirculacion" AS s');
      expect(sql).toContain('trim(s."reftramo"::text) = $1');
    });

    it("should take one row, because rows that share a reftramo share the geometry", () => {
      expect(sql).toMatch(/LIMIT 1$/);
    });

    it("should label the geometry as the ejes SRID before it goes to WGS84", () => {
      expect(sql).toContain('ST_SetSRID(s."geom", 32721)');
      expect(sql).toContain("4326");
    });

    it("should skip a row with an empty or null geometry", () => {
      expect(sql).toContain('s."geom" IS NOT NULL');
      expect(sql).toContain('NOT ST_IsEmpty(s."geom")');
    });
  });

  describe("zoneOutlineSql (ET-7)", () => {
    const sql = zoneOutlineSql(STAGING, PADRONES);

    it("should read the padrones table and the staging section, with the reftramo and the type as parameters", () => {
      expect(sql).toContain('FROM "carto"."padron" AS p');
      expect(sql).toContain('FROM "bdj_carto"."ide_ejesviacirculacion" AS s');
      expect(sql).toContain('trim(s."reftramo"::text) = $1');
      expect(sql).toContain("= $2::text");
    });

    it("should compare the padron type trimmed and in upper case", () => {
      expect(sql).toContain('upper(btrim(p."type_padron"::text)) = $2::text');
    });

    it("should keep the padrones within TWIN_PADRON_DISTANCE_M of the section with ST_DWithin on the padron geometry", () => {
      expect(TWIN_PADRON_DISTANCE_M).toBe(15);
      expect(sql).toContain('ST_DWithin(p."geometry", (');
      expect(sql).toContain(`), ${TWIN_PADRON_DISTANCE_M})`);
    });

    it("should dissolve the padrones into one outline, simplified like the others and in WGS84", () => {
      expect(sql).toContain('ST_Transform(ST_SimplifyPreserveTopology(ST_Union(ST_MakeValid(p."geometry")), 2), 4326)');
      expect(sql).toContain('AS "geojson"');
    });

    it("should make each padron geometry valid before the union, and keep ST_DWithin on the raw padron geometry", () => {
      expect(sql).toContain('ST_Union(ST_MakeValid(p."geometry"))');
      expect(sql).not.toContain('ST_Union(p."geometry")');
      expect(sql).toContain('ST_DWithin(p."geometry", (');
    });

    it("should label the staging geometry as the ejes SRID, take one row and skip an empty or null geometry", () => {
      expect(sql).toContain('ST_SetSRID(s."geom", 32721)');
      expect(sql).toContain("LIMIT 1)");
      expect(sql).toContain('s."geom" IS NOT NULL');
      expect(sql).toContain('NOT ST_IsEmpty(s."geom")');
    });

    it("should return no row when no padron is near", () => {
      expect(sql).toMatch(/HAVING count\(\*\) > 0$/);
    });

    it("should use the physical column names of the layout and only read", () => {
      const renamed = zoneOutlineSql(STAGING, { schema: "x", table: "p2", columns: { type_padron: "tipo", geometry: "the_geom" } });

      expect(renamed).toContain('p."the_geom"');
      expect(renamed).toContain('p."tipo"');
      expect(renamed).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
    });
  });
});
