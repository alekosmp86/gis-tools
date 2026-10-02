import { defineModuleEndpoints } from "@/core/modules/defineModuleEndpoints";
import { definePageContributions } from "@/core/modules/definePageContributions";
import { UiSlot } from "@/ui-kit/modules/contracts";
import type { AppModuleManifest } from "@/ui-kit/modules/contracts";
import routeDeclarations from "./module.routes.json";
import { createDedupHandlers } from "./api/handlers";
import { DedupDashboard } from "./ui/DedupDashboard";
import { DedupHomeCard } from "./ui/DedupHomeCard";

/**
 * The address duplicate analysis module.
 *
 * Read-only: Postgres runs the validated v3 query and the module presents and exports the result.
 * Everything it contributes is optional and independently removable; nothing in core names it
 * except the composition root.
 */
const handlers = createDedupHandlers();

export const addressDedupModule: AppModuleManifest = {
  id: routeDeclarations.moduleId,
  name: "Duplicados de Direcciones",
  description:
    "Detecta direcciones duplicadas entre ANTEL, TLK e IDE directamente en PostgreSQL y exporta el resultado para QGIS. Solo lectura.",
  endpoints: defineModuleEndpoints(routeDeclarations, {
    "POST analyze": handlers.analyze,
    "POST export": handlers.exportResult,
  }),
  pages: definePageContributions(routeDeclarations, {
    "": DedupDashboard,
  }),
  navigation: [
    {
      label: "Duplicados de Direcciones",
      href: "/tools/m/address-dedup",
      iconName: "CopyCheck",
      order: 110,
    },
  ],
  ui: [
    {
      slot: UiSlot.HOME_TOOL_GRID,
      id: "address-dedup.card",
      order: 110,
      Component: DedupHomeCard,
    },
  ],
};
