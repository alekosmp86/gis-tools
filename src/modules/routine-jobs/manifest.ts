import { defineModuleEndpoints } from "@/core/modules/defineModuleEndpoints";
import type { AppModuleManifest } from "@/ui-kit/modules/contracts";
import routeDeclarations from "./module.routes.json";
import { createRoutineJobsHandlers } from "./api/handlers";

/**
 * The routine jobs module: a shell for recurring database jobs, one wizard per job.
 *
 * Its first job is "Cargar padrones". Endpoints only for now; pages and UI come in a later round.
 */
const handlers = createRoutineJobsHandlers();

export const routineJobsModule: AppModuleManifest = {
  id: routeDeclarations.moduleId,
  name: "Trabajos de rutina",
  description:
    "Trabajos de base de datos recurrentes. Primer trabajo: cargar el padrón a partir de las tablas catastrales rural y urbana.",
  endpoints: defineModuleEndpoints(routeDeclarations, {
    "POST catalog/tables": handlers.listTables,
    "POST catalog/columns": handlers.listColumns,
    "POST cargar-padrones/start": handlers.startCargarPadrones,
    "GET cargar-padrones/status": handlers.readCargarPadronesStatus,
  }),
};
