"use client";

import React from "react";
import { UnidadTerritorialReport } from "../UnidadTerritorialReport";
import type { UnidadRunSnapshot } from "../unidadTerritorialRunStore";
import { JobReportStep, type JobReportTexts } from "./JobReportStep";

const TEXTS: JobReportTexts = {
  idleHint: "Todavía no hay un informe. Ejecute una actualización desde el paso Revisar.",
  runningHint: "La actualización sigue en curso. El informe aparece cuando termine.",
  noReport: "La actualización terminó, pero el servidor no envió el informe.",
  notFinished: "La actualización no terminó correctamente, así que no hay informe. Revise el paso Ejecución.",
};

export interface UnidadReportStepProps {
  snapshot: UnidadRunSnapshot;
  onNewRun: () => void;
  onBackToReview: () => void;
}

export const UnidadReportStep: React.FC<UnidadReportStepProps> = (props) => (
  <JobReportStep
    {...props}
    texts={TEXTS}
    renderReport={(result) => <UnidadTerritorialReport result={result} targetSchema={props.snapshot.plan?.targetSchema} />}
  />
);
