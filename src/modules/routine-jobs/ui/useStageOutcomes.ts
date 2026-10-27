"use client";

import { useState, useSyncExternalStore } from "react";
import { getActualizarPadronRunStore, type ActualizarPadronRunSnapshot } from "./actualizarPadronRunStore";
import { getCargarLocalidadesRunStore, type CargarLocalidadesRunSnapshot } from "./cargarLocalidadesRunStore";
import { getCargarPadronesRunStore, type CargarPadronesRunSnapshot } from "./cargarPadronesRunStore";
import { MonthlyStage } from "./monthlyCartoStages";
import { statusOfRun, type StageOutcomes } from "./monthlyCartoState";

const IDLE_CARGAR: CargarPadronesRunSnapshot = { phase: "idle" };
const IDLE_ACTUALIZAR: ActualizarPadronRunSnapshot = { phase: "idle" };
const idleCargar = (): CargarPadronesRunSnapshot => IDLE_CARGAR;
const idleActualizar = (): ActualizarPadronRunSnapshot => IDLE_ACTUALIZAR;
const IDLE_LOCALIDADES: CargarLocalidadesRunSnapshot = { phase: "idle" };
const idleLocalidades = (): CargarLocalidadesRunSnapshot => IDLE_LOCALIDADES;

/** Stage status is read from each stage's shared run store, so it survives leaving and reopening a stage. */
export function useStageOutcomes(): StageOutcomes {
  const [cargarStore] = useState(getCargarPadronesRunStore);
  const [actualizarStore] = useState(getActualizarPadronRunStore);
  const [localidadesStore] = useState(getCargarLocalidadesRunStore);
  const cargarSnapshot = useSyncExternalStore(cargarStore.subscribe, cargarStore.getSnapshot, idleCargar);
  const actualizarSnapshot = useSyncExternalStore(actualizarStore.subscribe, actualizarStore.getSnapshot, idleActualizar);
  const localidadesSnapshot = useSyncExternalStore(localidadesStore.subscribe, localidadesStore.getSnapshot, idleLocalidades);
  return {
    [MonthlyStage.CARGAR_PADRONES]: statusOfRun(cargarSnapshot),
    [MonthlyStage.CARGAR_LOCALIDADES]: statusOfRun(localidadesSnapshot),
    [MonthlyStage.ACTUALIZAR_PADRON]: statusOfRun(actualizarSnapshot),
  };
}
