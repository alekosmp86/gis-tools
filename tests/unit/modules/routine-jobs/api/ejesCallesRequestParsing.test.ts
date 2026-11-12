import { describe, expect, it } from "vitest";
import { parseEjesCallesStartRequest } from "@/modules/routine-jobs/api/ejesCallesRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { REAL_RUN_UNAVAILABLE_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ejesTablesBody } from "../ejes-calles/ejesFixtures";

const PASSWORD = "Ej-es!pw";

type Body = Record<string, unknown>;

const startBody = (overrides: Body = {}): Body => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  tables: ejesTablesBody(),
  dryRun: true,
  ...overrides,
});

const parse = (body: Body) => parseEjesCallesStartRequest(body as Parameters<typeof parseEjesCallesStartRequest>[0]);

function messageOf(body: Body): string {
  try {
    parse(body);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("parseEjesCallesStartRequest", () => {
  it("should return the params of a dry run with config and nine tables", () => {
    const params = parse(startBody());

    expect(params.dryRun).toBe(true);
    expect(params.config).toMatchObject({ host: "db.local", port: "5432", db_name: "gis", user: "gis_user" });
    expect(Object.keys(params.tables)).toHaveLength(9);
    expect(params.tables["ejes-origen"]).toEqual({ schema: "bdj_carto", table: "ide_ejesviacirculacion" });
  });

  it("EJ-3: should refuse dryRun false with the spec message", () => {
    expect(() => parse(startBody({ dryRun: false }))).toThrow(RequestInvalidError);
    expect(messageOf(startBody({ dryRun: false }))).toBe("La carga real de ejes de calles todavía no está disponible.");
    expect(REAL_RUN_UNAVAILABLE_MESSAGE).toBe("La carga real de ejes de calles todavía no está disponible.");
  });

  it("EJ-3: should refuse dryRun false even with a confirm flag", () => {
    expect(messageOf(startBody({ dryRun: false, confirm: true }))).toBe(REAL_RUN_UNAVAILABLE_MESSAGE);
  });

  it("should never leak the password in the error message", () => {
    expect(messageOf(startBody({ dryRun: false }))).not.toContain(PASSWORD);
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

  it("EJ-5: should reject two roles that are the same table", () => {
    const tables = ejesTablesBody();
    tables["ejes-vias"] = { ...tables["ejes-tramos"] };

    expect(() => parse(startBody({ tables }))).toThrow(RequestInvalidError);
    expect(messageOf(startBody({ tables }))).toMatch(/distinta/);
  });

  it("should reject a body without the tables record", () => {
    const body = startBody();
    delete body.tables;

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });

  it("should reject a missing role entry", () => {
    const tables: Body = { ...ejesTablesBody() };
    delete tables["ejes-accesos"];

    expect(() => parse(startBody({ tables }))).toThrow(RequestInvalidError);
  });

  it("should reject a blank table name", () => {
    const tables = ejesTablesBody();
    tables["ejes-origen"] = { schema: "bdj_carto", table: "  " };

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
});
