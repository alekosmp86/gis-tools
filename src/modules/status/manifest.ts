import { defineModuleEndpoints } from "@/core/modules/defineModuleEndpoints";
import { UiSlot } from "@/ui-kit/modules/contracts";
import type { AppModuleManifest } from "@/ui-kit/modules/contracts";
import routeDeclarations from "./module.routes.json";
import { readServerStatus } from "./api/statusHandler";
import { ServerStatusCard } from "./ui/ServerStatusCard";

/**
 * The status module: the reference implementation of a module.
 *
 * Its id comes from the same declaration file the route generator reads, so the folder, the served
 * prefix and the registered id cannot disagree. Everything it contributes is optional — strip any
 * of the three and the application still runs.
 */
export const statusModule: AppModuleManifest = {
  id: routeDeclarations.moduleId,
  name: "Estado del Servidor",
  description:
    "Publica el tiempo de actividad, la versión de Node.js y el entorno de ejecución del servidor.",
  endpoints: defineModuleEndpoints(routeDeclarations, {
    GET: readServerStatus,
  }),
  navigation: [
    {
      label: "Estado del Servidor",
      href: "/api/m/status",
      iconName: "Activity",
      order: 100,
    },
  ],
  ui: [
    {
      slot: UiSlot.HOME_TOOL_GRID,
      id: "status.card",
      order: 100,
      Component: ServerStatusCard,
    },
  ],
};
