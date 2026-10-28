"use client";

import React from "react";
import { CompletarUnidadTerritorialReport } from "../CompletarUnidadTerritorialReport";
import type { CompletarRunSnapshot } from "../completarUnidadTerritorialRunStore";
import { JobReportStep, type JobReportTexts } from "./JobReportStep";

const TEXTS: JobReportTexts = {
  idleHint: "Todavía no hay un informe. Ejecute un proceso desde el paso Revisar.",
  runningHint: "El proceso sigue en curso. El informe aparece cuando termine.",
  noReport: "El proceso terminó, pero el servidor no envió el informe.",
  notFinished: "El proceso no terminó correctamente, así que no hay informe. Revise el paso Ejecución.",
};

export interface CompletarReportStepProps {
  snapshot: CompletarRunSnapshot;
  onNewRun: () => void;
  onBackToReview: () => void;
}

export const CompletarReportStep: React.FC<CompletarReportStepProps> = (props) => (
  <JobReportStep {...props} texts={TEXTS} renderReport={(result) => <CompletarUnidadTerritorialReport result={result} />} />
);
