import {
  createIndicatorsHandlers,
  type IndicatorsHandlerDependencies,
  type IndicatorsHandlers,
} from "../indicators/api/handlers";
import { createShpHandlers, type ShpHandlerDependencies, type ShpHandlers } from "../shp/api/handlers";

/**
 * Module-level handler assembly. Each part of the module (today only the indicators) contributes
 * its handler set here, and the manifest binds them to the declared endpoints.
 */
interface CoverageLoadsHandlers {
  readonly indicators: IndicatorsHandlers;
  readonly shp: ShpHandlers;
}

export function createCoverageLoadsHandlers(
  indicatorsDependencies: IndicatorsHandlerDependencies = {},
  shpDependencies: ShpHandlerDependencies = {}
): CoverageLoadsHandlers {
  return {
    indicators: createIndicatorsHandlers(indicatorsDependencies),
    shp: createShpHandlers(shpDependencies),
  };
}
