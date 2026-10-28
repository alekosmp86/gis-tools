import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { plannedCompletarStepLabels } from "../jobs/completar-unidad-territorial/domain/plannedSteps";
import { completarLockTablesOf } from "../jobs/completar-unidad-territorial/domain/tableRoles";
import { runCompletarUnidadTerritorial } from "../jobs/completar-unidad-territorial/services/runCompletarUnidadTerritorial";
import type { CompletarParams, CompletarResult } from "../jobs/completar-unidad-territorial/types";
import { tableLockKey } from "./jobHttp";
import { parseCompletarUnidadTerritorialStartRequest } from "./completarUnidadTerritorialRequestParsing";
import { createStageJobHandlers, type StageJobDeps } from "./stageJobHandlers";

export type CompletarUnidadTerritorialHandlerDeps = StageJobDeps<CompletarParams, CompletarResult>;

export interface CompletarUnidadTerritorialHandlers {
  readonly startCompletarUnidadTerritorial: ModuleEndpointHandler;
  readonly readCompletarUnidadTerritorialStatus: ModuleEndpointHandler;
}

export function createCompletarUnidadTerritorialHandlers(
  overrides: Partial<CompletarUnidadTerritorialHandlerDeps> = {}
): CompletarUnidadTerritorialHandlers {
  const { start, status } = createStageJobHandlers<CompletarParams, CompletarResult>(
    {
      namespace: "completar-unidad-territorial",
      conflictMessage: "Ya hay un proceso de direcciones maestras de unidades territoriales en curso para estas tablas.",
      parse: parseCompletarUnidadTerritorialStartRequest,
      lockKeysOf: (params) =>
        completarLockTablesOf(params).map((target) => tableLockKey(params.config, target.schema, target.table)),
      plannedSteps: (params) => plannedCompletarStepLabels({ dryRun: params.dryRun }),
      run: runCompletarUnidadTerritorial,
    },
    overrides
  );
  return { startCompletarUnidadTerritorial: start, readCompletarUnidadTerritorialStatus: status };
}
