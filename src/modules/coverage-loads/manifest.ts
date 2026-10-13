import { defineModuleEndpoints } from "@/core/modules/defineModuleEndpoints";
import { definePageContributions } from "@/core/modules/definePageContributions";
import { UiSlot } from "@/ui-kit/modules/contracts";
import type { AppModuleManifest } from "@/ui-kit/modules/contracts";
import routeDeclarations from "./module.routes.json";
import { createCoverageLoadsHandlers } from "./api/handlers";
import { CoverageLoadsDashboard } from "./ui/CoverageLoadsDashboard";
import { CoverageLoadsHomeCard } from "./ui/CoverageLoadsHomeCard";

/**
 * Cargas de Coberturas. Part 2 (Indicadores LTE) is the only part present: the backend loads
 * `IndicadoresLTE_aaaammdd.csv` cuts into the history (replace-the-cut) and produces the three
 * report CSVs. The page (a section switch with "Indicadores LTE") and the home card are optional
 * contributions and leave with the module.
 */
const handlers = createCoverageLoadsHandlers();

export const coverageLoadsModule: AppModuleManifest = {
  id: routeDeclarations.moduleId,
  name: "Cargas de Coberturas",
  description:
    "Carga los indicadores de cobertura LTE (IndicadoresLTE_aaaammdd.csv) al histórico reemplazando el corte, y genera los tres reportes CSV.",
  endpoints: defineModuleEndpoints(routeDeclarations, {
    "POST indicators/plan": handlers.indicators.plan,
    "POST indicators/load": handlers.indicators.load,
    "POST indicators/reports": handlers.indicators.reports,
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
  ],
};
