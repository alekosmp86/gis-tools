import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { CENTROS_TABLE_ROLE } from "../jobs/centros-anep/constants";
import { plannedCentrosStepLabels } from "../jobs/centros-anep/domain/plannedSteps";
import { runCentrosAnep } from "../jobs/centros-anep/services/runCentrosAnep";
import type { CentrosParams, CentrosResult } from "../jobs/centros-anep/types";
import { tableLockKey } from "./jobHttp";
import { parseCentrosAnepStartRequest } from "./centrosAnepRequestParsing";
import { createStageJobHandlers, type StageJobDeps } from "./stageJobHandlers";

export type CentrosAnepHandlerDeps = StageJobDeps<CentrosParams, CentrosResult>;

export interface CentrosAnepHandlers {
  readonly startCentrosAnep: ModuleEndpointHandler;
  readonly readCentrosAnepStatus: ModuleEndpointHandler;
}

const lockKeysOfCentros = (params: CentrosParams): string[] => {
  const target = params.tables[CENTROS_TABLE_ROLE.FINAL];
  return [tableLockKey(params.config, target.schema, target.table)];
};

export function createCentrosAnepHandlers(overrides: Partial<CentrosAnepHandlerDeps> = {}): CentrosAnepHandlers {
  const { start, status } = createStageJobHandlers<CentrosParams, CentrosResult>(
    {
      namespace: "centros-anep",
      conflictMessage: "Ya hay una carga de centros ANEP en curso para esta tabla.",
      parse: parseCentrosAnepStartRequest,
      lockKeysOf: lockKeysOfCentros,
      plannedSteps: plannedCentrosStepLabels,
      run: runCentrosAnep,
    },
    overrides
  );
  return { startCentrosAnep: start, readCentrosAnepStatus: status };
}
