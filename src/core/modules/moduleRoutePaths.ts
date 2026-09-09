import type { ModuleHttpMethod } from "./contracts";

/**
 * Path arithmetic shared by everything that reasons about a module's HTTP surface.
 *
 * The registry, the endpoint binder and the generated routes must all agree on what a declared
 * path becomes; keeping the rule in one place is what makes that agreement structural rather than
 * coincidental. The generator is a plain Node script and cannot import this file, so it mirrors
 * these rules and a unit test holds the two implementations to the same answers.
 */

/** Separator between a module id and its endpoint path in the generated route surface. */
const ROUTE_SEGMENT_SEPARATOR = "/";

/** Strips the leading and trailing slashes a declaration may carry, and collapses nothing else. */
export function normalizeModuleEndpointPath(endpointPath: string): string {
  return endpointPath.replace(/^\/+|\/+$/g, "");
}

/** Normalises a declared endpoint path into the route it will be served at. */
export function resolveModuleRoutePath(moduleId: string, endpointPath: string): string {
  const normalizedPath = normalizeModuleEndpointPath(endpointPath);
  return normalizedPath.length === 0
    ? moduleId
    : `${moduleId}${ROUTE_SEGMENT_SEPARATOR}${normalizedPath}`;
}

/**
 * Key identifying one endpoint within a module: the method, plus the path when there is one.
 *
 * Module authors write these keys in the handler map they pass to `defineModuleEndpoints`, so the
 * form is deliberately readable: `"GET records/stream"`, or plain `"GET"` for the module root.
 */
export function moduleEndpointKey(method: ModuleHttpMethod | string, endpointPath: string): string {
  const normalizedPath = normalizeModuleEndpointPath(endpointPath);
  return normalizedPath.length === 0 ? method : `${method} ${normalizedPath}`;
}
