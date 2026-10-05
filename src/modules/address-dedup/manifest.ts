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
 * Postgres runs the validated v3 query and the module presents and exports the result. Its one
 * write path deletes confirmed REMOVE candidates only, behind a simulation and a fingerprint check.
 * Everything it contributes is optional and independently removable; nothing in core names it
 * except the composition root.
 */
const handlers = createDedupHandlers();

export const addressDedupModule: AppModuleManifest = {
  id: routeDeclarations.moduleId,
  name: "Duplicados de Direcciones",
  description:
    "Detecta direcciones duplicadas entre ANTEL, TLK e IDE directamente en PostgreSQL y exporta el resultado para QGIS. Puede eliminar los duplicados confirmados, tras simular y confirmar.",
  endpoints: defineModuleEndpoints(routeDeclarations, {
    "POST analyze": handlers.analyze,
    "POST export": handlers.exportResult,
    "POST removal/simulate": handlers.simulateRemoval,
    "POST removal/execute": handlers.executeRemoval,
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
