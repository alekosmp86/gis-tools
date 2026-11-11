import { describe, expect, it } from "vitest";
import {
  CENTROS_DEFAULT_TABLES,
  CENTROS_REQUIRED_COLUMNS_BY_ROLE,
  CENTROS_ROLES,
  CENTROS_STAGING_NOTE,
  CENTROS_WFS_URL,
} from "@/modules/routine-jobs/jobs/centros-anep/constants";
import { CENTROS_STEP, plannedCentrosStepLabels } from "@/modules/routine-jobs/jobs/centros-anep/domain/plannedSteps";
import {
  compareWithFinal,
  toCentrosFinalCounts,
  toCentrosStagingReport,
} from "@/modules/routine-jobs/jobs/centros-anep/domain/reportMapping";
import {
  assertDistinctCentrosTables,
  labelOfCentrosTable,
  labelsOfCentrosTables,
} from "@/modules/routine-jobs/jobs/centros-anep/domain/tableRoles";
import { centrosTables, cleanStaging } from "./centrosFixtures";

describe("centros-anep constants and table roles (CA-4)", () => {
  it("should default to the staging and final tables of the spec", () => {
    expect(CENTROS_DEFAULT_TABLES["centros-anep-staging"]).toEqual({ schema: "bdj_carto", table: "ine_centros_anep" });
    expect(CENTROS_DEFAULT_TABLES["centros-anep-final"]).toEqual({ schema: "carto", table: "ine_centros_anep" });
    expect(CENTROS_ROLES).toHaveLength(2);
  });

  it("should require ruee, subsistema, nombre and geom in both roles", () => {
    for (const role of CENTROS_ROLES) {
      expect([...CENTROS_REQUIRED_COLUMNS_BY_ROLE[role]]).toEqual(["ruee", "subsistema", "nombre", "geom"]);
    }
  });

  it("should expose the WFS download URL and the staging note of the spec (CA-16)", () => {
    expect(CENTROS_WFS_URL).toBe(
      "https://mapas.ide.uy/geoserver-vectorial/INE_NO_SEGURO_CLON_NS/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=INE_NO_SEGURO_CLON_NS:centros_anep_2&outputFormat=SHAPE-ZIP"
    );
    expect(CENTROS_STAGING_NOTE).toBe(
      "Antes de correr este trabajo, cargue la tabla de staging con DB vs. Shapefile (Reemplazo completo) desde el shapefile del WFS de IDEuy"
    );
  });

  it("should label tables as schema.table", () => {
    expect(labelOfCentrosTable(centrosTables(), "centros-anep-final")).toContain("carto");
    expect(labelsOfCentrosTables(centrosTables())["centros-anep-staging"]).toContain("bdj_carto");
  });
});

describe("assertDistinctCentrosTables (CA-6)", () => {
  it("should accept the default distinct tables", () => {
    expect(() => assertDistinctCentrosTables({ tables: centrosTables() })).not.toThrow();
  });

  it("should accept the same table name in different schemas", () => {
    const tables = centrosTables();
    tables["centros-anep-staging"] = { schema: "stg", table: "ine_centros_anep" };

    expect(() => assertDistinctCentrosTables({ tables })).not.toThrow();
  });

  it("should throw in Spanish when staging and final are the same table", () => {
    const tables = centrosTables();
    tables["centros-anep-staging"] = { ...tables["centros-anep-final"] };

    expect(() => assertDistinctCentrosTables({ tables })).toThrow(/no pueden ser la misma tabla/);
  });
});

describe("plannedCentrosStepLabels (CA-3, CA-11, CA-13)", () => {
  it("should plan only read steps for a dry run", () => {
    const labels = plannedCentrosStepLabels({ dryRun: true });

    expect(labels).toEqual([CENTROS_STEP.VALIDATE, CENTROS_STEP.PRIVILEGES, CENTROS_STEP.STAGING, CENTROS_STEP.COMPARE]);
  });

  it("should plan lock, backup, delete, insert, analyze and commit in order for a real run", () => {
    const labels = plannedCentrosStepLabels({ dryRun: false });

    expect(labels).toEqual([
      CENTROS_STEP.VALIDATE,
      CENTROS_STEP.PRIVILEGES,
      CENTROS_STEP.LOCK,
      CENTROS_STEP.STAGING,
      CENTROS_STEP.COMPARE,
      CENTROS_STEP.BACKUP,
      CENTROS_STEP.DELETE,
      CENTROS_STEP.INSERT,
      CENTROS_STEP.ANALYZE,
      CENTROS_STEP.COMMIT,
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("toCentrosStagingReport and toCentrosFinalCounts (CA-8)", () => {
  it("should map counts, subsistema groups and repeated ruee from SQL rows", () => {
    const report = toCentrosStagingReport(
      {
        rows: "2902",
        by_subsistema: [
          { value: "CEIP", rows: 2269 },
          { value: null, rows: "2" },
        ],
        empty_geometry: "1",
        null_ruee: 2,
        null_subsistema: 2,
        repeated_groups: 3,
        repeated_rows: "6",
        repeated_ruee: [{ ruee: 1234, rows: 2 }],
        damaged_text_rows: 4,
      },
      7
    );

    expect(report).toEqual({
      rows: 2902,
      bySubsistema: [
        { value: "CEIP", rows: 2269 },
        { value: null, rows: 2 },
      ],
      emptyGeometry: 1,
      nullRuee: 2,
      nullSubsistema: 2,
      repeatedGroups: 3,
      repeatedRows: 6,
      repeatedRuee: [{ ruee: "1234", rows: 2 }],
      damagedTextRows: 4,
      unsupportedSridRows: 7,
    });
  });

  it("should map an empty row to zero counts and empty lists", () => {
    const report = toCentrosStagingReport({}, 0);

    expect(report).toMatchObject({ rows: 0, bySubsistema: [], repeatedRuee: [], emptyGeometry: 0, damagedTextRows: 0 });
  });

  it("should map the final counts", () => {
    expect(toCentrosFinalCounts({ rows: "3", by_subsistema: [{ value: "CES", rows: 3 }] })).toEqual({
      rows: 3,
      bySubsistema: [{ value: "CES", rows: 3 }],
    });
    expect(toCentrosFinalCounts({})).toEqual({ rows: 0, bySubsistema: [] });
  });
});

describe("compareWithFinal (CA-9)", () => {
  it("should report current, after and difference by subsistema over the union of values", () => {
    const comparison = compareWithFinal(
      {
        rows: 10,
        bySubsistema: [
          { value: "CEIP", rows: 6 },
          { value: "OLD", rows: 4 },
        ],
      },
      cleanStaging({
        rows: 9,
        bySubsistema: [
          { value: "CEIP", rows: 8 },
          { value: "CES", rows: 1 },
        ],
      })
    );

    expect(comparison.currentRows).toBe(10);
    expect(comparison.afterRows).toBe(9);
    expect(comparison.bySubsistema).toEqual([
      { value: "CEIP", current: 6, after: 8, difference: 2 },
      { value: "CES", current: 0, after: 1, difference: 1 },
      { value: "OLD", current: 4, after: 0, difference: -4 },
    ]);
  });

  it("should sort a NULL subsistema last", () => {
    const comparison = compareWithFinal(
      { rows: 1, bySubsistema: [{ value: null, rows: 1 }] },
      cleanStaging({ rows: 1, bySubsistema: [{ value: "CES", rows: 1 }] })
    );

    expect(comparison.bySubsistema.map((entry) => entry.value)).toEqual(["CES", null]);
  });

  it("should compare an empty final table with the whole staging", () => {
    const comparison = compareWithFinal({ rows: 0, bySubsistema: [] }, cleanStaging());

    expect(comparison.currentRows).toBe(0);
    expect(comparison.afterRows).toBe(2902);
    expect(comparison.bySubsistema.every((entry) => entry.current === 0 && entry.difference === entry.after)).toBe(true);
    expect(comparison.bySubsistema.map((entry) => entry.value)).toEqual(["CEIP", "CES", "CETP", "CFE"]);
  });

  it("should return no rows when both sides are empty", () => {
    const comparison = compareWithFinal({ rows: 0, bySubsistema: [] }, cleanStaging({ rows: 0, bySubsistema: [] }));

    expect(comparison).toEqual({ currentRows: 0, afterRows: 0, bySubsistema: [] });
  });
});
