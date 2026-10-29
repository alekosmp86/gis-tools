import { describe, it, expect } from "vitest";
import { MONTHLY_STAGES, MonthlyStage } from "@/modules/routine-jobs/ui/monthlyCartoStages";

const stageOf = (id: MonthlyStage) => MONTHLY_STAGES.find((stage) => stage.id === id);

describe("monthly carto hub stage list", () => {
  describe("unidad-territorial stage (stage 3)", () => {
    it("should list the unidad-territorial stage in the hub", () => {
      expect(stageOf(MonthlyStage.UNIDAD_TERRITORIAL)).toBeDefined();
    });

    it("should keep the unidad-territorial stage after the cargar-localidades stage", () => {
      const ids = MONTHLY_STAGES.map((stage) => stage.id);

      expect(ids.indexOf(MonthlyStage.UNIDAD_TERRITORIAL)).toBe(ids.indexOf(MonthlyStage.CARGAR_LOCALIDADES) + 1);
    });
  });
});
