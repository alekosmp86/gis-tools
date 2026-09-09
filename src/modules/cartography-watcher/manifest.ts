import { defineModuleEndpoints } from "@/core/modules/defineModuleEndpoints";
import { definePageContributions } from "@/core/modules/definePageContributions";
import { UiSlot } from "@/ui-kit/modules/contracts";
import type { AppModuleManifest } from "@/ui-kit/modules/contracts";
import routeDeclarations from "./module.routes.json";
import { createWatcherHandlers } from "./api/handlers";
import { CatalogTreeSelector } from "./ui/CatalogTreeSelector";
import { WatcherDashboard } from "./ui/WatcherDashboard";
import { WatcherHomeCard } from "./ui/WatcherHomeCard";
import { CatalogTabIcon } from "./ui/contributionIcons";

/**
 * The cartography watcher module.
 *
 * Everything it contributes is optional and independently removable: six endpoints, one page it
 * owns outright, a card in the home grid and a catalogue tab inside the sync tools. Nothing in core
 * names it except the composition root.
 */
const handlers = createWatcherHandlers();

export const cartographyWatcherModule: AppModuleManifest = {
  id: routeDeclarations.moduleId,
  name: "Observador de Actualizaciones Cartográficas",
  description:
    "Vigila catálogos CKAN abiertos, detecta publicaciones nuevas y mantiene un vault local de archivos cartográficos.",
  endpoints: defineModuleEndpoints(routeDeclarations, {
    "GET sources": handlers.listSources,
    "POST sources": handlers.addSource,
    "POST sources/remove": handlers.removeSource,
    "GET summaries": handlers.readSummaries,
    "GET catalog": handlers.readCatalog,
    "GET catalog/file": handlers.readCatalogFile,
  }),
  pages: definePageContributions(routeDeclarations, {
    "": WatcherDashboard,
  }),
  navigation: [
    {
      label: "Observador Cartográfico",
      href: "/tools/m/cartography-watcher",
      iconName: "Radio",
      order: 100,
    },
  ],
  ui: [
    {
      slot: UiSlot.HOME_TOOL_GRID,
      id: "cartography-watcher.card",
      order: 100,
      Component: WatcherHomeCard,
    },
    {
      slot: UiSlot.FILE_SOURCE_TABS,
      id: "cartography-watcher.catalog",
      order: 100,
      label: "Catálogo Cartográfico",
      Icon: CatalogTabIcon,
      Component: CatalogTreeSelector,
    },
  ],
};
