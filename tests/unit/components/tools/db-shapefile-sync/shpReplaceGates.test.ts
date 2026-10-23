import { describe, it, expect } from "vitest";
import { computeReplaceGates } from "@/components/tools/db-shapefile-sync/shpReplaceGates";

type GateInput = Parameters<typeof computeReplaceGates>[0];

const READY: GateInput = {
  hasTarget: true,
  hasFile: true,
  sridValid: true,
  passwordFilled: true,
  processingValid: true,
  processingActive: false,
  confirmMatches: true,
};

const withOverrides = (overrides: Partial<GateInput>): GateInput => ({ ...READY, ...overrides });

describe("computeReplaceGates", () => {
  describe("plain replace without geometry processing", () => {
    it("should enable run and disable analyze when processing is off and password and label are present", () => {
      const gates = computeReplaceGates(READY);

      expect(gates).toEqual({ canAnalyze: false, canRun: true });
    });

    it("should disable run when processing is off and the confirmation label does not match", () => {
      const gates = computeReplaceGates(withOverrides({ confirmMatches: false }));

      expect(gates).toEqual({ canAnalyze: false, canRun: false });
    });
  });

  describe("analyze with geometry processing active", () => {
    it("should enable analyze and not run when processing is active and the confirmation label does not match", () => {
      const gates = computeReplaceGates(withOverrides({ processingActive: true, confirmMatches: false }));

      expect(gates).toEqual({ canAnalyze: true, canRun: false });
    });

    it("should enable both analyze and run when processing is active and the confirmation label matches", () => {
      const gates = computeReplaceGates(withOverrides({ processingActive: true, confirmMatches: true }));

      expect(gates).toEqual({ canAnalyze: true, canRun: true });
    });
  });

  describe("base inputs", () => {
    const baseInputs: Array<keyof Omit<GateInput, "processingActive" | "confirmMatches">> = [
      "hasTarget",
      "hasFile",
      "sridValid",
      "passwordFilled",
      "processingValid",
    ];

    it.each(baseInputs)("should disable analyze and run when %s is false with processing off", (input) => {
      const gates = computeReplaceGates(withOverrides({ [input]: false }));

      expect(gates).toEqual({ canAnalyze: false, canRun: false });
    });

    it.each(baseInputs)("should disable analyze and run when %s is false with processing active and label matching", (input) => {
      const gates = computeReplaceGates(
        withOverrides({ [input]: false, processingActive: true, confirmMatches: true })
      );

      expect(gates).toEqual({ canAnalyze: false, canRun: false });
    });
  });

  describe("invalid processing options", () => {
    it("should disable both analyze and run when processing is invalid even if processing is active and label matches", () => {
      const gates = computeReplaceGates(
        withOverrides({ processingValid: false, processingActive: true, confirmMatches: true })
      );

      expect(gates).toEqual({ canAnalyze: false, canRun: false });
    });

    it("should disable run when processing is invalid and processing is off", () => {
      const gates = computeReplaceGates(withOverrides({ processingValid: false, processingActive: false }));

      expect(gates).toEqual({ canAnalyze: false, canRun: false });
    });
  });

  describe("run independence from processing", () => {
    it("should not require processing to be active for run when every other input is valid", () => {
      const gates = computeReplaceGates(withOverrides({ processingActive: false, confirmMatches: true }));

      expect(gates.canRun).toBe(true);
    });
  });
});
