import {
  createAvanceFtthHandlers,
  type AvanceFtthHandlerDependencies,
  type AvanceFtthHandlers,
} from "../avance-ftth/api/handlers";
import {
  createIndicatorsHandlers,
  type IndicatorsHandlerDependencies,
  type IndicatorsHandlers,
} from "../indicators/api/handlers";
import { createShpHandlers, type ShpHandlerDependencies, type ShpHandlers } from "../shp/api/handlers";

/**
 * Module-level handler assembly. Each part of the module contributes its handler set here, and
 * the manifest binds them to the declared endpoints.
 */
interface CoverageLoadsHandlers {
  readonly indicators: IndicatorsHandlers;
  readonly shp: ShpHandlers;
  readonly avanceFtth: AvanceFtthHandlers;
}

export function createCoverageLoadsHandlers(
  indicatorsDependencies: IndicatorsHandlerDependencies = {},
  shpDependencies: ShpHandlerDependencies = {},
  avanceFtthDependencies: AvanceFtthHandlerDependencies = {}
): CoverageLoadsHandlers {
  return {
    indicators: createIndicatorsHandlers(indicatorsDependencies),
    shp: createShpHandlers(shpDependencies),
    avanceFtth: createAvanceFtthHandlers(avanceFtthDependencies),
  };
}
