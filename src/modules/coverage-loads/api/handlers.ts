import {
  createIndicatorsHandlers,
  type IndicatorsHandlerDependencies,
  type IndicatorsHandlers,
} from "../indicators/api/handlers";

/**
 * Module-level handler assembly. Each part of the module (today only the indicators) contributes
 * its handler set here, and the manifest binds them to the declared endpoints.
 */
interface CoverageLoadsHandlers {
  readonly indicators: IndicatorsHandlers;
}

export function createCoverageLoadsHandlers(
  indicatorsDependencies: IndicatorsHandlerDependencies = {}
): CoverageLoadsHandlers {
  return { indicators: createIndicatorsHandlers(indicatorsDependencies) };
}
