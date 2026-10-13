import type { ModuleEndpointHandler } from "@/core/modules/contracts";
import { createShpContext } from "../services/shpContext";
import type { ShpHandlerDependencies } from "../services/shpContext";
import { createCancelHandler } from "./cancelHandler";
import { createDiscardHandler } from "./discardHandler";
import { createJobsHandler } from "./jobsHandler";
import { createLogHandler } from "./logHandler";
import { createPlanHandler } from "./planHandler";
import { createStartHandler } from "./startHandler";
import { createStatusHandler } from "./statusHandler";
import { createUploadHandler } from "./uploadHandler";

export type { ShpHandlerDependencies };

export interface ShpHandlers {
  readonly upload: ModuleEndpointHandler;
  readonly plan: ModuleEndpointHandler;
  readonly start: ModuleEndpointHandler;
  readonly status: ModuleEndpointHandler;
  readonly jobs: ModuleEndpointHandler;
  readonly cancel: ModuleEndpointHandler;
  readonly log: ModuleEndpointHandler;
  readonly discard: ModuleEndpointHandler;
}

/** HTTP surface of the SHP loader: one file per endpoint, assembled here over one shared context. */
export function createShpHandlers(dependencies: ShpHandlerDependencies = {}): ShpHandlers {
  const context = createShpContext(dependencies);
  return {
    upload: createUploadHandler(context),
    plan: createPlanHandler(context),
    start: createStartHandler(context),
    status: createStatusHandler(context),
    jobs: createJobsHandler(context),
    cancel: createCancelHandler(context),
    log: createLogHandler(context),
    discard: createDiscardHandler(context),
  };
}
