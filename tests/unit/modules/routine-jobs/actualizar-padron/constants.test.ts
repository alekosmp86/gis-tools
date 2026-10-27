import { describe, it, expect } from "vitest";
import {
  ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE,
  ACTUALIZAR_TABLE_ROLE,
  COLLIDING_KEY_LIMIT,
  DEFAULT_LOCALITY_TYPE,
  LOCALITY_REASON_GROUP_LIMIT,
  LOCALITY_REQUIRED_COLUMNS,
  LOCALITY_TYPE_COLUMN,
  LOCALITY_TYPED_REQUIRED_COLUMNS,
  PADRON_REQUIRED_COLUMNS,
  PROVINCE_REQUIRED_COLUMNS,
  SKIP_REASON,
  SKIPPED_GROUP_LIMIT,
  SKIPPED_SAMPLE_LIMIT,
  STAGING_REQUIRED_COLUMNS,
  TYPE_REQUIRED_COLUMNS,
  WORK_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/actualizar-padron/constants";

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe("actualizar-padron constants", () => {
  describe("required logical columns per role (AP-2)", () => {
    it("should declare exactly the staging columns of the spec", () => {
      expect(sorted(STAGING_REQUIRED_COLUMNS)).toEqual(sorted(["unidadcat", "nomdepto", "nomloccat", "padron", "geom"]));
    });

    it("should declare exactly the work table columns of the spec", () => {
      expect(sorted(WORK_REQUIRED_COLUMNS)).toEqual(
        sorted(["number", "type_padron", "id_cadastral_locality", "id_province", "geometry"])
      );
    });

    it("should declare exactly the padron columns of the spec", () => {
      expect(sorted(PADRON_REQUIRED_COLUMNS)).toEqual(sorted(["id", "geometry"]));
    });

    it("should declare exactly the province columns of the spec", () => {
      expect(sorted(PROVINCE_REQUIRED_COLUMNS)).toEqual(sorted(["id", "name"]));
    });

    it("should declare exactly the locality columns of the spec", () => {
      expect(sorted(LOCALITY_REQUIRED_COLUMNS)).toEqual(sorted(["id", "name", "id_province"]));
    });

    it("should never declare the work table id column as required, since the job never writes it", () => {
      expect(WORK_REQUIRED_COLUMNS).not.toContain("id");
    });

    it("should not contain duplicates in any list", () => {
      for (const list of [
        STAGING_REQUIRED_COLUMNS,
        WORK_REQUIRED_COLUMNS,
        PADRON_REQUIRED_COLUMNS,
        PROVINCE_REQUIRED_COLUMNS,
        LOCALITY_REQUIRED_COLUMNS,
      ]) {
        expect(new Set(list).size).toBe(list.length);
      }
    });
  });

  describe("skip reasons (AP-9..AP-13)", () => {
    it("should declare exactly the seven skip reasons of the spec", () => {
      expect(Object.keys(SKIP_REASON).sort()).toEqual(
        [
          "PROVINCIA_NO_ENCONTRADA",
          "PROVINCIA_AMBIGUA",
          "LOCALIDAD_NO_ENCONTRADA",
          "LOCALIDAD_AMBIGUA",
          "CLAVE_NULA",
          "SIN_GEOMETRIA",
          "CLAVE_DUPLICADA",
        ].sort()
      );
    });

    it("should use each reason key as its own value, as the report carries the reason text", () => {
      for (const [key, value] of Object.entries(SKIP_REASON)) {
        expect(value).toBe(key);
      }
    });
  });

  describe("unit type table and typed locality role (AP-1, AP-2, AP-2b, AP-10b)", () => {
    it("should declare exactly the id and name columns of the unit type table", () => {
      expect(sorted(TYPE_REQUIRED_COLUMNS)).toEqual(sorted(["id", "name"]));
    });

    it("should declare the typed locality columns as the locality columns plus id_territorial_unit_type", () => {
      expect(sorted(LOCALITY_TYPED_REQUIRED_COLUMNS)).toEqual(
        sorted(["id", "name", "id_province", "id_territorial_unit_type"])
      );
    });

    it("should name the id_territorial_unit_type column of the locality table", () => {
      expect(LOCALITY_TYPE_COLUMN.ID_TERRITORIAL_UNIT_TYPE).toBe("id_territorial_unit_type");
    });

    it("should keep the untyped locality role free of id_territorial_unit_type (AP-10b)", () => {
      expect(ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE[ACTUALIZAR_TABLE_ROLE.LOCALITY]).not.toContain("id_territorial_unit_type");
    });

    it("should name the type role actualizar-tipo and the typed locality role actualizar-localidad-tipada", () => {
      expect(ACTUALIZAR_TABLE_ROLE.TYPE).toBe("actualizar-tipo");
      expect(ACTUALIZAR_TABLE_ROLE.LOCALITY_TYPED).toBe("actualizar-localidad-tipada");
    });

    it("should map the type role and the typed locality role to their required columns", () => {
      expect(ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE[ACTUALIZAR_TABLE_ROLE.TYPE]).toEqual([...TYPE_REQUIRED_COLUMNS]);
      expect(ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE[ACTUALIZAR_TABLE_ROLE.LOCALITY_TYPED]).toEqual([
        ...LOCALITY_TYPED_REQUIRED_COLUMNS,
      ]);
    });

    it("should not contain duplicates in the type and typed locality lists", () => {
      for (const list of [TYPE_REQUIRED_COLUMNS, LOCALITY_TYPED_REQUIRED_COLUMNS]) {
        expect(new Set(list).size).toBe(list.length);
      }
    });

    it("should default the locality type to LOCALIDAD CATASTRAL, a domain value and not an identifier", () => {
      expect(DEFAULT_LOCALITY_TYPE).toBe("LOCALIDAD CATASTRAL");
    });
  });

  describe("report caps (AP-16, AP-25)", () => {
    it("should cap the skipped groups by locality and reason at 20", () => {
      expect(LOCALITY_REASON_GROUP_LIMIT).toBe(20);
    });

    it("should cap the skipped samples at 20", () => {
      expect(SKIPPED_SAMPLE_LIMIT).toBe(20);
    });

    it("should cap the top department and locality lists at 20", () => {
      expect(SKIPPED_GROUP_LIMIT).toBe(20);
    });

    it("should cap the colliding keys listed at 20", () => {
      expect(COLLIDING_KEY_LIMIT).toBe(20);
    });
  });
});
