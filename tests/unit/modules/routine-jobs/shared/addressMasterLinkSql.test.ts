import { describe, expect, it } from "vitest";
import {
  buildAddressMasterApplySql,
  buildAddressMasterClassifySql,
  buildAddressMasterRemainingSql,
  type AddressMasterLinkLayouts,
} from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSql";
import { PADRON_SUBJECT_SPEC } from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSpec";

const identityOf = (columns: readonly string[]): Record<string, string> =>
  Object.fromEntries(columns.map((column) => [column, column]));

const padronLayouts: AddressMasterLinkLayouts = {
  subject: { schema: "carto", table: "padron", columns: identityOf(PADRON_SUBJECT_SPEC.requiredColumns) },
  addressMaster: {
    schema: "carto",
    table: "addresses_master",
    columns: identityOf(["addresses_master_id", "urn", "latitud", "longitud"]),
  },
};

const STATEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["classify", buildAddressMasterClassifySql(padronLayouts, PADRON_SUBJECT_SPEC)],
  ["apply", buildAddressMasterApplySql(padronLayouts, PADRON_SUBJECT_SPEC)],
  ["remaining", buildAddressMasterRemainingSql(padronLayouts, PADRON_SUBJECT_SPEC)],
];

describe("addressMasterLinkSql padron subject", () => {
  it.each(STATEMENTS)("should never delete or truncate in the %s statement", (_label, sql) => {
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE)\b/i);
  });

  it("should insert only the urn and the two coordinates, never the address master id", () => {
    const sql = buildAddressMasterApplySql(padronLayouts, PADRON_SUBJECT_SPEC);

    expect(sql).toContain(`INSERT INTO "carto"."addresses_master" ("urn", "latitud", "longitud")`);
  });

  it("should build the urn from the padron prefix and the padron id", () => {
    const sql = buildAddressMasterClassifySql(padronLayouts, PADRON_SUBJECT_SPEC);

    expect(sql).toContain(`concat('cgeo:padron:id:', sj."id") AS "urn"`);
  });

  it("should update only id_address_master, and only where it is still NULL", () => {
    const sql = buildAddressMasterApplySql(padronLayouts, PADRON_SUBJECT_SPEC);

    expect(sql).toContain(`UPDATE "carto"."padron" AS sj SET "id_address_master" = lk."address_master_id"`);
    expect(sql).toContain(`AND sj."id_address_master" IS NULL`);
    expect(sql).not.toMatch(/SET\s+"id"\s*=/);
  });

  it("should count the padrones still without an address master as the remaining check", () => {
    expect(buildAddressMasterRemainingSql(padronLayouts, PADRON_SUBJECT_SPEC)).toBe(
      `SELECT count(*) AS "remaining" FROM "carto"."padron" AS sj WHERE sj."id_address_master" IS NULL`
    );
  });
});
