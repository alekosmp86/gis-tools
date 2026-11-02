import { describe, expect, it } from "vitest";
import { parseGeometryMapRequest } from "@/modules/routine-jobs/api/actualizarRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { GEOMETRY_MAP_ITEMS_LIMIT, newGeometrySql, oldGeometrySql, stagingLookupValuesOf } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/geometryMap";
import type { TableLayout } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/layouts";
import type { GeometryMapStagingKey } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

const PASSWORD = "Mapa!secreto-2026";
const INT4_MAX = 2147483647;
const HOSTILE = "x'); DROP TABLE carto.padron_tmp_actualizacion; --";
const HOSTILE_LOCALITY = "Centro' OR '1'='1";

type Body = Record<string, unknown>;

const mapBody = (overrides: Body = {}): Body => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  stagingSchema: "stg",
  stagingTable: "catastro_paispadron_stg",
  cartoSchema: "carto",
  targetTable: "padron_tmp_actualizacion",
  items: [{ oldId: 10 }],
  ...overrides,
});

const itemsOf = (count: number, entry: Body = { oldId: 1 }): Body[] =>
  Array.from({ length: count }, () => ({ ...entry }));

const stagingItem = (staging: Body): Body => ({ staging: { typePadron: "URBANO", department: "CORDOBA", locality: "Centro", number: "100", ...staging } });

function errorOf(body: Body): Error {
  try {
    parseGeometryMapRequest(body);
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

const STAGING_LAYOUT: TableLayout = {
  schema: "stg",
  table: "catastro_paispadron_stg",
  columns: { unidadcat: "unidadcat", nomdepto: "nomdepto", nomloccat: "nomloccat", padron: "padron", geom: "geom" },
};

const TARGET_LAYOUT: WritableTargetLayout = {
  schema: "carto",
  table: "padron_tmp_actualizacion",
  columns: {
    id: "id",
    number: "number",
    type_padron: "type_padron",
    id_cadastral_locality: "id_cadastral_locality",
    id_province: "id_province",
    geometry: "geometry",
  },
  srid: 32721,
  idColumn: "id",
  idSequence: null,
  identityColumns: [],
  catalog: [],
};

const urbanoKeyOf = (overrides: Partial<GeometryMapStagingKey> = {}): GeometryMapStagingKey => ({
  typePadron: "URBANO",
  department: "CORDOBA",
  locality: "Centro",
  number: "100",
  ...overrides,
});

describe("parseGeometryMapRequest (AP-97)", () => {
  describe("items list boundaries", () => {
    it("should accept a request with one item", () => {
      const params = parseGeometryMapRequest(mapBody({ items: itemsOf(1) }));

      expect(params.items).toEqual([{ oldId: 1 }]);
    });

    it("should accept a request with the maximum number of items", () => {
      const params = parseGeometryMapRequest(mapBody({ items: itemsOf(GEOMETRY_MAP_ITEMS_LIMIT) }));

      expect(params.items).toHaveLength(GEOMETRY_MAP_ITEMS_LIMIT);
    });

    it("should reject a request with an empty items list", () => {
      expectRejected(mapBody({ items: [] }), /items debe ser una lista de 1 a 6 elementos/);
    });

    it("should reject a request with one item more than the maximum", () => {
      expectRejected(mapBody({ items: itemsOf(GEOMETRY_MAP_ITEMS_LIMIT + 1) }), /items debe ser una lista de 1 a 6 elementos/);
    });

    it("should reject a request whose items field is not a list", () => {
      expectRejected(mapBody({ items: { oldId: 1 } }), /items debe ser una lista/);
    });

    it("should reject a request without items", () => {
      const body = mapBody();
      delete body.items;

      expectRejected(body, /items debe ser una lista/);
    });
  });

  describe("item shape", () => {
    it("should reject an item that is not an object", () => {
      expectRejected(mapBody({ items: [null] }), /Cada elemento de items debe ser un objeto/);
    });

    it("should reject an item that carries neither an oldId nor a staging key", () => {
      expectRejected(mapBody({ items: [{}] }), /necesita oldId o staging/);
    });

    it("should reject a staging field that is not an object", () => {
      expectRejected(mapBody({ items: [{ staging: "CORDOBA" }] }), /items.staging debe ser un objeto/);
    });
  });

  describe("oldId", () => {
    it("should accept the largest 32-bit integer as an oldId", () => {
      const params = parseGeometryMapRequest(mapBody({ items: [{ oldId: INT4_MAX }] }));

      expect(params.items).toEqual([{ oldId: INT4_MAX }]);
    });

    it.each([
      { name: "a fraction", oldId: 1.5 },
      { name: "a numeric text", oldId: "12" },
      { name: "a value above the 32-bit range", oldId: INT4_MAX + 1 },
      { name: "NaN", oldId: Number.NaN },
      { name: "an unsafe integer", oldId: Number.MAX_SAFE_INTEGER + 2 },
      { name: "a boolean", oldId: true },
    ])("should reject an oldId that is $name", ({ oldId }) => {
      expectRejected(mapBody({ items: [{ oldId }] }), /items.oldId debe ser un entero/);
    });
  });

  describe("staging key", () => {
    it("should keep a hostile department and locality as plain text values, trimmed only at the edges", () => {
      const params = parseGeometryMapRequest(
        mapBody({ items: [stagingItem({ department: HOSTILE, locality: HOSTILE_LOCALITY })] }),
      );

      expect(params.items[0].staging).toEqual({
        typePadron: "URBANO",
        department: HOSTILE,
        locality: HOSTILE_LOCALITY,
        number: "100",
      });
    });

    it("should reject a hostile number, since a padron number is digits only", () => {
      expectRejected(mapBody({ items: [stagingItem({ number: "1; DROP TABLE carto.padron_tmp_actualizacion" })] }), /número de padrón debe ser un número entero/);
    });

    it("should reject a number that mixes digits and letters", () => {
      expectRejected(mapBody({ items: [stagingItem({ number: "12a" })] }), /número de padrón debe ser un número entero/);
    });

    it("should reject an URBANO key without a locality", () => {
      expectRejected(mapBody({ items: [stagingItem({ locality: "  " })] }), /localidad de un padrón urbano/);
    });

    it("should drop the locality of a RURAL key and keep the key", () => {
      const params = parseGeometryMapRequest(
        mapBody({ items: [stagingItem({ typePadron: "RURAL", locality: HOSTILE_LOCALITY })] }),
      );

      expect(params.items[0].staging?.locality).toBeNull();
    });

    it("should reject a type that is neither RURAL nor URBANO", () => {
      expectRejected(mapBody({ items: [stagingItem({ typePadron: HOSTILE })] }), /typePadron debe ser RURAL o URBANO/);
    });
  });

  describe("password", () => {
    it("should never echo the password in a rejected item", () => {
      expectRejected(mapBody({ items: [{ oldId: 1.5, staging: { password: PASSWORD } }] }), /items.oldId/);
    });

    it("should never echo the password in a rejected connection", () => {
      const body = mapBody({ connection: { host: "db.local", port: "70000", db_name: "gis", user: "gis_user", password: PASSWORD } });

      expectRejected(body, /puerto debe ser un entero/);
    });

    it("should never echo the password when the items list is out of range", () => {
      expectRejected(mapBody({ items: itemsOf(GEOMETRY_MAP_ITEMS_LIMIT + 1) }), /items debe ser una lista/);
    });

    it("should carry the password only in the connection config of the parsed params", () => {
      const params = parseGeometryMapRequest(mapBody());

      expect(params.config.password).toBe(PASSWORD);
    });
  });

  describe("SQL builders keep the input out of the SQL text", () => {
    it("should bind the department, type, number and locality of a URBANO key as $1 to $4 values", () => {
      const key = urbanoKeyOf({ department: HOSTILE, locality: HOSTILE_LOCALITY, number: "100" });

      const sql = newGeometrySql(STAGING_LAYOUT, TARGET_LAYOUT, key);

      expect(stagingLookupValuesOf(key)).toEqual([HOSTILE, "URBANO", "100", HOSTILE_LOCALITY]);
      expect(sql).toContain("$1");
      expect(sql).toContain("$2");
      expect(sql).toContain("$3");
      expect(sql).toContain("$4");
      expect(sql).not.toContain("$5");
    });

    it("should never place a hostile department, locality or number into the new padron SQL text", () => {
      const key = urbanoKeyOf({ department: HOSTILE, locality: HOSTILE_LOCALITY, number: "1; DROP TABLE x" });

      const sql = newGeometrySql(STAGING_LAYOUT, TARGET_LAYOUT, key);

      expect(sql).not.toContain("DROP");
      expect(sql).not.toContain(HOSTILE);
      expect(sql).not.toContain(HOSTILE_LOCALITY);
      expect(sql).not.toContain("1; DROP TABLE x");
    });

    it("should bind only three values and no locality placeholder for a RURAL key", () => {
      const key = urbanoKeyOf({ typePadron: "RURAL", locality: null, department: HOSTILE });

      const sql = newGeometrySql(STAGING_LAYOUT, TARGET_LAYOUT, key);

      expect(stagingLookupValuesOf(key)).toEqual([HOSTILE, "RURAL", "100"]);
      expect(sql).not.toContain("$4");
      expect(sql).not.toContain(HOSTILE);
    });

    it("should read the old padron by a single bound id and interpolate no value into the old SQL text", () => {
      const sql = oldGeometrySql(TARGET_LAYOUT);

      expect(sql).toContain("$1");
      expect(sql).not.toContain("$2");
      expect(sql).not.toMatch(/DROP|DELETE|UPDATE|INSERT/i);
    });
  });
});
