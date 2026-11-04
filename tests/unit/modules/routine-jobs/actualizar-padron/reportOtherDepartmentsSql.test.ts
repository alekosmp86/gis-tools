import { describe, expect, it } from "vitest";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, LOCALITY_TYPE_COLUMN, OTHER_DEPARTMENTS_LIMIT, PROVINCE_COLUMN, SKIP_REASON, STAGING_COLUMN } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import { toReportView } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportMapping";
import { buildReportSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportSql";
import type { PadronLayouts } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

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

describe("buildReportSql other departments (AP-119)", () => {
  it("should compute the otherDepartments array only for the not found reason", () => {
    const sql = buildReportSql(layoutsOf());

    expect(sql).toContain(`CASE WHEN "ranked"."reason" = '${SKIP_REASON.LOCALIDAD_NO_ENCONTRADA}' THEN ARRAY(`);
    expect(sql).not.toContain(`"ranked"."reason" = '${SKIP_REASON.LOCALIDAD_AMBIGUA}'`);
    expect(sql).toContain(`END AS "otherDepartments"`);
  });

  it("should cap the list at the other departments limit of 5", () => {
    const sql = buildReportSql(layoutsOf());

    expect(OTHER_DEPARTMENTS_LIMIT).toBe(5);
    expect(sql).toContain("LIMIT 5)");
  });

  it("should exclude the department of the row itself and match the name by upper case", () => {
    const sql = buildReportSql(layoutsOf());

    expect(sql).toContain(`upper("loc"."name") = upper("ranked"."locality")`);
    expect(sql).toContain(`upper("prov"."name") <> upper("ranked"."department")`);
  });

  it("should add the locality type filter to the other departments query when a locality type id is set", () => {
    const sql = buildReportSql(layoutsOf(7));

    expect(sql).toContain(`upper("prov"."name") <> upper("ranked"."department") AND "loc"."id_territorial_unit_type" = 7`);
  });

  it("should leave the locality type filter out of the other departments query when no locality type id is set", () => {
    const sql = buildReportSql(layoutsOf());

    expect(sql).not.toContain(`upper("ranked"."department") AND "loc"."id_territorial_unit_type"`);
  });
});

describe("toReportView otherDepartments of byLocalityAndReason (AP-119)", () => {
  const groupRow = (extra: Record<string, unknown>) => ({
    department: "CANELONES",
    locality: "NUEVA HELVECIA",
    reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA,
    count: "3",
    ...extra,
  });
  const groupsOf = (extra: Record<string, unknown>) => toReportView({ byLocalityAndReason: [groupRow(extra)] }).skipped.byLocalityAndReason;

  it("should map an array to a list of texts", () => {
    const groups = groupsOf({ otherDepartments: ["COLONIA", "ROCHA"] });

    expect(groups).toEqual([
      { department: "CANELONES", locality: "NUEVA HELVECIA", reason: SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, count: 3, otherDepartments: ["COLONIA", "ROCHA"] },
    ]);
  });

  it("should keep an empty array as an empty list", () => {
    expect(groupsOf({ otherDepartments: [] })[0].otherDepartments).toEqual([]);
  });

  it("should omit the key when the value is null", () => {
    expect(groupsOf({ otherDepartments: null })[0]).not.toHaveProperty("otherDepartments");
  });

  it("should omit the key when the field is missing", () => {
    expect(groupsOf({})[0]).not.toHaveProperty("otherDepartments");
  });
});
