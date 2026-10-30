import { describe, it, expect, vi } from "vitest";
import { parseUnidadTerritorialStartRequest } from "@/modules/routine-jobs/api/unidadTerritorialRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { ADDRESS_MASTER_TOGGLE_MISMATCH_MESSAGE } from "@/modules/routine-jobs/jobs/shared/addressMasterLinkSpec";
import { CONFIRM_REQUIRED_MESSAGE } from "@/modules/routine-jobs/jobs/unidad-territorial/services/preflight";
import { runUnidadTerritorial } from "@/modules/routine-jobs/jobs/unidad-territorial/services/runUnidadTerritorial";

const PASSWORD = "Unidad-pw!7";
const LOCALITY = { schema: "stg", table: "localidades_catastrales_stg" };
const TYPE = { schema: "carto", table: "tipo_unidad" };
const TARGET = { schema: "carto", table: "territorial_unit" };

type Body = Record<string, unknown>;

const connectionBody = (): Record<string, unknown> => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "gis_user",
  password: PASSWORD,
});

const startBody = (overrides: Body = {}): Body => ({
  connection: connectionBody(),
  localitySchema: LOCALITY.schema,
  localityTable: LOCALITY.table,
  typeSchema: TYPE.schema,
  typeTable: TYPE.table,
  targetSchema: TARGET.schema,
  targetTable: TARGET.table,
  options: { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: true },
  dryRun: true,
  confirm: false,
  ...overrides,
});

const realRunBody = (overrides: Body = {}): Body => startBody({ dryRun: false, confirm: true, ...overrides });

const parse = (body: Body) => parseUnidadTerritorialStartRequest(body as Parameters<typeof parseUnidadTerritorialStartRequest>[0]);

function messageOf(body: Body): string {
  try {
    parse(body);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

function expectRejected(body: Body, mention: RegExp | string): void {
  expect(() => parse(body)).toThrow(RequestInvalidError);
  expect(messageOf(body)).toMatch(typeof mention === "string" ? new RegExp(mention) : mention);
  expect(messageOf(body)).not.toContain(PASSWORD);
}

describe("parseUnidadTerritorialStartRequest", () => {
  describe("valid bodies", () => {
    it("should return the params of a dry run with the tables, options and connection mapped", () => {
      const params = parse(startBody());

      expect(params).toMatchObject({
        localitySchema: LOCALITY.schema,
        localityTable: LOCALITY.table,
        typeSchema: TYPE.schema,
        typeTable: TYPE.table,
        targetSchema: TARGET.schema,
        targetTable: TARGET.table,
        options: { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: true },
        dryRun: true,
        confirm: false,
      });
      expect(params.config.password).toBe(PASSWORD);
    });

    it("should accept a real run when confirm is true", () => {
      const params = parse(realRunBody());

      expect(params.dryRun).toBe(false);
      expect(params.confirm).toBe(true);
    });

    it("should accept a tolerance of exactly 0 as the lower boundary", () => {
      const params = parse(startBody({ options: { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 0, updateGeometries: false } }));

      expect(params.options.tolerance).toBe(0);
    });

    it("should accept the same table name in different schemas as distinct tables", () => {
      const params = parse(startBody({ targetSchema: "otro_esquema", targetTable: TYPE.table }));

      expect(params.targetSchema).toBe("otro_esquema");
    });
  });

  describe("tables", () => {
    it.each(["localitySchema", "localityTable", "typeSchema", "typeTable", "targetSchema", "targetTable"])(
      "should reject a request with the missing table field %s",
      (field) => {
        const body = startBody();
        delete body[field];

        expectRejected(body, field);
      }
    );

    it("should reject a blank table name made only of whitespace", () => {
      expectRejected(startBody({ typeTable: "   " }), "typeTable");
    });

    it("should reject when the target repeats the locality table", () => {
      expectRejected(startBody({ targetSchema: LOCALITY.schema, targetTable: LOCALITY.table }), /distintas/);
    });

    it("should reject when the type table repeats the target table", () => {
      expectRejected(startBody({ typeSchema: TARGET.schema, typeTable: TARGET.table }), /distintas/);
    });

    it("should reject when the locality table repeats the type table", () => {
      expectRejected(startBody({ localitySchema: TYPE.schema, localityTable: TYPE.table }), /distintas/);
    });
  });

  describe("options", () => {
    it("should reject a negative tolerance", () => {
      expectRejected(startBody({ options: { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: -0.5, updateGeometries: true } }), /tolerance/);
    });

    it("should reject a tolerance sent as text instead of a number", () => {
      expectRejected(startBody({ options: { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: "1", updateGeometries: true } }), /tolerance/);
    });

    it("should reject a request without an options object", () => {
      const body = startBody();
      delete body.options;

      expectRejected(body, /options/);
    });

    it("should reject a blank locality type name", () => {
      expectRejected(startBody({ options: { localityTypeName: " ", tolerance: 1, updateGeometries: true } }), /localityTypeName/);
    });
  });

  describe("confirm", () => {
    it("should refuse a real run without confirm with the confirmation message", () => {
      expectRejected(realRunBody({ confirm: false }), CONFIRM_REQUIRED_MESSAGE);
    });

    it("should reject a non-boolean confirm", () => {
      expectRejected(startBody({ dryRun: false, confirm: "true" }), /confirm/);
    });

    it("should reject a non-boolean dryRun", () => {
      expectRejected(startBody({ dryRun: "no" }), /dryRun/);
    });

    it("should allow a dry run without confirm", () => {
      expect(() => parse(startBody({ dryRun: true, confirm: false }))).not.toThrow();
    });
  });
});

describe("address master link option (UT-11)", () => {
  const ADDRESS_MASTER = { schema: "carto", table: "addresses_master" };
  const LINKED_OPTIONS = { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: true, linkAddressMaster: true };
  const OFF_OPTIONS = { ...LINKED_OPTIONS, linkAddressMaster: false };

  it("should default the link off, carry the nested address master table only when the link is on, and refuse a toggle that disagrees with the table at run time", async () => {
    const absent = parse(startBody());
    expect(absent.options.linkAddressMaster).toBe(false);
    expect(absent.addressMasterTable).toBeUndefined();

    const linked = parse(startBody({ options: LINKED_OPTIONS, addressMasterTable: ADDRESS_MASTER }));
    expect(linked.options.linkAddressMaster).toBe(true);
    expect(linked.addressMasterTable).toEqual(ADDRESS_MASTER);

    const dropped = parse(startBody({ options: OFF_OPTIONS, addressMasterTable: ADDRESS_MASTER }));
    expect(dropped.addressMasterTable).toBeUndefined();

    const rejected: ReadonlyArray<readonly [string, Body, RegExp]> = [
      ["a linked option without the nested table", startBody({ options: LINKED_OPTIONS }), /addressMasterTable/],
      ["a linked option with a blank table name", startBody({ options: LINKED_OPTIONS, addressMasterTable: { schema: "carto", table: " " } }), /table/],
      ["a non-boolean link option", startBody({ options: { ...LINKED_OPTIONS, linkAddressMaster: "true" } }), /linkAddressMaster/],
    ];
    for (const [, body, mention] of rejected) {
      expectRejected(body, mention);
    }

    const deps = { openSession: vi.fn(), now: () => 0 };
    await expect(runUnidadTerritorial({ ...linked, addressMasterTable: undefined }, deps)).rejects.toThrow(
      ADDRESS_MASTER_TOGGLE_MISMATCH_MESSAGE,
    );
    await expect(runUnidadTerritorial({ ...dropped, addressMasterTable: ADDRESS_MASTER }, deps)).rejects.toThrow(
      ADDRESS_MASTER_TOGGLE_MISMATCH_MESSAGE,
    );
    expect(deps.openSession).not.toHaveBeenCalled();
  });
});
