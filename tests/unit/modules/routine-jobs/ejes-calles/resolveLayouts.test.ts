import { describe, expect, it } from "vitest";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import {
  EJES_DEFAULT_TABLES,
  EJES_REQUIRED_COLUMNS_BY_ROLE,
  EJES_TABLE_ROLE,
  EJES_WRITE_ROLES,
  type EjesTableRole,
} from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { padronSridIssuesOf, resolveEjesLayouts, sridIssuesOf } from "@/modules/routine-jobs/jobs/ejes-calles/services/resolveLayouts";
import type { EjesParams } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesTables } from "./ejesFixtures";

type Row = Record<string, unknown>;

const GEOMETRY_COLUMN_BY_ROLE: Partial<Record<EjesTableRole, string>> = {
  [EJES_TABLE_ROLE.STAGING]: "geom",
  [EJES_TABLE_ROLE.ROAD_SECTION]: "geometry",
  [EJES_TABLE_ROLE.LOCALITIES]: "geom",
  [EJES_TABLE_ROLE.PADRONES]: "geometry",
};

const columnsOf = (role: EjesTableRole, geometryType: string): Row[] =>
  EJES_REQUIRED_COLUMNS_BY_ROLE[role].map((column_name) => ({
    column_name,
    data_type: GEOMETRY_COLUMN_BY_ROLE[role] === column_name ? geometryType : "text",
    is_nullable: true,
    column_default: null,
  }));

/** Every table has its required columns; the geometry type of the padrones table is `padronGeometry`, the others are 32721. */
function sessionOf(padronGeometry: string, missingPadronColumns = false, localitiesGeometry = "geometry(MultiPolygon,32721)"): CatalogQuerySession {
  const roleOfTable = new Map<string, EjesTableRole>(
    (Object.keys(EJES_DEFAULT_TABLES) as EjesTableRole[]).map((role) => [EJES_DEFAULT_TABLES[role].table, role])
  );
  return {
    async query(sql: string, values?: unknown[]) {
      if (!sql.includes("format_type(a.atttypid")) return { rows: [] };
      const role = roleOfTable.get(String(values?.[1]));
      if (role === undefined) return { rows: [] };
      if (role === EJES_TABLE_ROLE.PADRONES) {
        return { rows: missingPadronColumns ? [] : columnsOf(role, padronGeometry) };
      }
      if (role === EJES_TABLE_ROLE.LOCALITIES) return { rows: columnsOf(role, localitiesGeometry) };
      return { rows: columnsOf(role, "geometry(MultiLineString,32721)") };
    },
  } as CatalogQuerySession;
}

const paramsOf = (): EjesParams => ({ tables: ejesTables() }) as unknown as EjesParams;

describe("resolveEjesLayouts ejes-padrones (ET-1)", () => {
  it("should resolve the padrones layout with its type_padron and geometry columns when the SRID is 32721", async () => {
    const { layouts } = await resolveEjesLayouts(sessionOf("geometry(MultiPolygon,32721)"), paramsOf());

    expect(layouts[EJES_TABLE_ROLE.PADRONES]).toEqual({
      schema: "carto",
      table: "padron",
      columns: { type_padron: "type_padron", geometry: "geometry" },
    });
  });

  it("should refuse a generic SRID 0 geometry on the padrones table, naming the table and the SRID", async () => {
    await expect(resolveEjesLayouts(sessionOf("geometry(MultiPolygon,0)"), paramsOf())).rejects.toThrow(
      'La columna "geometry" de la tabla carto.padron tiene SRID 0; debe ser 32721.'
    );
  });

  it("should still accept a generic SRID 0 geometry on the other roles", () => {
    const resolved = {
      label: "bdj_carto.x",
      layout: { schema: "bdj_carto", table: "x", columns: { geom: "geom" } },
      catalog: [],
      dataTypes: { geom: "geometry(MultiLineString,0)" },
      issues: [],
    };

    expect(sridIssuesOf(resolved, "geom")).toEqual([]);
    expect(sridIssuesOf(resolved, "geom", false)).toEqual(['La columna "geom" de la tabla bdj_carto.x tiene SRID 0; debe ser 32721.']);
  });

  it("should export padronSridIssuesOf that accepts exactly 32721 and refuses 0 and others", () => {
    const of = (dataType: string) =>
      padronSridIssuesOf({
        label: "carto.padron",
        layout: { schema: "carto", table: "padron", columns: { geometry: "geometry" } },
        catalog: [],
        dataTypes: { geometry: dataType },
        issues: [],
      });

    expect(of("geometry(MultiPolygon,32721)")).toEqual([]);
    expect(of("geometry(MultiPolygon,0)")).toHaveLength(1);
    expect(of("geometry(MultiPolygon,4326)")).toHaveLength(1);
  });

  it("should refuse a padrones geometry that is not SRID 32721, naming the column and the SRID", async () => {
    await expect(resolveEjesLayouts(sessionOf("geometry(MultiPolygon,4326)"), paramsOf())).rejects.toThrow(
      /"geometry".*carto\.padron.*SRID 4326; debe ser 32721/
    );
  });

  it("should refuse a padrones geometry column that is not of a geometry type", async () => {
    await expect(resolveEjesLayouts(sessionOf("text"), paramsOf())).rejects.toThrow(/no es de tipo geometría/);
  });

  it("should refuse a padrones table that does not exist or has no columns", async () => {
    await expect(resolveEjesLayouts(sessionOf("geometry(MultiPolygon,32721)", true), paramsOf())).rejects.toThrow(
      /carto\.padron.*no existe/
    );
  });

  it("should never list the padrones table among the write targets", async () => {
    const { writeTargets } = await resolveEjesLayouts(sessionOf("geometry(MultiPolygon,32721)"), paramsOf());

    expect(writeTargets).toHaveLength(EJES_WRITE_ROLES.length);
    expect(writeTargets.map((target) => target.table)).not.toContain("padron");
  });
});

describe("resolveEjesLayouts ejes-localidades geometry (ET-12)", () => {
  const OK = "geometry(MultiPolygon,32721)";

  it("should accept a localities geometry of SRID 32721", async () => {
    await expect(resolveEjesLayouts(sessionOf(OK), paramsOf())).resolves.toBeDefined();
  });

  it("should refuse a generic SRID 0 localities geometry, naming the table and the SRID", async () => {
    await expect(resolveEjesLayouts(sessionOf(OK, false, "geometry(MultiPolygon,0)"), paramsOf())).rejects.toThrow(
      "La columna \"geom\" de la tabla bdj_carto.ine_localidades_pg tiene SRID 0; debe ser 32721."
    );
  });

  it("should refuse a localities geometry of another SRID", async () => {
    await expect(resolveEjesLayouts(sessionOf(OK, false, "geometry(MultiPolygon,4326)"), paramsOf())).rejects.toThrow(
      /ine_localidades_pg.*SRID 4326; debe ser 32721/
    );
  });

  it("should still accept a generic SRID 0 on the staging and road section geometry", async () => {
    const session = {
      async query(sql: string, values?: unknown[]) {
        const inner = sessionOf(OK);
        const generic = String(values?.[1]) === "ide_ejesviacirculacion" || String(values?.[1]) === "road_section";
        const answer = await inner.query(sql, values);
        return generic ? { rows: answer.rows.map((row) => ({ ...row, data_type: String(row.data_type).replace("32721", "0") })) } : answer;
      },
    } as CatalogQuerySession;

    await expect(resolveEjesLayouts(session, paramsOf())).resolves.toBeDefined();
  });
});
