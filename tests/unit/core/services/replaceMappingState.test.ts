import { describe, it, expect } from "vitest";
import { deriveReplaceMapping } from "@/core/services/replaceMappingState";
import { buildDefaultColumnMapping } from "@/core/services/replaceColumnMapping";
import { MatchKind } from "@/core/services/columnAutoMapper";
import type { InsertFieldDefault } from "@/core/types/comparison";

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

const NO_EDITS = { sourceByTarget: {}, defaults: {} };

const FIXED_GID: InsertFieldDefault = { fieldName: "gid", value: "7", useRawExpression: false };

describe("replaceMappingState", () => {
  describe("deriveReplaceMapping default mode", () => {
    it("should prefill same-named columns and return no automatic matches when options are absent", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["id", "name", "extra"],
        targetColumns: ["id", "name", "other"],
        edits: NO_EDITS,
      });

      expect(result.mapping.sourceByTarget).toEqual({ id: "id", name: "name", other: null });
      expect(result.mapping.defaults).toEqual({});
      expect(result.autoMatches).toEqual({});
    });

    it("should equal buildDefaultColumnMapping plus the user edits when smart is not requested", () => {
      const sourceColumns = ["id", "name", "extra"];
      const targetColumns = ["id", "name", "other"];
      const edits = { sourceByTarget: { other: "extra", name: null }, defaults: { other: FIXED_GID } };

      const result = deriveReplaceMapping({ sourceColumns, targetColumns, edits, options: { smart: false } });

      const base = buildDefaultColumnMapping(sourceColumns, targetColumns);
      expect(result.mapping).toEqual({
        sourceByTarget: { ...base.sourceByTarget, ...edits.sourceByTarget },
        defaults: edits.defaults,
      });
      expect(result.autoMatches).toEqual({});
    });

    it("should not match names that differ only by case when smart is not requested", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["NOMDEPTO"],
        targetColumns: ["nomdepto"],
        edits: NO_EDITS,
      });

      expect(result.mapping.sourceByTarget).toEqual({ nomdepto: null });
      expect(result.autoMatches).toEqual({});
    });

    it("should keep exact-name prefills when excludeSources is given without smart", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["id", "name"],
        targetColumns: ["id", "name"],
        edits: NO_EDITS,
        options: { excludeSources: ["id"] },
      });

      expect(result.mapping.sourceByTarget).toEqual({ id: "id", name: "name" });
      expect(result.autoMatches).toEqual({});
    });

    it("should pass the edited defaults through unchanged", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["id"],
        targetColumns: ["id", "gid"],
        edits: { sourceByTarget: {}, defaults: { gid: FIXED_GID } },
      });

      expect(result.mapping.defaults).toEqual({ gid: FIXED_GID });
      expect(result.mapping.sourceByTarget).toEqual({ id: "id", gid: null });
    });

    it("should return an empty mapping when there are no target columns", () => {
      const result = deriveReplaceMapping({ sourceColumns: ["a"], targetColumns: [], edits: NO_EDITS });

      expect(result).toEqual({ mapping: { sourceByTarget: {}, defaults: {} }, autoMatches: {} });
    });
  });

  describe("deriveReplaceMapping smart mode", () => {
    it("should auto-map the realistic DBF columns with their match kinds and leave gid, nomofidel and geom unmapped", () => {
      const result = deriveReplaceMapping({
        sourceColumns: REALISTIC_SOURCES,
        targetColumns: REALISTIC_TARGETS,
        edits: NO_EDITS,
        options: { smart: true },
      });

      expect(result.autoMatches).toEqual({
        nomdepto: MatchKind.CASE_INSENSITIVE,
        coddepto: MatchKind.CASE_INSENSITIVE,
        padron: MatchKind.CASE_INSENSITIVE,
        seccat: MatchKind.CASE_INSENSITIVE,
        lamina: MatchKind.CASE_INSENSITIVE,
        caudricula: MatchKind.SIMILAR,
        areaha: MatchKind.CASE_INSENSITIVE,
        areamc: MatchKind.CASE_INSENSITIVE,
        valcat: MatchKind.CASE_INSENSITIVE,
      });
      expect(result.mapping.sourceByTarget).toEqual({
        gid: null,
        nomdepto: "NOMDEPTO",
        coddepto: "CODDEPTO",
        nomofidel: null,
        padron: "PADRON",
        seccat: "SECCAT",
        lamina: "LAMINA",
        caudricula: "CUADRICULA",
        areaha: "AREAHA",
        areamc: "AREAMC",
        valcat: "VALCAT",
        geom: null,
      });
    });

    it("should return an empty mapping of nulls and no matches when there are no source columns", () => {
      const result = deriveReplaceMapping({
        sourceColumns: [],
        targetColumns: ["gid", "padron"],
        edits: NO_EDITS,
        options: { smart: true },
      });

      expect(result.mapping.sourceByTarget).toEqual({ gid: null, padron: null });
      expect(result.autoMatches).toEqual({});
    });

    it("should drop the chip and take the edited source when the user picks another source for an auto-matched target", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["PADRON", "SECCAT", "OTRO"],
        targetColumns: ["padron", "seccat"],
        edits: { sourceByTarget: { padron: "OTRO" }, defaults: {} },
        options: { smart: true },
      });

      expect(result.mapping.sourceByTarget).toEqual({ padron: "OTRO", seccat: "SECCAT" });
      expect(result.autoMatches).toEqual({ seccat: MatchKind.CASE_INSENSITIVE });
    });

    it("should drop the chip when the user sets an auto-matched target to not map", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["PADRON", "SECCAT"],
        targetColumns: ["padron", "seccat"],
        edits: { sourceByTarget: { padron: null }, defaults: {} },
        options: { smart: true },
      });

      expect(result.mapping.sourceByTarget).toEqual({ padron: null, seccat: "SECCAT" });
      expect(result.autoMatches).toEqual({ seccat: MatchKind.CASE_INSENSITIVE });
    });

    it("should keep the chip and its kind when the user edit equals the automatic source", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["CUADRICULA"],
        targetColumns: ["caudricula"],
        edits: { sourceByTarget: { caudricula: "CUADRICULA" }, defaults: {} },
        options: { smart: true },
      });

      expect(result.mapping.sourceByTarget).toEqual({ caudricula: "CUADRICULA" });
      expect(result.autoMatches).toEqual({ caudricula: MatchKind.SIMILAR });
    });

    it("should not show a chip for a target without an automatic match even when the user maps it", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["PADRON", "extra"],
        targetColumns: ["gid", "padron"],
        edits: { sourceByTarget: { gid: "extra" }, defaults: {} },
        options: { smart: true },
      });

      expect(result.mapping.sourceByTarget).toEqual({ gid: "extra", padron: "PADRON" });
      expect(result.autoMatches).toEqual({ padron: MatchKind.CASE_INSENSITIVE });
    });

    it("should never auto-match an excluded source and leave its target unmapped", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["NOMDEPTO", "CODDEPTO"],
        targetColumns: ["nomdepto", "coddepto"],
        edits: NO_EDITS,
        options: { smart: true, excludeSources: ["NOMDEPTO"] },
      });

      expect(result.mapping.sourceByTarget).toEqual({ nomdepto: null, coddepto: "CODDEPTO" });
      expect(result.autoMatches).toEqual({ coddepto: MatchKind.CASE_INSENSITIVE });
      expect(Object.values(result.mapping.sourceByTarget)).not.toContain("NOMDEPTO");
    });

    it("should not show a chip when the user maps an excluded source by hand", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["NOMDEPTO"],
        targetColumns: ["nomdepto"],
        edits: { sourceByTarget: { nomdepto: "NOMDEPTO" }, defaults: {} },
        options: { smart: true, excludeSources: ["NOMDEPTO"] },
      });

      expect(result.mapping.sourceByTarget).toEqual({ nomdepto: "NOMDEPTO" });
      expect(result.autoMatches).toEqual({});
    });

    it("should pass the edited defaults through unchanged in smart mode", () => {
      const result = deriveReplaceMapping({
        sourceColumns: ["PADRON"],
        targetColumns: ["padron", "gid"],
        edits: { sourceByTarget: {}, defaults: { gid: FIXED_GID } },
        options: { smart: true },
      });

      expect(result.mapping.defaults).toEqual({ gid: FIXED_GID });
      expect(result.autoMatches).toEqual({ padron: MatchKind.CASE_INSENSITIVE });
    });
  });
});
