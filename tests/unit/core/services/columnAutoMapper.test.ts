import { describe, it, expect } from "vitest";
import {
  MatchKind,
  autoMapColumns,
  normalizeColumnName,
  type AutoMatch,
} from "@/core/services/columnAutoMapper";

const REALISTIC_TARGETS = [
  "gid",
  "nomdepto",
  "coddepto",
  "nomofidel",
  "padron",
  "seccat",
  "lamina",
  "caudricula",
  "areaha",
  "areamc",
  "valcat",
  "geom",
];

const REALISTIC_SOURCES = [
  "NOMDEPTO",
  "CODDEPTO",
  "PADRON",
  "SECCAT",
  "LAMINA",
  "CUADRICULA",
  "AREAHA",
  "AREAMC",
  "VALCAT",
];

describe("columnAutoMapper", () => {
  describe("normalizeColumnName", () => {
    it("should lowercase ASCII letters when normalizing", () => {
      expect(normalizeColumnName("NOMDEPTO")).toBe("nomdepto");
    });

    it("should strip underscores, hyphens and spaces when normalizing", () => {
      expect(normalizeColumnName("nom_depto")).toBe("nomdepto");
      expect(normalizeColumnName("valor-cat")).toBe("valorcat");
      expect(normalizeColumnName("Col 1")).toBe("col1");
    });

    it("should strip diacritics when normalizing", () => {
      expect(normalizeColumnName("área")).toBe("area");
      expect(normalizeColumnName("Año")).toBe("ano");
      expect(normalizeColumnName("ñandú")).toBe("nandu");
    });

    it("should remove punctuation and non-latin characters when normalizing", () => {
      expect(normalizeColumnName("a.b/c")).toBe("abc");
      expect(normalizeColumnName("名前")).toBe("");
    });

    it("should keep digits when normalizing", () => {
      expect(normalizeColumnName("area2024")).toBe("area2024");
    });

    it("should return empty string when name has only separators or is empty", () => {
      expect(normalizeColumnName("___")).toBe("");
      expect(normalizeColumnName("")).toBe("");
    });
  });

  describe("autoMapColumns", () => {
    describe("empty and malformed inputs", () => {
      it("should return empty mapping when both inputs are empty", () => {
        expect(autoMapColumns([], [])).toEqual({});
      });

      it("should return empty mapping when there are no sources", () => {
        expect(autoMapColumns([], ["gid", "padron"])).toEqual({});
      });

      it("should return empty mapping when there are no targets", () => {
        expect(autoMapColumns(["gid", "padron"], [])).toEqual({});
      });

      it("should not match targets whose normalized names are empty", () => {
        expect(autoMapColumns(["---"], ["___"])).toEqual({});
      });

      it("should not mutate frozen input arrays", () => {
        const sources = Object.freeze(["NOMDEPTO", "gid"]);
        const targets = Object.freeze(["gid", "nomdepto"]);

        const result = autoMapColumns(sources, targets);

        expect(result).toEqual({
          gid: { source: "gid", kind: MatchKind.EXACT },
          nomdepto: { source: "NOMDEPTO", kind: MatchKind.CASE_INSENSITIVE },
        });
        expect(sources).toEqual(["NOMDEPTO", "gid"]);
        expect(targets).toEqual(["gid", "nomdepto"]);
      });
    });

    describe("EXACT tier", () => {
      it("should match identical names with kind EXACT", () => {
        expect(autoMapColumns(["gid"], ["gid"])).toEqual({
          gid: { source: "gid", kind: MatchKind.EXACT },
        });
      });
    });

    describe("CASE_INSENSITIVE tier", () => {
      it("should match names differing only by case and keep the source spelling", () => {
        expect(autoMapColumns(["PADRON"], ["padron"])).toEqual({
          padron: { source: "PADRON", kind: MatchKind.CASE_INSENSITIVE },
        });
      });

      it("should key the result by the target spelling when target is uppercase", () => {
        expect(autoMapColumns(["padron"], ["PADRON"])).toEqual({
          PADRON: { source: "padron", kind: MatchKind.CASE_INSENSITIVE },
        });
      });

      it("should prefer EXACT over CASE_INSENSITIVE when both sources exist", () => {
        expect(autoMapColumns(["PADRON", "padron"], ["padron"])).toEqual({
          padron: { source: "padron", kind: MatchKind.EXACT },
        });
      });

      it("should not match when two different sources match the same target case-insensitively", () => {
        expect(autoMapColumns(["PADRON", "Padron"], ["padron"])).toEqual({});
      });
    });

    describe("NORMALIZED tier", () => {
      it("should match names differing by underscores and case with kind NORMALIZED", () => {
        expect(autoMapColumns(["NOMDEPTO"], ["nom_depto"])).toEqual({
          nom_depto: { source: "NOMDEPTO", kind: MatchKind.NORMALIZED },
        });
      });

      it("should match accented target to unaccented source with kind NORMALIZED", () => {
        expect(autoMapColumns(["AREA"], ["área"])).toEqual({
          área: { source: "AREA", kind: MatchKind.NORMALIZED },
        });
      });

      it("should match names differing by surrounding spaces with kind NORMALIZED", () => {
        expect(autoMapColumns(["padron"], [" padron "])).toEqual({
          " padron ": { source: "padron", kind: MatchKind.NORMALIZED },
        });
      });

      it("should not match accented target to a source whose normalized name differs", () => {
        expect(autoMapColumns(["ANIO"], ["año"])).toEqual({});
      });
    });

    describe("TRUNCATED tier", () => {
      it("should match a long target to a 10-character DBF source with kind TRUNCATED", () => {
        expect(autoMapColumns(["NOMBRE_DEP"], ["nombre_departamento"])).toEqual({
          nombre_departamento: { source: "NOMBRE_DEP", kind: MatchKind.TRUNCATED },
        });
      });

      it("should match an 11-character target to its 10-character prefix source", () => {
        expect(autoMapColumns(["ABCDEFGHIJ"], ["abcdefghijk"])).toEqual({
          abcdefghijk: { source: "ABCDEFGHIJ", kind: MatchKind.TRUNCATED },
        });
      });

      it("should not match a truncated candidate when source is longer than 10 characters", () => {
        expect(autoMapColumns(["NOMBRE_DEPTO_X"], ["nombre_departamento"])).toEqual({});
      });

      it("should not match a truncated candidate when source prefix differs from target prefix", () => {
        expect(autoMapColumns(["NOMBRE_OTRO"], ["nombre_departamento"])).toEqual({});
      });
    });

    describe("SIMILAR tier", () => {
      it("should match a single adjacent transposition with kind SIMILAR", () => {
        expect(autoMapColumns(["CUADRICULA"], ["caudricula"])).toEqual({
          caudricula: { source: "CUADRICULA", kind: MatchKind.SIMILAR },
        });
      });

      it("should match a single inserted character with kind SIMILAR", () => {
        expect(autoMapColumns(["SECCAT"], ["seccatx"])).toEqual({
          seccatx: { source: "SECCAT", kind: MatchKind.SIMILAR },
        });
      });

      it("should not match when names differ by distance two", () => {
        expect(autoMapColumns(["AREAMC"], ["areaha"])).toEqual({});
      });

      it("should match when normalized names are exactly five characters long", () => {
        expect(autoMapColumns(["ABDCE"], ["abcde"])).toEqual({
          abcde: { source: "ABDCE", kind: MatchKind.SIMILAR },
        });
      });

      it("should not match when source normalized name is shorter than five characters", () => {
        expect(autoMapColumns(["abcd"], ["abcde"])).toEqual({});
      });

      it("should not match when both names are shorter than five characters", () => {
        expect(autoMapColumns(["ABDC"], ["abcd"])).toEqual({});
      });

      it("should measure length on normalized names so underscores do not count", () => {
        expect(autoMapColumns(["ab_dc"], ["ab_cd"])).toEqual({});
      });

      it("should not match when two different sources are at distance one from the target", () => {
        expect(autoMapColumns(["abcdfe", "abcdeg"], ["abcdef"])).toEqual({});
      });

      it("should not match when two targets are equally close to the same single source", () => {
        expect(autoMapColumns(["ABCDE"], ["abcdf", "abcdg"])).toEqual({});
      });

      it("should still match SIMILAR when other unconsumed sources are at distance zero", () => {
        expect(autoMapColumns(["PADRON", "Padron", "PADROM"], ["padron"])).toEqual({
          padron: { source: "PADROM", kind: MatchKind.SIMILAR },
        });
      });
    });

    describe("tier priority and consumption", () => {
      it("should let an EXACT match consume the source before a SIMILAR candidate is considered", () => {
        expect(autoMapColumns(["cuadricula"], ["cuadricula", "caudricula"])).toEqual({
          cuadricula: { source: "cuadricula", kind: MatchKind.EXACT },
        });
      });

      it("should let a CASE_INSENSITIVE match consume the source before a NORMALIZED candidate is considered", () => {
        expect(autoMapColumns(["nomdepto"], ["nom_depto", "NOMDEPTO"])).toEqual({
          NOMDEPTO: { source: "nomdepto", kind: MatchKind.CASE_INSENSITIVE },
        });
      });

      it("should keep a source consumed by EXACT away from a later CASE_INSENSITIVE target", () => {
        expect(autoMapColumns(["gid"], ["gid", "GID"])).toEqual({
          gid: { source: "gid", kind: MatchKind.EXACT },
        });
      });
    });

    describe("options.excludeSources", () => {
      it("should match geometry sentinel by normalized name when no exclusion is given", () => {
        expect(autoMapColumns(["__geometry__"], ["geometry"])).toEqual({
          geometry: { source: "__geometry__", kind: MatchKind.NORMALIZED },
        });
      });

      it("should never match an excluded source", () => {
        expect(autoMapColumns(["__geometry__"], ["geometry"], { excludeSources: ["__geometry__"] })).toEqual({});
      });

      it("should only exclude listed sources and keep matching the rest", () => {
        expect(
          autoMapColumns(["__geometry__", "GID"], ["geometry", "gid"], { excludeSources: ["__geometry__"] })
        ).toEqual({
          gid: { source: "GID", kind: MatchKind.CASE_INSENSITIVE },
        });
      });

      it("should behave like no options when options is an empty object", () => {
        expect(autoMapColumns(["GID"], ["gid"], {})).toEqual(autoMapColumns(["GID"], ["gid"]));
      });
    });

    describe("duplicates and order independence", () => {
      it("should return one entry when a target name is duplicated", () => {
        expect(autoMapColumns(["PADRON"], ["padron", "padron"])).toEqual({
          padron: { source: "PADRON", kind: MatchKind.CASE_INSENSITIVE },
        });
      });

      it("should return one entry when an exact target name is duplicated", () => {
        expect(autoMapColumns(["id"], ["id", "id"])).toEqual({
          id: { source: "id", kind: MatchKind.EXACT },
        });
      });

      it("should produce the same result when target order is reversed", () => {
        const forward = autoMapColumns(REALISTIC_SOURCES, REALISTIC_TARGETS);
        const reversed = autoMapColumns(REALISTIC_SOURCES, [...REALISTIC_TARGETS].reverse());
        expect(reversed).toEqual(forward);
      });

      it("should produce the same result when source order is reversed", () => {
        const forward = autoMapColumns(REALISTIC_SOURCES, REALISTIC_TARGETS);
        const reversed = autoMapColumns([...REALISTIC_SOURCES].reverse(), REALISTIC_TARGETS);
        expect(reversed).toEqual(forward);
      });
    });

    describe("realistic DBF replace case", () => {
      it("should map every target that has a counterpart and leave gid, nomofidel and geom unmatched", () => {
        const result: Record<string, AutoMatch> = autoMapColumns(REALISTIC_SOURCES, REALISTIC_TARGETS);

        expect(result).toEqual({
          nomdepto: { source: "NOMDEPTO", kind: MatchKind.CASE_INSENSITIVE },
          coddepto: { source: "CODDEPTO", kind: MatchKind.CASE_INSENSITIVE },
          padron: { source: "PADRON", kind: MatchKind.CASE_INSENSITIVE },
          seccat: { source: "SECCAT", kind: MatchKind.CASE_INSENSITIVE },
          lamina: { source: "LAMINA", kind: MatchKind.CASE_INSENSITIVE },
          caudricula: { source: "CUADRICULA", kind: MatchKind.SIMILAR },
          areaha: { source: "AREAHA", kind: MatchKind.CASE_INSENSITIVE },
          areamc: { source: "AREAMC", kind: MatchKind.CASE_INSENSITIVE },
          valcat: { source: "VALCAT", kind: MatchKind.CASE_INSENSITIVE },
        });
        expect(Object.keys(result)).not.toContain("gid");
        expect(Object.keys(result)).not.toContain("nomofidel");
        expect(Object.keys(result)).not.toContain("geom");
      });
    });
  });
});
