import { defineModuleEndpoints } from "@/core/modules/defineModuleEndpoints";
import { definePageContributions } from "@/core/modules/definePageContributions";
import { UiSlot } from "@/ui-kit/modules/contracts";
import type { AppModuleManifest } from "@/ui-kit/modules/contracts";
import routeDeclarations from "./module.routes.json";
import { createCoverageLoadsHandlers } from "./api/handlers";
import { CoverageLoadsDashboard } from "./ui/CoverageLoadsDashboard";
import { CoverageLoadsHomeCard } from "./ui/CoverageLoadsHomeCard";
import { ShpStatusChip } from "./shp/ui/ShpStatusChip";

/**
 * Cargas de Coberturas. Three parts: Indicadores LTE (`indicators/`), Cargas SHP (`shp/`) and
 * Avance FTTH (`avance-ftth/`, the two CSV planillas that rebuild the Avance table). The page (a
 * stage workflow) and the home card are optional contributions and leave with the module.
 */
const handlers = createCoverageLoadsHandlers();

export const coverageLoadsModule: AppModuleManifest = {
  id: routeDeclarations.moduleId,
  name: "Cargas de Coberturas",
  description:
    "Carga los indicadores de cobertura LTE (IndicadoresLTE_aaaammdd.csv) al histórico reemplazando el corte, y genera los tres reportes CSV.",
  wiki: { contentDir: "src/modules/coverage-loads/wiki" },
  endpoints: defineModuleEndpoints(routeDeclarations, {
    "POST indicators/plan": handlers.indicators.plan,
    "POST indicators/load": handlers.indicators.load,
    "POST indicators/reports": handlers.indicators.reports,
    "POST avance-ftth/plan": handlers.avanceFtth.plan,
    "POST avance-ftth/load": handlers.avanceFtth.load,
    "POST avance-ftth/reports": handlers.avanceFtth.reports,
    "POST shp/upload": handlers.shp.upload,
    "POST shp/plan": handlers.shp.plan,
    "POST shp/start": handlers.shp.start,
    "GET shp/status": handlers.shp.status,
    "GET shp/jobs": handlers.shp.jobs,
    "POST shp/cancel": handlers.shp.cancel,
    "GET shp/log": handlers.shp.log,
    "POST shp/discard": handlers.shp.discard,
  }),
  pages: definePageContributions(routeDeclarations, {
    "": CoverageLoadsDashboard,
  }),
  navigation: [
    {
      label: "Cargas de Coberturas",
      href: "/tools/m/coverage-loads",
      iconName: "DatabaseZap",
      order: 120,
    },
  ],
  ui: [
    {
      slot: UiSlot.HOME_TOOL_GRID,
      id: "coverage-loads.card",
      order: 120,
      Component: CoverageLoadsHomeCard,
    },
    {
      slot: UiSlot.APP_STATUS,
      id: "coverage-loads.shpStatus",
      order: 120,
      Component: ShpStatusChip,
    },
  ],
};
