import { describe, expect, it } from "vitest";
import { parseCentrosAnepStartRequest } from "@/modules/routine-jobs/api/centrosAnepRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { CENTROS_CONFIRM_REQUIRED_MESSAGE } from "@/modules/routine-jobs/jobs/centros-anep/constants";
import { centrosTablesBody } from "../centros-anep/centrosFixtures";

const PASSWORD = "Cen-tros!pw";

type Body = Record<string, unknown>;

const startBody = (overrides: Body = {}): Body => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  tables: centrosTablesBody(),
  dryRun: true,
  confirm: false,
  ...overrides,
});

const parse = (body: Body) => parseCentrosAnepStartRequest(body as Parameters<typeof parseCentrosAnepStartRequest>[0]);

function messageOf(body: Body): string {
  try {
    parse(body);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("parseCentrosAnepStartRequest", () => {
  it("should return the params of a dry run with config, two tables and the password (CA-3)", () => {
    const params = parse(startBody());

    expect(params.dryRun).toBe(true);
    expect(params.confirm).toBe(false);
    expect(params.config).toMatchObject({ host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD });
    expect(params.tables["centros-anep-staging"]).toEqual({ schema: "bdj_carto", table: "ine_centros_anep" });
    expect(params.tables["centros-anep-final"]).toEqual({ schema: "carto", table: "ine_centros_anep" });
  });

  it("should reject a body whose confirm flag is missing because the client always sends it", () => {
    const body = startBody();
    delete body.confirm;

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });

  it("should accept a real run with confirm true", () => {
    const params = parse(startBody({ dryRun: false, confirm: true }));

    expect(params.dryRun).toBe(false);
    expect(params.confirm).toBe(true);
  });

  it("CA-10: should reject a real run without confirmation with the spec message", () => {
    expect(() => parse(startBody({ dryRun: false, confirm: false }))).toThrow(RequestInvalidError);
    expect(messageOf(startBody({ dryRun: false, confirm: false }))).toBe(CENTROS_CONFIRM_REQUIRED_MESSAGE);
  });

  it("should never leak the password in an error message", () => {
    expect(messageOf(startBody({ dryRun: false, confirm: false }))).not.toContain(PASSWORD);
  });

  it.each([
    ["missing", undefined],
    ["a string", "true"],
    ["null", null],
    ["a number", 1],
  ])("should reject a dryRun that is %s", (_label, value) => {
    const body = startBody();
    if (value === undefined) delete body.dryRun;
    else body.dryRun = value;

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });

  it("should reject staging and final that are the same table, in Spanish", () => {
    const tables = centrosTablesBody();
    tables["centros-anep-final"] = { ...tables["centros-anep-staging"] };

    expect(() => parse(startBody({ tables }))).toThrow(RequestInvalidError);
    expect(messageOf(startBody({ tables }))).toMatch(/misma tabla|distintas/);
  });

  it("should accept the same table name in different schemas", () => {
    const tables = centrosTablesBody();
    tables["centros-anep-final"] = { schema: "otro", table: tables["centros-anep-staging"].table };

    expect(() => parse(startBody({ tables }))).not.toThrow();
  });

  it("should reject a body without the tables record", () => {
    const body = startBody();
    delete body.tables;

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });

  it("should reject a missing role entry", () => {
    const tables: Body = { ...centrosTablesBody() };
    delete tables["centros-anep-final"];

    expect(() => parse(startBody({ tables }))).toThrow(RequestInvalidError);
  });

  it.each([
    ["blank table", { schema: "carto", table: "   " }],
    ["blank schema", { schema: "", table: "t" }],
    ["numeric table", { schema: "carto", table: 5 }],
  ])("should reject a %s", (_label, entry) => {
    const tables: Body = { ...centrosTablesBody(), "centros-anep-final": entry };

    expect(() => parse(startBody({ tables }))).toThrow(RequestInvalidError);
  });

  it("should reject a missing connection", () => {
    const body = startBody();
    delete body.connection;

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });

  it("should reject a connection with an empty host", () => {
    const body = startBody({ connection: { host: "", port: "5432", db_name: "gis", user: "u", password: PASSWORD } });

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });

  it("should reject a connection without password", () => {
    const body = startBody({ connection: { host: "h", port: "5432", db_name: "gis", user: "u" } });

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });
});
