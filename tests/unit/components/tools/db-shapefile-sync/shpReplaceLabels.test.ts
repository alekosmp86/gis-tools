import { describe, it, expect } from "vitest";
import { SHP_REPLACE_UPLOAD_PHASE_LABEL, shpRunWording } from "@/components/tools/db-shapefile-sync/shpReplaceLabels";
import { ShpReplaceRunStatus } from "@/core/services/shpReplaceRunStore";
import { ShpReplacePhase } from "@/core/types/shpReplace";

describe("shpReplaceLabels", () => {
  describe("shpRunWording for a real replace", () => {
    const wording = shpRunWording(false);

    it("should return the replace title for each run status", () => {
      expect(wording.titleByStatus).toEqual({
        [ShpReplaceRunStatus.IDLE]: "Reemplazo completo",
        [ShpReplaceRunStatus.UPLOADING]: "Subiendo el archivo para el reemplazo completo",
        [ShpReplaceRunStatus.RUNNING]: "Reemplazo completo en curso",
        [ShpReplaceRunStatus.DONE]: "Reemplazo completo finalizado",
        [ShpReplaceRunStatus.FAILED]: "Reemplazo completo fallido",
      });
    });

    it("should return the replace phase labels, swap included as a real table replacement", () => {
      expect(wording.phaseLabels).toEqual({
        [ShpReplacePhase.STAGING]: "Cargando registros",
        [ShpReplacePhase.PROCESSING]: "Procesando geometrías",
        [ShpReplacePhase.SWAPPING]: "Reemplazando la tabla",
        [ShpReplacePhase.FINALIZING]: "Finalizando",
      });
    });

    it("should state that the target table is unmodified on failure", () => {
      expect(wording.unmodifiedTarget).toContain("La tabla destino no fue modificada");
      expect(wording.unmodifiedTarget).toContain("se revierte ante cualquier error");
    });

    it("should warn about a possibly committed replace when the outcome is unknown", () => {
      expect(wording.unknownOutcome).toContain("haber confirmado el reemplazo");
    });
  });

  describe("shpRunWording for a dry run analysis", () => {
    const wording = shpRunWording(true);

    it("should return the analysis title for each run status", () => {
      expect(wording.titleByStatus).toEqual({
        [ShpReplaceRunStatus.IDLE]: "Análisis sin reemplazo",
        [ShpReplaceRunStatus.UPLOADING]: "Subiendo el archivo para el análisis",
        [ShpReplaceRunStatus.RUNNING]: "ANÁLISIS EN CURSO",
        [ShpReplaceRunStatus.DONE]: "Análisis (sin cambios en la tabla)",
        [ShpReplaceRunStatus.FAILED]: "Análisis fallido",
      });
    });

    it("should return the analysis phase labels with the swap described as a simulation", () => {
      expect(wording.phaseLabels).toEqual({
        [ShpReplacePhase.STAGING]: "Cargando registros",
        [ShpReplacePhase.PROCESSING]: "Procesando geometrías",
        [ShpReplacePhase.SWAPPING]: "Simulando la carga en la tabla destino",
        [ShpReplacePhase.FINALIZING]: "Finalizando",
      });
    });

    it("should state that the analysis does not modify the target table when the outcome is unknown", () => {
      expect(wording.unknownOutcome).toContain("El análisis no modifica la tabla destino.");
    });
  });

  describe("shared labels", () => {
    it("should keep the upload phase label identical for both modes", () => {
      expect(SHP_REPLACE_UPLOAD_PHASE_LABEL).toBe("Subiendo archivo");
    });

    it("should expose a different title for the same status in the two modes", () => {
      expect(shpRunWording(true).titleByStatus[ShpReplaceRunStatus.DONE]).not.toBe(
        shpRunWording(false).titleByStatus[ShpReplaceRunStatus.DONE]
      );
    });
  });
});
