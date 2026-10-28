import { describe, expect, it } from "vitest";
import { parseCompletarUnidadTerritorialStartRequest } from "@/modules/routine-jobs/api/completarUnidadTerritorialRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { CONFIRM_REQUIRED_MESSAGE } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/services/preflight";
import { COMPLETAR_PASSWORD } from "./completarFixtures";

const UNIT = { schema: "carto", table: "territorial_unit" };
const ADDRESS_MASTER = { schema: "carto", table: "addresses_master" };

type Body = Record<string, unknown>;

const connectionBody = (overrides: Body = {}): Body => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "gis_user",
  password: COMPLETAR_PASSWORD,
  ...overrides,
});

const startBody = (overrides: Body = {}): Body => ({
  connection: connectionBody(),
  unitSchema: UNIT.schema,
  unitTable: UNIT.table,
  addressMasterSchema: ADDRESS_MASTER.schema,
  addressMasterTable: ADDRESS_MASTER.table,
  dryRun: true,
  confirm: false,
  ...overrides,
});

const realRunBody = (overrides: Body = {}): Body => startBody({ dryRun: false, confirm: true, ...overrides });

const parse = (body: Body) => parseCompletarUnidadTerritorialStartRequest(body as Parameters<typeof parseCompletarUnidadTerritorialStartRequest>[0]);

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
  expect(messageOf(body)).not.toContain(COMPLETAR_PASSWORD);
}

describe("parseCompletarUnidadTerritorialStartRequest", () => {
  describe("valid bodies", () => {
    it("should return the params of a dry run with the four tables and the connection mapped", () => {
      const params = parse(startBody());

      expect(params).toMatchObject({
        unitSchema: UNIT.schema,
        unitTable: UNIT.table,
        addressMasterSchema: ADDRESS_MASTER.schema,
        addressMasterTable: ADDRESS_MASTER.table,
        dryRun: true,
        confirm: false,
        config: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user" },
      });
    });

    it("should keep the password of the connection for the run", () => {
      expect(parse(startBody()).config.password).toBe(COMPLETAR_PASSWORD);
    });

    it("should accept a real run when confirm is true", () => {
      const params = parse(realRunBody());

      expect(params.dryRun).toBe(false);
      expect(params.confirm).toBe(true);
    });

    it("should accept an empty password string because local databases may have none", () => {
      expect(parse(startBody({ connection: connectionBody({ password: "" }) })).config.password).toBe("");
    });

    it("should accept the same table name in different schemas as distinct tables", () => {
      const params = parse(startBody({ addressMasterSchema: "otro_esquema", addressMasterTable: UNIT.table }));

      expect(params.addressMasterSchema).toBe("otro_esquema");
    });
  });

  describe("connection and password", () => {
    it("should reject a request without the password field", () => {
      const body = startBody();
      delete (body.connection as Body).password;

      expectRejected(body, /password/);
    });

    it("should reject a password that is not text", () => {
      expectRejected(startBody({ connection: connectionBody({ password: 12345 }) }), /password debe ser texto/);
    });

    it("should reject a request without a connection object", () => {
      const body = startBody();
      delete body.connection;

      expectRejected(body, /connection/);
    });

    it("should reject a blank database name", () => {
      expectRejected(startBody({ connection: connectionBody({ db_name: "  " }) }), /db_name/);
    });
  });

  describe("tables", () => {
    it.each(["unitSchema", "unitTable", "addressMasterSchema", "addressMasterTable"])(
      "should reject a request with the missing table field %s",
      (field) => {
        const body = startBody();
        delete body[field];

        expectRejected(body, field);
      },
    );

    it("should reject a blank unit table name made only of whitespace", () => {
      expectRejected(startBody({ unitTable: "   " }), "unitTable");
    });

    it("should reject when the address master table repeats the unit table", () => {
      expectRejected(startBody({ addressMasterSchema: UNIT.schema, addressMasterTable: UNIT.table }), /distintas/);
    });

    it("should reject a table field sent as a number", () => {
      expectRejected(startBody({ unitTable: 7 }), "unitTable");
    });
  });

  describe("confirm", () => {
    it("should refuse a real run without confirm with the confirmation message", () => {
      expectRejected(realRunBody({ confirm: false }), CONFIRM_REQUIRED_MESSAGE);
    });

    it("should allow a dry run without confirm", () => {
      expect(() => parse(startBody({ dryRun: true, confirm: false }))).not.toThrow();
    });

    it("should reject a non-boolean confirm", () => {
      expectRejected(startBody({ dryRun: false, confirm: "true" }), /confirm/);
    });

    it("should reject a non-boolean dryRun", () => {
      expectRejected(startBody({ dryRun: "no" }), /dryRun/);
    });

    it("should reject a body without the dryRun flag", () => {
      const body = startBody();
      delete body.dryRun;

      expectRejected(body, /dryRun/);
    });
  });
});
