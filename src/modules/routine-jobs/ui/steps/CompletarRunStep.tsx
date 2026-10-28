"use client";

import React from "react";
import type { CompletarRunSnapshot } from "../completarUnidadTerritorialRunStore";
import { JobRunStep, type JobRunTexts } from "./JobRunStep";

const TEXTS: JobRunTexts = {
  idleHint:
    "Todavía no hay un proceso de direcciones maestras. Complete los pasos anteriores y pulse Analizar sin cargar o Completar unidades territoriales.",
  dryRunDone: "Análisis terminado: las tablas de unidades territoriales y de direcciones maestras no fueron modificadas.",
  realRunDone: "Proceso terminado. Revise el informe.",
  failedFallback: "La creación de direcciones maestras de unidades territoriales terminó con un error.",
  unknownTitle: "No se pudo confirmar el resultado de la creación de direcciones maestras.",
  unknownAdvice: "Hay que verificar las tablas de unidades territoriales y de direcciones maestras antes de volver a cargar.",
};

export interface CompletarRunStepProps {
  snapshot: CompletarRunSnapshot;
  nowMs: number;
  onNewRun: () => void;
  onBackToReview: () => void;
  onOpenReport: () => void;
}

export const CompletarRunStep: React.FC<CompletarRunStepProps> = (props) => <JobRunStep {...props} texts={TEXTS} />;
