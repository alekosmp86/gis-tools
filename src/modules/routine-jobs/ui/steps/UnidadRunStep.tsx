"use client";

import React from "react";
import type { UnidadRunSnapshot } from "../unidadTerritorialRunStore";
import { JobRunStep, type JobRunTexts } from "./JobRunStep";

const TEXTS: JobRunTexts = {
  idleHint:
    "Todavía no hay una actualización de unidades territoriales. Complete los pasos anteriores y pulse Analizar sin cargar o Actualizar unidades territoriales.",
  dryRunDone: "Análisis terminado: la tabla de unidades territoriales no fue modificada.",
  realRunDone: "Actualización terminada. Revise el informe.",
  failedFallback: "La actualización de unidades territoriales terminó con un error.",
  unknownTitle: "No se pudo confirmar el resultado de la actualización de unidades territoriales.",
  unknownAdvice: "Hay que verificar la tabla de unidades territoriales antes de volver a cargar.",
};

export interface UnidadRunStepProps {
  snapshot: UnidadRunSnapshot;
  nowMs: number;
  onNewRun: () => void;
  onBackToReview: () => void;
  onOpenReport: () => void;
}

export const UnidadRunStep: React.FC<UnidadRunStepProps> = (props) => <JobRunStep {...props} texts={TEXTS} />;
