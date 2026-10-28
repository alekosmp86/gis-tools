"use client";

import React from "react";
import { CargarLocalidadesReport } from "../CargarLocalidadesReport";
import type { CargarLocalidadesRunSnapshot } from "../cargarLocalidadesRunStore";
import { JobReportStep, type JobReportTexts } from "./JobReportStep";

const TEXTS: JobReportTexts = {
  idleHint: "Todavía no hay un informe. Ejecute una carga desde el paso Revisar.",
  runningHint: "La carga sigue en curso. El informe aparece cuando termine.",
  noReport: "La carga terminó, pero el servidor no envió el informe.",
  notFinished: "La carga no terminó correctamente, así que no hay informe. Revise el paso Ejecución.",
};

export interface LocalidadesReportStepProps {
  snapshot: CargarLocalidadesRunSnapshot;
  onNewRun: () => void;
  onBackToReview: () => void;
}

export const LocalidadesReportStep: React.FC<LocalidadesReportStepProps> = (props) => (
  <JobReportStep {...props} texts={TEXTS} renderReport={(result) => <CargarLocalidadesReport result={result} />} />
);
