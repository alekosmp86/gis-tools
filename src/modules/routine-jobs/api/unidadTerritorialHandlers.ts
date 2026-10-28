import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { plannedUnitStepLabels } from "../jobs/unidad-territorial/domain/plannedSteps";
import { runUnidadTerritorial } from "../jobs/unidad-territorial/services/runUnidadTerritorial";
import type { UnitParams, UnitResult } from "../jobs/unidad-territorial/types";
import { tableLockKey } from "./jobHttp";
import { parseUnidadTerritorialStartRequest } from "./unidadTerritorialRequestParsing";
import { createStageJobHandlers, type StageJobDeps } from "./stageJobHandlers";

export type UnidadTerritorialHandlerDeps = StageJobDeps<UnitParams, UnitResult>;

export interface UnidadTerritorialHandlers {
  readonly startUnidadTerritorial: ModuleEndpointHandler;
  readonly readUnidadTerritorialStatus: ModuleEndpointHandler;
}

export function createUnidadTerritorialHandlers(
  overrides: Partial<UnidadTerritorialHandlerDeps> = {}
): UnidadTerritorialHandlers {
  const { start, status } = createStageJobHandlers<UnitParams, UnitResult>(
    {
      namespace: "unidad-territorial",
      conflictMessage: "Ya hay una actualización de unidades territoriales en curso para esta tabla.",
      parse: parseUnidadTerritorialStartRequest,
      lockKeysOf: (params) => [tableLockKey(params.config, params.targetSchema, params.targetTable)],
      plannedSteps: (params) => plannedUnitStepLabels({ dryRun: params.dryRun }),
      run: runUnidadTerritorial,
    },
    overrides
  );
  return { startUnidadTerritorial: start, readUnidadTerritorialStatus: status };
}
