import { describe, expect, it } from "vitest";
import {
  LOAD_TYPE_LABELS,
  LOAD_TYPE_STAGE_IDS,
  LoadType,
  stagesForLoadType,
  type StageIdsByLoadType,
} from "@/modules/coverage-loads/workflow/domain/loadType";

const STAGE_IDS: StageIdsByLoadType = { [LoadType.COVERAGE]: ["alpha", "beta"], [LoadType.FTTH]: ["gamma"] };
const ALL_STAGES = [{ id: "gamma" }, { id: "beta" }, { id: "alpha" }, { id: "delta" }];

describe("LoadType", () => {
  it("should be a const object with exactly COVERAGE and FTTH", () => {
    // Arrange & Act & Assert
    expect(LoadType).toEqual({ COVERAGE: "COVERAGE", FTTH: "FTTH" });
  });
});

describe("LOAD_TYPE_LABELS", () => {
  it("should label coverage with its technologies and FTTH plainly", () => {
    // Arrange & Act & Assert
    expect(LOAD_TYPE_LABELS).toEqual({
      [LoadType.COVERAGE]: "Cobertura (3G, LTE, 5G, NBIOT)",
      [LoadType.FTTH]: "FTTH",
    });
  });
});

describe("LOAD_TYPE_STAGE_IDS", () => {
  it("should map coverage to indicators then shp, and FTTH to avance-ftth", () => {
    // Arrange & Act & Assert
    expect(LOAD_TYPE_STAGE_IDS).toEqual({
      [LoadType.COVERAGE]: ["indicators", "shp"],
      [LoadType.FTTH]: ["avance-ftth"],
    });
  });

  it("should give each stage to exactly one load type", () => {
    // Arrange
    const ids = Object.values(LOAD_TYPE_STAGE_IDS).flat();

    // Act & Assert
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("stagesForLoadType", () => {
  it("should keep only the stages of the chosen type, in the order of the map", () => {
    // Arrange & Act
    const coverage = stagesForLoadType(ALL_STAGES, STAGE_IDS, LoadType.COVERAGE);
    const ftth = stagesForLoadType(ALL_STAGES, STAGE_IDS, LoadType.FTTH);

    // Assert
    expect(coverage.map((stage) => stage.id)).toEqual(["alpha", "beta"]);
    expect(ftth.map((stage) => stage.id)).toEqual(["gamma"]);
  });

  it("should return the stage objects themselves", () => {
    // Arrange & Act
    const [first] = stagesForLoadType(ALL_STAGES, STAGE_IDS, LoadType.FTTH);

    // Assert
    expect(first).toBe(ALL_STAGES[0]);
  });

  it("should return no stage while no type is chosen", () => {
    // Arrange & Act & Assert
    expect(stagesForLoadType(ALL_STAGES, STAGE_IDS, null)).toEqual([]);
  });

  it("should skip ids of the map that have no stage, and ignore stages no type claims", () => {
    // Arrange
    const onlyAlpha = [{ id: "alpha" }, { id: "delta" }];

    // Act
    const coverage = stagesForLoadType(onlyAlpha, STAGE_IDS, LoadType.COVERAGE);
    const ftth = stagesForLoadType(onlyAlpha, STAGE_IDS, LoadType.FTTH);

    // Assert
    expect(coverage.map((stage) => stage.id)).toEqual(["alpha"]);
    expect(ftth).toEqual([]);
  });

  it("should return nothing for an empty stage list", () => {
    // Arrange & Act & Assert
    expect(stagesForLoadType([], STAGE_IDS, LoadType.COVERAGE)).toEqual([]);
  });
});
