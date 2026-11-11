import { describe, expect, it } from "vitest";
import { FUENTE_IDS, TIPO_VIALIDAD_IDS } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import {
  fontIdOf,
  fuenteMapCte,
  roadSectionTypeIdOf,
  tipoMapCte,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/mappings";

describe("ejes-calles mappings", () => {
  describe("EJ-6 tipo_vialidad", () => {
    it.each([
      ["CALLE", 4],
      ["CALLE INTERNA", 20],
      ["PASAJE", 10],
      ["PASAJE INTERNO", 21],
      ["PEATONAL", 11],
      ["Ruta", 1],
      ["SENDERO", 15],
      ["VIRTUAL", 19],
    ])("should map %s to %i", (label, id) => {
      expect(roadSectionTypeIdOf(label)).toBe(id);
    });

    it("should hold exactly the eight spec types", () => {
      expect(Object.keys(TIPO_VIALIDAD_IDS)).toHaveLength(8);
    });

    it("should return undefined for a value outside the table, case-sensitive and empty included", () => {
      expect(roadSectionTypeIdOf("AUTOPISTA")).toBeUndefined();
      expect(roadSectionTypeIdOf("calle")).toBeUndefined();
      expect(roadSectionTypeIdOf("")).toBeUndefined();
    });
  });

  describe("EJ-7 fuente", () => {
    it.each([
      ["ANC", 8],
      ["CARGA_MASIVA", 35],
      ["DESDE_TSUBASA", 34],
      ["Google", 33],
      ["IDE", 1],
      ["INE", 3],
      ["INTENDENCIA_DE_CANELONES", 13],
      ["INTENDENCIA_DE_CERRO_LARGO", 14],
      ["INTENDENCIA_DE_DURAZNO", 16],
      ["INTENDENCIA_DE_FLORES", 17],
      ["INTENDENCIA_DE_FLORIDA", 18],
      ["INTENDENCIA_DE_MALDONADO", 20],
      ["INTENDENCIA_DE_MONTEVIDEO", 21],
      ["INTENDENCIA_DE_RIVERA", 24],
      ["INTENDENCIA_DE_ROCHA", 25],
      ["INTENDENCIA_DE_SALTO", 26],
      ["INTENDENCIA_DE_SAN_JOSE", 27],
      ["INTENDENCIA_DE_SORIANO", 28],
      ["INTENDENCIA_DE_TACUAREMBÓ", 29],
      ["MTOP", 7],
      ["OSM", 32],
      ["UTE", 31],
    ])("should map %s to %i", (label, id) => {
      expect(fontIdOf(label)).toBe(id);
    });

    it("should hold exactly the 22 spec fonts", () => {
      expect(Object.keys(FUENTE_IDS)).toHaveLength(22);
    });

    it("should return undefined, never 0, for an unknown fuente", () => {
      expect(fontIdOf("DESCONOCIDA")).toBeUndefined();
      expect(fontIdOf("")).toBeUndefined();
      expect(Object.values(FUENTE_IDS)).not.toContain(0);
    });
  });

  describe("mapping CTEs", () => {
    it("should emit one VALUES row per tipo with its id", () => {
      const sql = tipoMapCte();

      expect(sql).toContain("VALUES");
      expect(sql).toContain("'CALLE INTERNA', 20");
      expect(sql).toContain("'Ruta', 1");
      expect(sql.match(/\('/g)).toHaveLength(8);
    });

    it("should emit one VALUES row per fuente with its id", () => {
      const sql = fuenteMapCte();

      expect(sql).toContain("'INTENDENCIA_DE_TACUAREMBÓ', 29");
      expect(sql.match(/\('/g)).toHaveLength(22);
    });
  });
});
