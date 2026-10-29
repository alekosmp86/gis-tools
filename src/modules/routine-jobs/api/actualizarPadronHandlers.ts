import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { plannedStepLabels } from "../jobs/actualizar-padron/domain/plannedSteps";
import { runActualizarPadron } from "../jobs/actualizar-padron/services/runActualizarPadron";
import type { ActualizarPadronParams, ActualizarPadronResult } from "../jobs/actualizar-padron/types";
import { tableLockKey } from "./jobHttp";
import { parseActualizarStartRequest } from "./actualizarRequestParsing";
import { createStageJobHandlers, type StageJobDeps } from "./stageJobHandlers";

export type ActualizarPadronHandlerDeps = StageJobDeps<ActualizarPadronParams, ActualizarPadronResult>;

const lockKeysOfActualizar = (params: ActualizarPadronParams): string[] => [
  tableLockKey(params.config, params.cartoSchema, params.targetTable),
  ...(params.addressMasterTable === undefined ? [] : [tableLockKey(params.config, params.cartoSchema, params.addressMasterTable)]),
];

export interface ActualizarPadronHandlers {
  readonly startActualizarPadron: ModuleEndpointHandler;
  readonly readActualizarPadronStatus: ModuleEndpointHandler;
}

export function createActualizarPadronHandlers(
  overrides: Partial<ActualizarPadronHandlerDeps> = {}
): ActualizarPadronHandlers {
  const { start, status } = createStageJobHandlers<ActualizarPadronParams, ActualizarPadronResult>(
    {
      namespace: "actualizar-padron",
      conflictMessage: "Ya hay una actualización en curso para esta tabla.",
      parse: parseActualizarStartRequest,
      lockKeysOf: lockKeysOfActualizar,
      plannedSteps: (params) => plannedStepLabels({ dryRun: params.dryRun, linkAddressMaster: params.options.linkAddressMaster }),
      run: runActualizarPadron,
    },
    overrides
  );
  return { startActualizarPadron: start, readActualizarPadronStatus: status };
}
