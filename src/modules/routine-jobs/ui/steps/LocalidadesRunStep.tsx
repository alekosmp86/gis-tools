"use client";

import React from "react";
import type { CargarLocalidadesRunSnapshot } from "../cargarLocalidadesRunStore";
import { JobRunStep, type JobRunTexts } from "./JobRunStep";

const TEXTS: JobRunTexts = {
  idleHint:
    "Todavía no hay una carga de localidades. Complete los pasos anteriores y pulse Analizar sin cargar o Cargar localidades.",
  dryRunDone: "Análisis terminado: las tablas de localidades no fueron modificadas.",
  realRunDone: "Carga terminada. Revise el informe.",
  failedFallback: "La carga de localidades terminó con un error.",
  unknownTitle: "No se pudo confirmar el resultado de la carga de localidades.",
  unknownAdvice: "Hay que verificar las tablas de localidades antes de volver a cargar.",
};

export interface LocalidadesRunStepProps {
  snapshot: CargarLocalidadesRunSnapshot;
  nowMs: number;
  onNewRun: () => void;
  onBackToReview: () => void;
  onOpenReport: () => void;
}

export const LocalidadesRunStep: React.FC<LocalidadesRunStepProps> = (props) => <JobRunStep {...props} texts={TEXTS} />;
