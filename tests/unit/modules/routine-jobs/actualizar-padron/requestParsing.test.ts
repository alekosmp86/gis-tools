import { describe, it, expect } from "vitest";
import { parseActualizarStartRequest } from "@/modules/routine-jobs/api/actualizarRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";

const PASSWORD = "Ac7ual!zar-pw";

type Body = Record<string, unknown>;

const startBody = (overrides: Body = {}): Body => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  stagingSchema: "stg",
  stagingTable: "catastro_paispadron_stg",
  cartoSchema: "carto",
  targetTable: "padron_tmp_actualizacion",
  provinceTable: "province",
  localityTable: "cadastral_locality",
  options: { tolerance: 1, updateGeometries: true, linkAddressMaster: false },
  dryRun: true,
  confirm: false,
  ...overrides,
});

const withTolerance = (tolerance: unknown): Body => startBody({ options: { tolerance, updateGeometries: true, linkAddressMaster: false } });

function errorOf(body: Body): Error {
  try {
    parseActualizarStartRequest(body as Parameters<typeof parseActualizarStartRequest>[0]);
  } catch (error: unknown) {
    return error as Error;
  }
  throw new Error("expected the request to be rejected");
}

function expectRejected(body: Body, mention: RegExp): void {
  const error = errorOf(body);
  expect(error).toBeInstanceOf(RequestInvalidError);
  expect(error.message).toMatch(mention);
  expect(error.message).not.toContain(PASSWORD);
}

describe("parseActualizarStartRequest", () => {
  describe("happy path", () => {
    it("should map the two schemas, the five tables and the options of a dry run into the params", () => {
      const params = parseActualizarStartRequest(startBody() as Parameters<typeof parseActualizarStartRequest>[0]);

      expect(params).toMatchObject({
        stagingSchema: "stg",
        stagingTable: "catastro_paispadron_stg",
        cartoSchema: "carto",
        targetTable: "padron_tmp_actualizacion",
        provinceTable: "province",
        localityTable: "cadastral_locality",
        options: { tolerance: 1, updateGeometries: true, linkAddressMaster: false },
        dryRun: true,
        confirm: false,
      });
      expect(params.config.password).toBe(PASSWORD);
    });

    it("should refuse a real run without confirm, with the confirmation message", () => {
      expectRejected(startBody({ dryRun: false, confirm: false }), /^Confirme la actualización de padrones/);
    });
  });

  describe("target table", () => {
    it("should reject a request without targetTable, naming the field", () => {
      const body = startBody();
      delete body.targetTable;

      expectRejected(body, /targetTable/);
    });

    it("should reject a blank targetTable made only of whitespace", () => {
      expectRejected(startBody({ targetTable: "   " }), /targetTable/);
    });

    it("should reject a target table that repeats the staging table in the same schema", () => {
      expectRejected(startBody({ stagingSchema: "carto", stagingTable: "padron_tmp_actualizacion" }), /distint|misma tabla/);
    });
  });

  describe("tolerance", () => {
    it("should accept a tolerance of exactly 0 as the lower boundary", () => {
      const params = parseActualizarStartRequest(withTolerance(0) as Parameters<typeof parseActualizarStartRequest>[0]);

      expect(params.options.tolerance).toBe(0);
    });

    it.each([
      ["a negative tolerance", -0.5],
      ["a NaN tolerance", Number.NaN],
      ["a tolerance sent as text", "1"],
      ["a missing tolerance", undefined],
    ])("should reject %s with a message naming tolerance", (_label, tolerance) => {
      expectRejected(withTolerance(tolerance), /tolerance/);
    });
  });
});
