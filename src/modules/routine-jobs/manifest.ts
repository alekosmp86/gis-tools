import { defineModuleEndpoints } from "@/core/modules/defineModuleEndpoints";
import { definePageContributions } from "@/core/modules/definePageContributions";
import { UiSlot } from "@/ui-kit/modules/contracts";
import type { AppModuleManifest } from "@/ui-kit/modules/contracts";
import routeDeclarations from "./module.routes.json";
import { createRoutineJobsHandlers } from "./api/handlers";
import { createActualizarPadronHandlers } from "./api/actualizarPadronHandlers";
import { createCargarLocalidadesHandlers } from "./api/cargarLocalidadesHandlers";
import { createUnidadTerritorialHandlers } from "./api/unidadTerritorialHandlers";
import { createCompletarUnidadTerritorialHandlers } from "./api/completarUnidadTerritorialHandlers";
import { RoutineJobsDashboard } from "./ui/RoutineJobsDashboard";
import { RoutineJobsHomeCard } from "./ui/RoutineJobsHomeCard";

/**
 * The routine jobs module: a shell for recurring database jobs, one wizard per job.
 *
 * Its first job is "Cargar padrones". It owns the page at /tools/m/routine-jobs (the job list and
 * the wizard), a card in the home grid, a navigation entry and its wiki.
 */
const handlers = createRoutineJobsHandlers();
const actualizarHandlers = createActualizarPadronHandlers();
const localidadesHandlers = createCargarLocalidadesHandlers();
const unidadHandlers = createUnidadTerritorialHandlers();
const completarHandlers = createCompletarUnidadTerritorialHandlers();

export const routineJobsModule: AppModuleManifest = {
  id: routeDeclarations.moduleId,
  name: "Trabajos de rutina",
  description:
    "Trabajos de base de datos recurrentes. Primer trabajo: cargar el padrón a partir de las tablas catastrales rural y urbana.",
  wiki: { contentDir: "src/modules/routine-jobs/wiki" },
  endpoints: defineModuleEndpoints(routeDeclarations, {
    "POST catalog/tables": handlers.listTables,
    "POST catalog/columns": handlers.listColumns,
    "POST cargar-padrones/start": handlers.startCargarPadrones,
    "GET cargar-padrones/status": handlers.readCargarPadronesStatus,
    "POST actualizar-padron/start": actualizarHandlers.startActualizarPadron,
    "GET actualizar-padron/status": actualizarHandlers.readActualizarPadronStatus,
    "POST cargar-localidades/start": localidadesHandlers.startCargarLocalidades,
    "GET cargar-localidades/status": localidadesHandlers.readCargarLocalidadesStatus,
    "POST unidad-territorial/start": unidadHandlers.startUnidadTerritorial,
    "GET unidad-territorial/status": unidadHandlers.readUnidadTerritorialStatus,
    "POST completar-unidad-territorial/start": completarHandlers.startCompletarUnidadTerritorial,
    "GET completar-unidad-territorial/status": completarHandlers.readCompletarUnidadTerritorialStatus,
  }),
  pages: definePageContributions(routeDeclarations, {
    "": RoutineJobsDashboard,
  }),
  navigation: [
    {
      label: "Trabajos de rutina",
      href: "/tools/m/routine-jobs",
      iconName: "CalendarClock",
      order: 110,
    },
  ],
  ui: [
    {
      slot: UiSlot.HOME_TOOL_GRID,
      id: "routine-jobs.card",
      order: 110,
      Component: RoutineJobsHomeCard,
    },
  ],
};
