import { describe, expect, it } from "vitest";
import {
  columnInfoOf,
  columnPlanBlockers,
  isDefaultFilled,
  planColumns,
  textColumnsOf,
} from "@/modules/routine-jobs/jobs/centros-anep/domain/columnPlan";
import { column, finalCatalog, GEOM_TYPE, stagingCatalog } from "./centrosFixtures";

const plan = (overrides: Partial<Parameters<typeof planColumns>[0]> = {}) =>
  planColumns({
    stagingCatalog: stagingCatalog(),
    finalCatalog: finalCatalog(),
    stagingGeometry: "geom",
    finalGeometry: "geom",
    identityColumns: [],
    ...overrides,
  });

describe("planColumns (CA-5)", () => {
  it("should copy every common column by name, geometry first, and skip the serial id", () => {
    const result = plan();

    expect(result.pairs.map((pair) => pair.target)).toEqual(["geom", "ruee", "x", "y", "subsistema", "nombre", "depto", "rule_est"]);
    expect(result.pairs[0]).toEqual({ source: "geom", target: "geom", isGeometry: true });
    expect(result.pairs.slice(1).every((pair) => !pair.isGeometry && pair.source === pair.target)).toBe(true);
    expect(result.pairs.map((pair) => pair.target)).not.toContain("id");
  });

  it("should report no blocker and no info for the spec DDL (id serial only in final)", () => {
    const result = plan();

    expect(columnPlanBlockers(result, "carto.f", "bdj.s")).toEqual([]);
    expect(columnInfoOf(result, "carto.f")).toEqual([]);
    expect(result.missingInStaging).toEqual([]);
    expect(result.requiredWithoutValue).toEqual([]);
  });

  it("should exclude a common column that the final fills by default (serial) and list it as skipped", () => {
    const staged = [...stagingCatalog(), column("id", "integer")];

    const result = plan({ stagingCatalog: staged });

    expect(result.skippedDefaults).toEqual(["id"]);
    expect(result.pairs.map((pair) => pair.target)).not.toContain("id");
    expect(result.missingInFinal).toEqual([]);
  });

  it("should exclude an identity column of the final table", () => {
    const final = [column("gid", "integer", { is_nullable: false }), ...stagingCatalog()];

    const result = plan({ finalCatalog: final, identityColumns: ["gid"] });

    expect(result.pairs.map((pair) => pair.target)).not.toContain("gid");
    expect(result.missingInStaging).toEqual([]);
    expect(result.requiredWithoutValue).toEqual([]);
  });

  it("should list staging columns missing in final as one blocker naming them", () => {
    const final = finalCatalog().filter((entry) => entry.column_name !== "depto");
    const staged = [...stagingCatalog(), column("telefono", "text")];

    const result = plan({ stagingCatalog: staged, finalCatalog: final });
    const blockers = columnPlanBlockers(result, "carto.f", "bdj.s");

    expect(result.missingInFinal).toEqual(["depto", "telefono"]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('"depto", "telefono"');
    expect(blockers[0]).toContain("carto.f");
  });

  it("should block a same-name column whose type differs between staging and final", () => {
    const final = finalCatalog().map((entry) => (entry.column_name === "ruee" ? column("ruee", "text") : entry));

    const result = plan({ finalCatalog: final });
    const blockers = columnPlanBlockers(result, "carto.f", "bdj.s");

    expect(result.typeMismatches).toEqual([{ column: "ruee", stagingType: "double precision", finalType: "text" }]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('"ruee"');
    expect(blockers[0]).toContain("double precision");
    expect(blockers[0]).toContain("text");
  });

  it("should report a final extra nullable column as information, not as a blocker", () => {
    const final = [...finalCatalog(), column("observacion", "text")];

    const result = plan({ finalCatalog: final });

    expect(result.missingInStaging).toEqual(["observacion"]);
    expect(result.requiredWithoutValue).toEqual([]);
    expect(columnPlanBlockers(result, "carto.f", "bdj.s")).toEqual([]);
    expect(columnInfoOf(result, "carto.f")).toEqual([expect.stringContaining('"observacion"')]);
  });

  it("should block a final extra NOT NULL column without default and still list it as information", () => {
    const final = [...finalCatalog(), column("regla", "text", { is_nullable: false })];

    const result = plan({ finalCatalog: final });

    expect(result.requiredWithoutValue).toEqual(["regla"]);
    expect(columnPlanBlockers(result, "carto.f", "bdj.s")).toEqual([expect.stringContaining('"regla"')]);
    expect(columnInfoOf(result, "carto.f")).toHaveLength(1);
  });

  it("should accept a final extra NOT NULL column that has a default", () => {
    const final = [...finalCatalog(), column("estado", "text", { is_nullable: false, column_default: "'A'::text" })];

    const result = plan({ finalCatalog: final });

    expect(result.requiredWithoutValue).toEqual([]);
    expect(result.missingInStaging).toEqual(["estado"]);
  });

  it("should map geometry columns that have different physical names", () => {
    const staged = stagingCatalog().map((entry) => (entry.column_name === "geom" ? column("wkb_geometry", GEOM_TYPE) : entry));
    const final = finalCatalog().map((entry) => (entry.column_name === "geom" ? column("the_geom", GEOM_TYPE) : entry));

    const result = plan({ stagingCatalog: staged, finalCatalog: final, stagingGeometry: "wkb_geometry", finalGeometry: "the_geom" });

    expect(result.pairs[0]).toEqual({ source: "wkb_geometry", target: "the_geom", isGeometry: true });
    expect(result.missingInFinal).toEqual([]);
  });

  it("should return only the geometry pair for empty catalogs", () => {
    const result = plan({ stagingCatalog: [], finalCatalog: [] });

    expect(result.pairs).toHaveLength(1);
    expect(result.missingInFinal).toEqual([]);
    expect(result.missingInStaging).toEqual([]);
  });
});

describe("isDefaultFilled and textColumnsOf", () => {
  it("should detect serial defaults and identity columns only", () => {
    expect(isDefaultFilled(column("id", "integer", { column_default: "nextval('s.t_id_seq'::regclass)" }), [])).toBe(true);
    expect(isDefaultFilled(column("gid", "integer"), ["gid"])).toBe(true);
    expect(isDefaultFilled(column("nombre", "text", { column_default: "'x'::text" }), [])).toBe(false);
    expect(isDefaultFilled(column("nombre", "text"), [])).toBe(false);
  });

  it("should list only text-like columns", () => {
    const catalog = [
      column("a", "text"),
      column("b", "character varying"),
      column("c", "character varying(20)"),
      column("d", "double precision"),
      column("e", "USER-DEFINED"),
      column("f", "bpchar"),
      column("g", "integer"),
    ];

    expect(textColumnsOf(catalog)).toEqual(["a", "b", "c", "f"]);
  });

  it("should return an empty list for an empty catalog", () => {
    expect(textColumnsOf([])).toEqual([]);
  });
});
