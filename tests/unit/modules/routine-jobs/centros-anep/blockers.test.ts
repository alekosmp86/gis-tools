import { describe, expect, it } from "vitest";
import {
  EMPTY_STAGING_BLOCKER,
  stagingBlockersOf,
  stagingWarningsOf,
} from "@/modules/routine-jobs/jobs/centros-anep/domain/blockers";
import { geometrySridIssues } from "@/modules/routine-jobs/jobs/centros-anep/domain/geometryIssues";
import { cleanStaging } from "./centrosFixtures";

describe("stagingBlockersOf (CA-8)", () => {
  it("should return no blockers for the clean 2,902-row staging", () => {
    expect(stagingBlockersOf(cleanStaging())).toEqual([]);
  });

  it("should block an empty staging", () => {
    expect(stagingBlockersOf(cleanStaging({ rows: 0, bySubsistema: [] }))).toEqual([EMPTY_STAGING_BLOCKER]);
  });

  it("should block any NULL or empty geometry and count the rows", () => {
    const blockers = stagingBlockersOf(cleanStaging({ emptyGeometry: 1 }));

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("1 fila tiene");
    expect(stagingBlockersOf(cleanStaging({ emptyGeometry: 5 }))[0]).toContain("5 filas tienen");
  });

  it("should block U+FFFD damaged text", () => {
    const blockers = stagingBlockersOf(cleanStaging({ damagedTextRows: 3 }));

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("3 filas");
    expect(blockers[0]).toContain("�");
  });

  it("should block geometries with SRID 0 or unknown (CA-7)", () => {
    const blockers = stagingBlockersOf(cleanStaging({ unsupportedSridRows: 2 }));

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("SRID");
  });

  it("should never block on repeated ruee, NULL ruee or NULL subsistema", () => {
    const report = cleanStaging({ repeatedGroups: 3, repeatedRows: 6, nullRuee: 4, nullSubsistema: 2 });

    expect(stagingBlockersOf(report)).toEqual([]);
  });

  it("should accumulate several blockers", () => {
    const report = cleanStaging({ rows: 0, emptyGeometry: 1, damagedTextRows: 1, unsupportedSridRows: 1 });

    expect(stagingBlockersOf(report)).toHaveLength(4);
  });
});

describe("stagingWarningsOf (CA-8)", () => {
  it("should return no warnings for clean staging", () => {
    expect(stagingWarningsOf(cleanStaging())).toEqual([]);
  });

  it("should warn about repeated ruee with groups and rows (3 groups, 6 rows)", () => {
    const warnings = stagingWarningsOf(cleanStaging({ repeatedGroups: 3, repeatedRows: 6 }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("3 ruee se repiten");
    expect(warnings[0]).toContain("6 filas");
  });

  it("should use singular wording for one repeated group", () => {
    expect(stagingWarningsOf(cleanStaging({ repeatedGroups: 1, repeatedRows: 2 }))[0]).toContain("1 ruee se repite");
  });

  it("should warn about NULL ruee and NULL subsistema", () => {
    const warnings = stagingWarningsOf(cleanStaging({ nullRuee: 1, nullSubsistema: 2 }));

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("ruee nulo");
    expect(warnings[1]).toContain("subsistema nulo");
  });

  it("should not turn blockers into warnings", () => {
    expect(stagingWarningsOf(cleanStaging({ emptyGeometry: 4, damagedTextRows: 4, rows: 0 }))).toEqual([]);
  });
});

describe("geometrySridIssues (CA-7)", () => {
  it("should flag a column that is not a geometry", () => {
    expect(geometrySridIssues("carto.t", "geom", undefined)).toEqual([expect.stringContaining("no es de tipo geometría")]);
  });

  it("should flag a geometry column without SRID (typmod 0)", () => {
    const issues = geometrySridIssues("carto.t", "geom", { typeName: "POINT", srid: 0 });

    expect(issues).toEqual([expect.stringContaining("no tiene SRID")]);
  });

  it("should accept a column with SRID 32721", () => {
    expect(geometrySridIssues("carto.t", "geom", { typeName: "POINT", srid: 32721 })).toEqual([]);
  });
});
