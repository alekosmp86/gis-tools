import { describe, it, expect } from "vitest";
import {
  COLLIDING_KEY_LIMIT,
  LOCALITY_REQUIRED_COLUMNS,
  PADRON_REQUIRED_COLUMNS,
  PROVINCE_REQUIRED_COLUMNS,
  SKIP_REASON,
  SKIPPED_GROUP_LIMIT,
  SKIPPED_SAMPLE_LIMIT,
  STAGING_REQUIRED_COLUMNS,
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

  describe("report caps (AP-16, AP-25)", () => {
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
