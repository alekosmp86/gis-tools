import type React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  buildCsvReplaceSteps,
  type BuildCsvReplaceStepsParams,
} from "@/components/tools/db-csv-sync/csvReplaceWizardSteps";
import { start as startCsvRun } from "@/core/services/csvReplaceRunStore";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";
import type { DbConfig } from "@/core/types/db";

type FileReplaceMapping = BuildCsvReplaceStepsParams["replaceMapping"];

const replaceMapping = (overrides: Partial<FileReplaceMapping> = {}): FileReplaceMapping => ({
  sourceColumns: ["nombre", SHP_GEOMETRY_SOURCE],
  sourceDetails: [],
  mapping: { sourceByTarget: { nombre: "nombre", geom: SHP_GEOMETRY_SOURCE }, defaults: {} },
  autoMatches: {},
  setSource: vi.fn(),
  setDefault: vi.fn(),
  isMappingValid: true,
  ...overrides,
});

const build = (overrides: Partial<BuildCsvReplaceStepsParams> = {}) => {
  const goToStep = vi.fn();
  const steps = buildCsvReplaceSteps({
    replaceMapping: replaceMapping(),
    targetColumns: ["nombre", "geom"],
    targetDetails: [],
    targetConfig: { table_name: "parcelas", schema_name: "geo" } as DbConfig,
    targetRowCount: 12,
    file: new File(["id"], "datos.csv", { lastModified: 1_700_000_000_000 }),
    recordCount: 3,
    uploadId: "up-1",
    goToStep,
    ...overrides,
  });
  return { steps, goToStep };
};

const propsOf = (step: { content: React.ReactNode }): Record<string, unknown> =>
  (step.content as React.ReactElement<Record<string, unknown>>).props;

describe("csvReplaceWizardSteps", () => {
  describe("CR-13: buildCsvReplaceSteps", () => {
    it("should build the mapping step as id 4 and the replace step as id 5", () => {
      const { steps } = build();

      expect(steps.map((step) => step.id)).toEqual([4, 5]);
    });

    it("should let the mapping step proceed only when the mapping is valid", () => {
      expect(build().steps[0].canProceed).toBe(true);
      expect(build({ replaceMapping: replaceMapping({ isMappingValid: false }) }).steps[0].canProceed).toBe(false);
    });

    it("should navigate from the mapping step to step 5 forward and to step 3 back", () => {
      const { steps, goToStep } = build();

      steps[0].onNext?.();
      steps[0].onBack?.();

      expect(goToStep).toHaveBeenNthCalledWith(1, 5);
      expect(goToStep).toHaveBeenNthCalledWith(2, 3);
    });

    it("should navigate from the replace step back to step 4", () => {
      const { steps, goToStep } = build();

      steps[1].onBack?.();

      expect(goToStep).toHaveBeenCalledWith(4);
    });

    it("should pass the CSV source columns and the file date to the mapping step", () => {
      const { steps } = build();

      const props = propsOf(steps[0]);

      expect(props.sourceColumns).toEqual(["nombre", SHP_GEOMETRY_SOURCE]);
      expect(props.fileDate).toEqual(new Date(1_700_000_000_000));
    });

    it("should pass a null file date to the mapping step when there is no file", () => {
      const { steps } = build({ file: null });

      expect(propsOf(steps[0]).fileDate).toBeNull();
    });

    it("should run the replace step with the CSV wording, SRID 4326 as the detected SRID and the CSV run store", () => {
      const { steps } = build();

      const props = propsOf(steps[1]);

      expect(props.sourceLabel).toBe("CSV");
      expect(props.runLabel).toBe("Vaciar destino y reemplazar con el CSV");
      expect(props.detectedSrid).toBe(4326);
      expect(props.startRun).toBe(startCsvRun);
      expect(props.uploadId).toBe("up-1");
      expect(props.recordCount).toBe(3);
      expect(props.targetRowCount).toBe(12);
    });

    it("should show the SRID field when a target column is mapped to the geometry", () => {
      expect(propsOf(build().steps[1]).showSrid).toBe(true);
    });

    it("should hide the SRID field when no target column is mapped to the geometry", () => {
      const mapping = { sourceByTarget: { nombre: "nombre", geom: null }, defaults: {} };

      const { steps } = build({ replaceMapping: replaceMapping({ mapping }) });

      expect(propsOf(steps[1]).showSrid).toBe(false);
    });

    it("should hide the SRID field when the mapping is empty", () => {
      const { steps } = build({
        replaceMapping: replaceMapping({ mapping: { sourceByTarget: {}, defaults: {} } }),
      });

      expect(propsOf(steps[1]).showSrid).toBe(false);
    });

    it("should pass the current mapping to the replace step", () => {
      const { steps } = build();

      expect(propsOf(steps[1]).mapping).toEqual({
        sourceByTarget: { nombre: "nombre", geom: SHP_GEOMETRY_SOURCE },
        defaults: {},
      });
    });
  });
});
