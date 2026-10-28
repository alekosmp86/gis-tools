import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { plannedLocalityStepLabels } from "../jobs/cargar-localidades/domain/plannedSteps";
import { targetLabelsOf } from "../jobs/cargar-localidades/domain/tableRoles";
import { runCargarLocalidades } from "../jobs/cargar-localidades/services/runCargarLocalidades";
import type { CargarLocalidadesParams, CargarLocalidadesResult } from "../jobs/cargar-localidades/types";
import { tableLockKey } from "./jobHttp";
import { parseCargarLocalidadesStartRequest } from "./cargarLocalidadesRequestParsing";
import { createStageJobHandlers, type StageJobDeps } from "./stageJobHandlers";

export type CargarLocalidadesHandlerDeps = StageJobDeps<CargarLocalidadesParams, CargarLocalidadesResult>;

export interface CargarLocalidadesHandlers {
  readonly startCargarLocalidades: ModuleEndpointHandler;
  readonly readCargarLocalidadesStatus: ModuleEndpointHandler;
}

export function createCargarLocalidadesHandlers(
  overrides: Partial<CargarLocalidadesHandlerDeps> = {}
): CargarLocalidadesHandlers {
  const { start, status } = createStageJobHandlers<CargarLocalidadesParams, CargarLocalidadesResult>(
    {
      namespace: "cargar-localidades",
      conflictMessage: "Ya hay una carga de localidades en curso para esta tabla.",
      parse: parseCargarLocalidadesStartRequest,
      lockKeysOf: (params) => params.targets.map((target) => tableLockKey(params.config, target.schema, target.table)),
      plannedSteps: (params) => plannedLocalityStepLabels({ dryRun: params.dryRun, tables: targetLabelsOf(params) }),
      run: runCargarLocalidades,
    },
    overrides
  );
  return { startCargarLocalidades: start, readCargarLocalidadesStatus: status };
}
