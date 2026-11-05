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
  options: { tolerance: 1, updateGeometries: true, repairSequences: true, linkAddressMaster: false },
  dryRun: true,
  confirm: false,
  ...overrides,
});

const withTolerance = (tolerance: unknown): Body => startBody({ options: { tolerance, updateGeometries: true, repairSequences: true, linkAddressMaster: false } });

const withPairChoices = (pairChoices: unknown): Body =>
  startBody({ options: { tolerance: 1, updateGeometries: true, repairSequences: true, linkAddressMaster: false, pairChoices } });

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
        options: { tolerance: 1, updateGeometries: true, repairSequences: true, linkAddressMaster: false },
        dryRun: true,
        confirm: false,
      });
      expect(params.config.password).toBe(PASSWORD);
    });

    it("should refuse a real run without confirm, with the confirmation message", () => {
      expectRejected(startBody({ dryRun: false, confirm: false }), /^Confirme la actualización de padrones/);
    });
  });

  describe("automatic removal (AP-101)", () => {
    it("should ignore a stale removalMarks option sent by an old client, never carrying it into the parsed options", () => {
      const body = startBody({ options: { tolerance: 1, updateGeometries: true, repairSequences: true, linkAddressMaster: false, removalMarks: [500, 600] } });

      const params = parseActualizarStartRequest(body as Parameters<typeof parseActualizarStartRequest>[0]);

      expect(params.options).not.toHaveProperty("removalMarks");
    });

    it("should not reject a malformed removalMarks option, as marks no longer exist", () => {
      const body = startBody({ options: { tolerance: 1, updateGeometries: true, repairSequences: true, linkAddressMaster: false, removalMarks: "not-a-list" } });

      expect(() => parseActualizarStartRequest(body as Parameters<typeof parseActualizarStartRequest>[0])).not.toThrow();
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

  describe("pair choices", () => {
    const parse = (body: Body) => parseActualizarStartRequest(body as Parameters<typeof parseActualizarStartRequest>[0]);

    const VALID_CHOICES = [
      { typePadron: "RURAL", provinceId: 1, localityId: null, number: "501", oldId: 500 },
      { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "200", oldId: null },
    ];

    it("should map well-formed pair choices, a chosen old id and a null no-pair choice, into the options", () => {
      const params = parse(withPairChoices(VALID_CHOICES));

      expect(params.options.pairChoices).toEqual(VALID_CHOICES);
    });

    it("should default the pair choices to an empty list when the request omits them", () => {
      const params = parse(startBody());

      expect(params.options.pairChoices).toEqual([]);
    });

    it("should accept an explicit empty list of pair choices", () => {
      const params = parse(withPairChoices([]));

      expect(params.options.pairChoices).toEqual([]);
    });

    it.each([
      ["a non-array object", { oldId: 500 }],
      ["a text value", "500"],
      ["a null value", null],
    ])("should reject pair choices sent as %s with a message naming pairChoices", (_label, pairChoices) => {
      expectRejected(withPairChoices(pairChoices), /pairChoices/);
    });

    it.each([
      ["an entry that is not an object", [null]],
      ["an entry without the number", [{ typePadron: "RURAL", provinceId: 1, localityId: null, oldId: 500 }]],
      ["an oldId sent as text", [{ typePadron: "RURAL", provinceId: 1, localityId: null, number: "501", oldId: "500" }]],
      ["a provinceId sent as text", [{ typePadron: "RURAL", provinceId: "1", localityId: null, number: "501", oldId: 500 }]],
    ])("should reject a malformed pair choice made of %s with a message naming pairChoices", (_label, pairChoices) => {
      expectRejected(withPairChoices(pairChoices), /pairChoices/);
    });

    it("should reject two choices for the same new key with a message naming pairChoices", () => {
      const duplicateKey = [
        { typePadron: "RURAL", provinceId: 1, localityId: null, number: "501", oldId: 500 },
        { typePadron: "RURAL", provinceId: 1, localityId: null, number: "501", oldId: null },
      ];

      expectRejected(withPairChoices(duplicateKey), /pairChoices/);
    });

    it("should reject the same non-null old id chosen for two new keys with a message naming pairChoices", () => {
      const duplicateOldId = [
        { typePadron: "RURAL", provinceId: 1, localityId: null, number: "501", oldId: 500 },
        { typePadron: "RURAL", provinceId: 1, localityId: null, number: "502", oldId: 500 },
      ];

      expectRejected(withPairChoices(duplicateOldId), /pairChoices/);
    });

    it("should accept the same null old id for two new keys, since null means insert as new", () => {
      const twoNulls = [
        { typePadron: "RURAL", provinceId: 1, localityId: null, number: "501", oldId: null },
        { typePadron: "RURAL", provinceId: 1, localityId: null, number: "502", oldId: null },
      ];

      const params = parse(withPairChoices(twoNulls));

      expect(params.options.pairChoices).toEqual(twoNulls);
    });

    const choiceWith = (overrides: Record<string, unknown>): Record<string, unknown> => ({
      typePadron: "RURAL",
      provinceId: 1,
      localityId: null,
      number: "501",
      oldId: 500,
      ...overrides,
    });

    it.each([
      ["a provinceId above the int4 maximum", { provinceId: 2147483648 }],
      ["a provinceId below the int4 minimum", { provinceId: -2147483649 }],
      ["a localityId above the int4 maximum", { localityId: 2147483648 }],
      ["an oldId above the int4 maximum", { oldId: 2147483648 }],
      ["an oldId below the int4 minimum", { oldId: -2147483649 }],
      ["a fractional oldId", { oldId: 1.5 }],
    ])("should reject a pair choice with %s with a message naming pairChoices", (_label, overrides) => {
      expectRejected(withPairChoices([choiceWith(overrides)]), /pairChoices/);
    });

    it("should accept the int4 boundaries for the ids of a pair choice", () => {
      const choices = [choiceWith({ provinceId: 2147483647, localityId: -2147483648, oldId: -2147483648 })];

      const params = parse(withPairChoices(choices));

      expect(params.options.pairChoices).toEqual(choices);
    });

    it.each([
      ["a lowercase padron type", "rural"],
      ["a padron type outside the two kinds", "OTRO"],
      ["an empty padron type", ""],
    ])("should reject a pair choice with %s with a message naming pairChoices.typePadron", (_label, typePadron) => {
      expectRejected(withPairChoices([choiceWith({ typePadron })]), /pairChoices\.typePadron/);
    });

    it.each(["RURAL", "URBANO"])("should accept a pair choice of padron type %s", (typePadron) => {
      const choices = [choiceWith({ typePadron })];

      const params = parse(withPairChoices(choices));

      expect(params.options.pairChoices).toEqual(choices);
    });

    it("should accept exactly 5000 pair choices, the list limit", () => {
      const choices = Array.from({ length: 5000 }, (_unused, index) => choiceWith({ number: String(index), oldId: null }));

      const params = parse(withPairChoices(choices));

      expect(params.options.pairChoices).toHaveLength(5000);
    });

    it("should reject 5001 pair choices, one above the list limit, with a message naming pairChoices", () => {
      const choices = Array.from({ length: 5001 }, (_unused, index) => choiceWith({ number: String(index), oldId: null }));

      expectRejected(withPairChoices(choices), /pairChoices.*5000/);
    });

    it.each([
      ["a quote and a statement", "1'; DROP TABLE x; --"],
      ["a backslash", "a\\b"],
    ])("should accept a pair choice number holding %s, because the number is escaped in SQL and not validated here", (_label, number) => {
      const choices = [choiceWith({ number })];

      const params = parse(withPairChoices(choices));

      expect(params.options.pairChoices).toEqual(choices);
    });
  });

  describe("geometry area threshold (AP-92)", () => {
    const withThreshold = (geometryAreaThreshold: unknown): Body =>
      startBody({ options: { tolerance: 1, geometryAreaThreshold, updateGeometries: true, repairSequences: true, linkAddressMaster: false } });

    it("should default the geometry area threshold to 0.05 when the option is absent", () => {
      const params = parseActualizarStartRequest(startBody() as Parameters<typeof parseActualizarStartRequest>[0]);

      expect(params.options.geometryAreaThreshold).toBe(0.05);
    });

    it("should keep a threshold given as a fraction from 0 to 1", () => {
      const params = parseActualizarStartRequest(withThreshold(0.125) as Parameters<typeof parseActualizarStartRequest>[0]);

      expect(params.options.geometryAreaThreshold).toBe(0.125);
    });

    it("should answer 400 naming geometryAreaThreshold when the value is above 1, as a percent such as 400 would be", () => {
      expectRejected(withThreshold(400), /geometryAreaThreshold/);
    });
  });

  describe("accepted geometries (AP-100)", () => {
    const parse = (body: Body) => parseActualizarStartRequest(body as Parameters<typeof parseActualizarStartRequest>[0]);

    const withAccepts = (acceptedGeometries: unknown): Body =>
      startBody({ options: { tolerance: 1, updateGeometries: true, repairSequences: true, linkAddressMaster: false, acceptedGeometries } });

    const KEY_URBANO = { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "200" };
    const KEY_RURAL = { typePadron: "RURAL", provinceId: 1, localityId: null, number: "501" };

    const acceptWith = (overrides: Record<string, unknown>): Record<string, unknown> => ({ ...KEY_RURAL, ...overrides });

    it("should default the accepted geometries to an empty list when the request omits them", () => {
      const params = parse(startBody());

      expect(params.options.acceptedGeometries).toEqual([]);
    });

    it("should accept an explicit empty list of accepted geometries", () => {
      const params = parse(withAccepts([]));

      expect(params.options.acceptedGeometries).toEqual([]);
    });

    it("should map well-formed accepted keys, an URBANO key with its locality and a RURAL key with a null locality", () => {
      const accepts = [KEY_URBANO, KEY_RURAL];

      const params = parse(withAccepts(accepts));

      expect(params.options.acceptedGeometries).toEqual(accepts);
    });

    it("should accept the same number in two localities, because the key carries the locality", () => {
      const accepts = [KEY_URBANO, { ...KEY_URBANO, localityId: 11 }];

      const params = parse(withAccepts(accepts));

      expect(params.options.acceptedGeometries).toEqual(accepts);
    });

    it.each([
      ["a non-array object", { typePadron: "URBANO" }],
      ["a text value", "200"],
      ["a null value", null],
    ])("should reject accepted geometries sent as %s with a message naming acceptedGeometries", (_label, value) => {
      expectRejected(withAccepts(value), /acceptedGeometries/);
    });

    it.each([
      ["an entry that is not an object", [null]],
      ["an entry without the number", [{ typePadron: "RURAL", provinceId: 1, localityId: null }]],
      ["a blank number", [acceptWith({ number: "   " })]],
      ["a provinceId sent as text", [acceptWith({ provinceId: "1" })]],
    ])("should reject a malformed accepted geometry made of %s with a message naming acceptedGeometries", (_label, value) => {
      expectRejected(withAccepts(value), /acceptedGeometries/);
    });

    it("should reject the same key accepted twice with a message naming acceptedGeometries", () => {
      expectRejected(withAccepts([KEY_RURAL, { ...KEY_RURAL }]), /acceptedGeometries/);
    });

    it.each([
      ["a provinceId above the int4 maximum", { provinceId: 2147483648 }],
      ["a localityId below the int4 minimum", { localityId: -2147483649 }],
      ["a fractional provinceId", { provinceId: 1.5 }],
    ])("should reject an accepted geometry with %s with a message naming acceptedGeometries", (_label, overrides) => {
      expectRejected(withAccepts([acceptWith(overrides)]), /acceptedGeometries/);
    });

    it.each([
      ["a lowercase padron type", "rural"],
      ["a padron type outside the two kinds", "OTRO"],
      ["an empty padron type", ""],
    ])("should reject an accepted geometry with %s naming acceptedGeometries.typePadron", (_label, typePadron) => {
      expectRejected(withAccepts([acceptWith({ typePadron })]), /acceptedGeometries\.typePadron/);
    });

    it("should accept exactly 5000 accepted geometries, the list limit", () => {
      const accepts = Array.from({ length: 5000 }, (_unused, index) => acceptWith({ number: String(index) }));

      const params = parse(withAccepts(accepts));

      expect(params.options.acceptedGeometries).toHaveLength(5000);
    });

    it("should reject 5001 accepted geometries, one above the list limit, with a message naming acceptedGeometries and 5000", () => {
      const accepts = Array.from({ length: 5001 }, (_unused, index) => acceptWith({ number: String(index) }));

      expectRejected(withAccepts(accepts), /acceptedGeometries.*5000/);
    });
  });
});

describe("parseActualizarStartRequest accept all geometries (AP-116)", () => {
  const parse = (body: Body) => parseActualizarStartRequest(body as Parameters<typeof parseActualizarStartRequest>[0]);

  const withFlag = (acceptAllGeometries: unknown): Body =>
    startBody({ options: { tolerance: 1, updateGeometries: true, repairSequences: true, linkAddressMaster: false, acceptAllGeometries } });

  it("should default the flag to false when the request omits it", () => {
    expect(parse(startBody()).options.acceptAllGeometries).toBe(false);
  });

  it("should map true to true", () => {
    expect(parse(withFlag(true)).options.acceptAllGeometries).toBe(true);
  });

  it("should map false to false", () => {
    expect(parse(withFlag(false)).options.acceptAllGeometries).toBe(false);
  });

  it.each([
    ["a text value", "true"],
    ["a number", 1],
    ["null", null],
  ])("should reject the flag sent as %s with the Spanish message naming acceptAllGeometries", (_label, value) => {
    expectRejected(withFlag(value), /^El campo acceptAllGeometries debe ser verdadero o falso\.$/);
  });
});

describe("parseActualizarStartRequest repairSequences (SQ-1)", () => {
  const optionsWith = (repairSequences: unknown): Body => ({ tolerance: 1, updateGeometries: true, linkAddressMaster: false, repairSequences });
  const optionsWithout = (): Body => ({ tolerance: 1, updateGeometries: true, linkAddressMaster: false });

  it.each([true, false])("should carry repairSequences=%s into the parsed options when SQ-1 gives a boolean", (value) => {
    const params = parseActualizarStartRequest(startBody({ options: optionsWith(value) }) as Parameters<typeof parseActualizarStartRequest>[0]);

    expect(params.options.repairSequences).toBe(value);
  });

  it("should answer 400 naming repairSequences when SQ-1 option is missing", () => {
    const error = errorOf(startBody({ options: optionsWithout() }));

    expect(error).toBeInstanceOf(RequestInvalidError);
    expect(error.message).toMatch(/repairSequences/);
  });

  it.each([["a string", "true"], ["a number", 1], ["null", null], ["an object", {}]])(
    "should answer 400 naming repairSequences when SQ-1 option is %s",
    (_label, value) => {
      const error = errorOf(startBody({ options: optionsWith(value) }));

      expect(error).toBeInstanceOf(RequestInvalidError);
      expect(error.message).toMatch(/repairSequences/);
    }
  );
});
