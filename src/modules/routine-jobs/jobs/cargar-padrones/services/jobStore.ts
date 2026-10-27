import {
  createJobStore,
  getJobStore,
  type JobStore,
} from "../../shared/jobStore";
import type { CargarPadronesResult } from "../types";

export { JobState } from "../../shared/jobStore";

export type CargarPadronesJobStore = JobStore<CargarPadronesResult>;

const CARGAR_PADRONES_NAMESPACE = "cargar-padrones";

export function createCargarPadronesJobStore(now?: () => number): CargarPadronesJobStore {
  return createJobStore<CargarPadronesResult>(now);
}

export function getCargarPadronesJobStore(): CargarPadronesJobStore {
  return getJobStore<CargarPadronesResult>(CARGAR_PADRONES_NAMESPACE);
}
