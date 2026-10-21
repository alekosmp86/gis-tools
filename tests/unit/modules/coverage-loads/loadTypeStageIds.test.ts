import { describe, expect, it } from "vitest";
import { CoverageStageId } from "@/modules/coverage-loads/workflow/domain/coverageStageId";
import { LoadType, LOAD_TYPE_STAGE_IDS } from "@/modules/coverage-loads/workflow/domain/loadType";

const ALL_STAGE_IDS = Object.values(CoverageStageId);

describe("LOAD_TYPE_STAGE_IDS", () => {
  it("should define the stage ids as the known CoverageStageId values", () => {
    // Arrange & Act & Assert
    expect(CoverageStageId).toEqual({ INDICATORS: "indicators", SHP: "shp", AVANCE_FTTH: "avance-ftth" });
  });

  it("should cover, as a set, exactly the ids of CoverageStageId", () => {
    // Arrange
    const flattened = Object.values(LOAD_TYPE_STAGE_IDS).flat();

    // Act & Assert
    expect(new Set(flattened)).toEqual(new Set(ALL_STAGE_IDS));
  });

  it("should assign every stage id to exactly one load type", () => {
    // Arrange
    const flattened = Object.values(LOAD_TYPE_STAGE_IDS).flat();

    // Act & Assert
    expect(flattened).toHaveLength(ALL_STAGE_IDS.length);
    for (const id of ALL_STAGE_IDS) {
      const owners = Object.values(LoadType).filter((type) => LOAD_TYPE_STAGE_IDS[type].includes(id));
      expect(owners).toHaveLength(1);
    }
  });

  it("should group the ids by type as coverage -> indicators, shp and FTTH -> avance-ftth", () => {
    // Arrange & Act & Assert
    expect(LOAD_TYPE_STAGE_IDS[LoadType.COVERAGE]).toEqual([CoverageStageId.INDICATORS, CoverageStageId.SHP]);
    expect(LOAD_TYPE_STAGE_IDS[LoadType.FTTH]).toEqual([CoverageStageId.AVANCE_FTTH]);
  });
});
