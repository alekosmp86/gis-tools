import { describe, expect, it } from "vitest";
import {
  EJES_MAP_ITEMS_LIMIT,
  EJES_MAP_STATEMENT_TIMEOUT,
  newSectionOutlineSql,
  oldSectionOutlineSql,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/geometryMap";
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
});
