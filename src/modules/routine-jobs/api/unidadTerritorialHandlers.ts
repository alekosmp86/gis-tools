import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { plannedUnitStepLabels } from "../jobs/unidad-territorial/domain/plannedSteps";
import { linksAddressMasterOf } from "../jobs/unidad-territorial/domain/tableRoles";
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

const lockKeysOfUnit = (params: UnitParams): string[] => [
  tableLockKey(params.config, params.targetSchema, params.targetTable),
  ...(params.addressMasterTable === undefined
    ? []
    : [tableLockKey(params.config, params.addressMasterTable.schema, params.addressMasterTable.table)]),
];

export function createUnidadTerritorialHandlers(
  overrides: Partial<UnidadTerritorialHandlerDeps> = {}
): UnidadTerritorialHandlers {
  const { start, status } = createStageJobHandlers<UnitParams, UnitResult>(
    {
      namespace: "unidad-territorial",
      conflictMessage: "Ya hay una actualización de unidades territoriales en curso para esta tabla.",
      parse: parseUnidadTerritorialStartRequest,
      lockKeysOf: lockKeysOfUnit,
      plannedSteps: (params) => plannedUnitStepLabels({ dryRun: params.dryRun, linkAddressMaster: linksAddressMasterOf(params) }),
      run: runUnidadTerritorial,
    },
    overrides
  );
  return { startUnidadTerritorial: start, readUnidadTerritorialStatus: status };
}
