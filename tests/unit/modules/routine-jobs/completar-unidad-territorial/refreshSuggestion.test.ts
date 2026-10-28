import { describe, expect, it } from "vitest";
import { buildRefreshViewStatement } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/domain/refreshSuggestion";
import { TERRITORIAL_UNIT_VIEW_NAME } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/constants";

describe("buildRefreshViewStatement", () => {
  it("should name the schema chosen for the unit table and the view constant, both quoted", () => {
    expect(buildRefreshViewStatement("carto")).toBe(`REFRESH MATERIALIZED VIEW "carto"."${TERRITORIAL_UNIT_VIEW_NAME}";`);
  });

  it("should use the fixed view name mv_territorial_unit_full", () => {
    expect(TERRITORIAL_UNIT_VIEW_NAME).toBe("mv_territorial_unit_full");
  });

  it("should fall back to the public schema when the unit schema is blank", () => {
    expect(buildRefreshViewStatement("   ")).toBe(`REFRESH MATERIALIZED VIEW "public"."${TERRITORIAL_UNIT_VIEW_NAME}";`);
  });

  it("should keep the exact spelling of a schema name with upper case letters", () => {
    expect(buildRefreshViewStatement("Carto")).toBe(`REFRESH MATERIALIZED VIEW "Carto"."${TERRITORIAL_UNIT_VIEW_NAME}";`);
  });

  it("should quote a schema name with a space and escape a double quote inside it", () => {
    expect(buildRefreshViewStatement('mi "esquema"')).toBe(
      `REFRESH MATERIALIZED VIEW "mi ""esquema"""."${TERRITORIAL_UNIT_VIEW_NAME}";`,
    );
  });

  it("should produce a single statement terminated by one semicolon", () => {
    const statement = buildRefreshViewStatement("carto");

    expect(statement.endsWith(";")).toBe(true);
    expect(statement.slice(0, -1)).not.toContain(";");
  });
});
