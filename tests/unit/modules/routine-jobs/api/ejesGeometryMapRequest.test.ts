import { describe, expect, it } from "vitest";
import { parseEjesGeometryMapRequest } from "@/modules/routine-jobs/api/ejesGeometryMapRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { EJES_MAP_ITEMS_LIMIT } from "@/modules/routine-jobs/jobs/ejes-calles/domain/geometryMap";

const PASSWORD = "Mapa!secreto-2026";
const INT4_MAX = 2147483647;
const HOSTILE = "1'); DROP TABLE carto.road_section; --";

type Body = Record<string, unknown>;

const mapBody = (overrides: Body = {}): Body => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  tables: {
    "ejes-origen": { schema: "bdj_carto", table: "ide_ejesviacirculacion" },
    "ejes-tramos": { schema: "carto", table: "road_section" },
    "ejes-padrones": { schema: "carto", table: "padron" },
  },
  items: [{ oldRef: 1001634 }],
  ...overrides,
});

const itemsOf = (count: number, entry: Body = { oldRef: 1 }): Body[] => Array.from({ length: count }, () => ({ ...entry }));

function errorOf(body: Body): Error {
  try {
    parseEjesGeometryMapRequest(body);
  } catch (error: unknown) {
    return error as Error;
  }
  throw new Error("expected the map request to be rejected");
}

function expectRejected(body: Body, mention: RegExp): void {
  const error = errorOf(body);
  expect(error).toBeInstanceOf(RequestInvalidError);
  expect(error.message).toMatch(mention);
  expect(error.message).not.toContain(PASSWORD);
}

describe("parseEjesGeometryMapRequest", () => {
  it("should read the connection, the staging, road section and padrones tables and the items", () => {
    const params = parseEjesGeometryMapRequest(mapBody({ items: [{ oldRef: 1001634 }, { newRef: "1035386" }] }));

    expect(params.config.db_name).toBe("gis");
    expect(params.config.password).toBe(PASSWORD);
    expect(params.staging).toEqual({ schema: "bdj_carto", table: "ide_ejesviacirculacion" });
    expect(params.roadSection).toEqual({ schema: "carto", table: "road_section" });
    expect(params.padrones).toEqual({ schema: "carto", table: "padron" });
    expect(params.items).toEqual([{ oldRef: 1001634 }, { newRef: "1035386" }]);
  });

  it("should accept a reference sent as text or as a number", () => {
    const params = parseEjesGeometryMapRequest(mapBody({ items: [{ oldRef: "42" }, { newRef: 7 }] }));

    expect(params.items).toEqual([{ oldRef: 42 }, { newRef: "7" }]);
  });

  it("should accept 30 items and refuse 31", () => {
    expect(parseEjesGeometryMapRequest(mapBody({ items: itemsOf(EJES_MAP_ITEMS_LIMIT) })).items).toHaveLength(30);
    expectRejected(mapBody({ items: itemsOf(EJES_MAP_ITEMS_LIMIT + 1) }), /1 a 30/);
  });

  it.each([[[]], ["x"], [null], [undefined]])("should refuse items %j", (items) => {
    expectRejected(mapBody({ items }), /items/);
  });

  it("should refuse an item without oldRef or newRef", () => {
    expectRejected(mapBody({ items: [{}] }), /oldRef, newRef o zoneOf/);
  });

  it("should refuse an item that is not an object", () => {
    expectRejected(mapBody({ items: ["1001634"] }), /objeto/);
  });

  it.each([["abc"], ["12.5"], ["-3"], [""], [true]])("should refuse a reference that is not an integer: %j", (reference) => {
    expectRejected(mapBody({ items: [{ oldRef: reference }] }), /entero/);
    expectRejected(mapBody({ items: [{ newRef: reference }] }), /entero/);
  });

  it("should refuse an old reference above the int4 range", () => {
    expectRejected(mapBody({ items: [{ oldRef: INT4_MAX + 1 }] }), /entero/);
  });

  it("should never pass a hostile reference on", () => {
    expectRejected(mapBody({ items: [{ newRef: HOSTILE }] }), /entero/);
  });

  it("should refuse a request without one of the three tables", () => {
    expect(() => parseEjesGeometryMapRequest(mapBody({ tables: {} }))).toThrow(RequestInvalidError);
    expect(() => parseEjesGeometryMapRequest(mapBody({ tables: { "ejes-origen": { schema: "a", table: "b" } } }))).toThrow(
      RequestInvalidError
    );
  });

  describe("zone items (ET-7)", () => {
    it("should accept a zone item of each padron type, with the reference as text or number", () => {
      const params = parseEjesGeometryMapRequest(
        mapBody({ items: [{ zoneOf: "1035386", type: "URBANO" }, { zoneOf: 7, type: "RURAL" }] })
      );

      expect(params.items).toEqual([
        { zoneOf: "1035386", type: "URBANO" },
        { zoneOf: "7", type: "RURAL" },
      ]);
    });

    it("should accept zone items mixed with old and new items", () => {
      const items = [{ oldRef: 1 }, { newRef: "2" }, { zoneOf: "2", type: "URBANO" }];

      expect(parseEjesGeometryMapRequest(mapBody({ items })).items).toEqual(items);
    });

    it.each([["urbano"], ["PADRON"], [""], [null], [undefined], [1], [true]])("should refuse the zone type %j", (type) => {
      expectRejected(mapBody({ items: [{ zoneOf: "1", type }] }), /URBANO o RURAL/);
    });

    it("should refuse a zone item without a type", () => {
      expectRejected(mapBody({ items: [{ zoneOf: "1" }] }), /URBANO o RURAL/);
    });

    it.each([["abc"], ["12.5"], ["-3"], [""], [true]])("should refuse a zone reference that is not an integer: %j", (reference) => {
      expectRejected(mapBody({ items: [{ zoneOf: reference, type: "URBANO" }] }), /entero/);
    });

    it("should never pass a hostile zone reference on", () => {
      expectRejected(mapBody({ items: [{ zoneOf: HOSTILE, type: "RURAL" }] }), /entero/);
    });

    it("should still refuse an item with none of oldRef, newRef or zoneOf", () => {
      expectRejected(mapBody({ items: [{ type: "URBANO" }] }), /oldRef, newRef o zoneOf/);
    });

    it("should keep the limit of 30 items with zone items", () => {
      const zone = { zoneOf: "1", type: "RURAL" };

      expect(parseEjesGeometryMapRequest(mapBody({ items: itemsOf(EJES_MAP_ITEMS_LIMIT, zone) })).items).toHaveLength(30);
      expectRejected(mapBody({ items: itemsOf(EJES_MAP_ITEMS_LIMIT + 1, zone) }), /1 a 30/);
    });
  });

  describe("padrones table (ET-1, ET-7)", () => {
    it("should refuse a request whose tables carry no ejes-padrones", () => {
      const tables = {
        "ejes-origen": { schema: "bdj_carto", table: "ide_ejesviacirculacion" },
        "ejes-tramos": { schema: "carto", table: "road_section" },
      };

      expectRejected(mapBody({ tables }), /ejes-padrones/);
    });

    it("should refuse an ejes-padrones entry without schema or table", () => {
      const tables = {
        "ejes-origen": { schema: "bdj_carto", table: "ide_ejesviacirculacion" },
        "ejes-tramos": { schema: "carto", table: "road_section" },
        "ejes-padrones": { schema: "carto" },
      };

      expect(() => parseEjesGeometryMapRequest(mapBody({ tables }))).toThrow(RequestInvalidError);
    });
  });
});
