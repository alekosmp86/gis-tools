import { describe, it, expect } from "vitest";
import {
  RURAL_REQUIRED_COLUMNS,
  TARGET_REQUIRED_COLUMNS,
  URBANO_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/cargar-padrones/constants";

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe("cargar-padrones constants", () => {
  it("should declare exactly the rural source columns of the spec", () => {
    expect(sorted(RURAL_REQUIRED_COLUMNS)).toEqual(
      sorted([
        "gid", "nomdepto", "coddepto", "nomofidel", "padron", "seccat",
        "lamina", "caudricula", "areaha", "areamc", "valreal", "geom",
      ])
    );
  });

  it("should declare exactly the urban source columns of the spec", () => {
    expect(sorted(URBANO_REQUIRED_COLUMNS)).toEqual(
      sorted([
        "gid", "nomdepto", "coddepto", "nomofidel", "nomloccat", "codloccat",
        "padron", "numcarcat", "nummancat", "valaream2", "tiporegime", "geom",
      ])
    );
  });

  it("should declare exactly the target columns of the spec", () => {
    expect(sorted(TARGET_REQUIRED_COLUMNS)).toEqual(
      sorted([
        "unidadcat", "nomdepto", "coddepto", "nomofidel", "nomloccat", "codloccat",
        "padron", "numcarcat", "nummancat", "valaream2", "tiporegime", "seccat",
        "lamina", "caudricula", "areaha", "areamc", "valreal", "archivo", "geom",
      ])
    );
  });

  it("should require gid and geom in both sources", () => {
    expect(RURAL_REQUIRED_COLUMNS).toEqual(expect.arrayContaining(["gid", "geom"]));
    expect(URBANO_REQUIRED_COLUMNS).toEqual(expect.arrayContaining(["gid", "geom"]));
  });

  it("should require archivo and unidadcat in the target", () => {
    expect(TARGET_REQUIRED_COLUMNS).toEqual(expect.arrayContaining(["archivo", "unidadcat"]));
  });

  it("should not contain duplicates in any list", () => {
    for (const list of [RURAL_REQUIRED_COLUMNS, URBANO_REQUIRED_COLUMNS, TARGET_REQUIRED_COLUMNS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
