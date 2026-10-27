import { describe, it, expect } from "vitest";
import { parseCargarLocalidadesStartRequest } from "@/modules/routine-jobs/api/cargarLocalidadesRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { CONFIRM_REQUIRED_MESSAGE } from "@/modules/routine-jobs/jobs/cargar-localidades/services/preflight";

const PASSWORD = "Lo-cal!pw";
const PADRON_STAGING = "padron_stg";
const LOCALITY_STAGING = "localidades_stg";
const PROVINCE = "province";
const TARGET = { schema: "carto", table: "cadastral_locality" };
const SECOND_TARGET = { schema: "carto", table: "cadastral_locality_2" };
const THIRD_TARGET = { schema: "carto", table: "cadastral_locality_3" };

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
  stagingSchema: "stg",
  padronTable: PADRON_STAGING,
  localityStagingTable: LOCALITY_STAGING,
  provinceSchema: "carto",
  provinceTable: PROVINCE,
  targets: [{ ...TARGET }],
  options: { tolerance: 1, updateGeometries: false },
  dryRun: true,
  confirm: false,
  ...overrides,
});

const realRunBody = (overrides: Body = {}): Body => startBody({ dryRun: false, confirm: true, ...overrides });

const parse = (body: Body) => parseCargarLocalidadesStartRequest(body as Parameters<typeof parseCargarLocalidadesStartRequest>[0]);

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

describe("parseCargarLocalidadesStartRequest", () => {
  describe("valid bodies", () => {
    it("should return the params of a dry run with the targets, options and connection mapped", () => {
      const params = parse(startBody());

      expect(params).toMatchObject({
        stagingSchema: "stg",
        padronTable: PADRON_STAGING,
        localityStagingTable: LOCALITY_STAGING,
        provinceSchema: "carto",
        provinceTable: PROVINCE,
        targets: [TARGET],
        options: { tolerance: 1, updateGeometries: false },
        dryRun: true,
        confirm: false,
      });
      expect(params.config).toMatchObject({ host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD });
    });

    it("should return the params of a real run when confirm is true", () => {
      expect(parse(realRunBody())).toMatchObject({ dryRun: false, confirm: true });
    });
  });

  describe("targets count (0, 1, 2, 3)", () => {
    it("should answer 400 naming targets when the list is empty", () => {
      expectRejected(startBody({ targets: [] }), /targets/);
    });

    it("should accept exactly one target", () => {
      expect(parse(startBody({ targets: [TARGET] })).targets).toEqual([TARGET]);
    });

    it("should accept exactly two distinct targets, in the order sent", () => {
      expect(parse(startBody({ targets: [TARGET, SECOND_TARGET] })).targets).toEqual([TARGET, SECOND_TARGET]);
    });

    it("should answer 400 naming targets when three targets are sent", () => {
      expectRejected(startBody({ targets: [TARGET, SECOND_TARGET, THIRD_TARGET] }), /targets/);
    });

    it("should answer 400 naming targets when the targets field is missing", () => {
      const body = startBody();
      delete body.targets;

      expectRejected(body, /targets/);
    });

    it("should answer 400 naming targets when the targets field is an object instead of a list", () => {
      expectRejected(startBody({ targets: TARGET }), /targets/);
    });

    it("should answer 400 when a target entry is not an object", () => {
      expectRejected(startBody({ targets: ["carto.cadastral_locality"] }), /destino 1/);
    });

    it("should answer 400 naming the table when a target entry has no table", () => {
      expectRejected(startBody({ targets: [{ schema: "carto" }] }), /table/);
    });

    it("should answer 400 when a target entry has a blank schema", () => {
      expectRejected(startBody({ targets: [{ schema: "  ", table: "cadastral_locality" }] }), /schema/);
    });
  });

  describe("repeated tables", () => {
    it("should answer 400 naming the table when two targets are the same schema.table", () => {
      expectRejected(startBody({ targets: [TARGET, { ...TARGET }] }), /carto\.cadastral_locality/);
    });

    it("should accept two targets with the same table name in different schemas", () => {
      const other = { schema: "otra", table: TARGET.table };

      expect(parse(startBody({ targets: [TARGET, other] })).targets).toEqual([TARGET, other]);
    });

    it("should answer 400 naming the table when a target repeats the padron table", () => {
      expectRejected(startBody({ targets: [{ schema: "stg", table: PADRON_STAGING }] }), /stg\.padron_stg/);
    });

    it("should answer 400 naming the table when a target repeats the province table", () => {
      expectRejected(startBody({ targets: [{ schema: "carto", table: PROVINCE }] }), /carto\.province/);
    });
  });

  describe("tolerance", () => {
    it.each([
      ["zero", 0],
      ["a fraction", 0.5],
    ])("should accept %s as the tolerance", (_label, tolerance) => {
      expect(parse(startBody({ options: { tolerance, updateGeometries: false } })).options.tolerance).toBe(tolerance);
    });

    it.each([
      ["a negative integer", -1],
      ["a negative fraction", -0.0001],
      ["a numeric text", "1"],
      ["a non-numeric text", "abc"],
      ["null", null],
      ["a boolean", true],
    ])("should answer 400 naming tolerance when the tolerance is %s", (_label, tolerance) => {
      expectRejected(startBody({ options: { tolerance, updateGeometries: false } }), /tolerance/);
    });

    it("should answer 400 naming tolerance when the tolerance is missing", () => {
      expectRejected(startBody({ options: { updateGeometries: false } }), /tolerance/);
    });

    it("should answer 400 naming options when the options object is missing", () => {
      const body = startBody();
      delete body.options;

      expectRejected(body, /options/);
    });

    it("should answer 400 naming updateGeometries when it is not a boolean", () => {
      expectRejected(startBody({ options: { tolerance: 1, updateGeometries: "true" } }), /updateGeometries/);
    });
  });

  describe("dryRun and confirm", () => {
    it("should answer 400 naming confirm when a real run omits confirm", () => {
      const body = realRunBody();
      delete body.confirm;

      expectRejected(body, /confirm/);
    });

    it("should answer 400 with the confirmation message when a real run has confirm false", () => {
      expect(messageOf(realRunBody({ confirm: false }))).toBe(CONFIRM_REQUIRED_MESSAGE);
    });

    it("should accept a dry run without confirm", () => {
      expect(parse(startBody({ dryRun: true, confirm: false }))).toMatchObject({ dryRun: true, confirm: false });
    });

    it("should answer 400 naming dryRun when dryRun is the string true", () => {
      expectRejected(startBody({ dryRun: "true" }), /dryRun/);
    });

    it("should answer 400 naming confirm when confirm is the string true", () => {
      expectRejected(startBody({ confirm: "true" }), /confirm/);
    });
  });
});
