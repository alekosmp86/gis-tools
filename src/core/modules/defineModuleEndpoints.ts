import {
  ModuleHttpMethod,
  ModuleRouteDynamic,
  ModuleRuntime,
  type ModuleEndpoint,
  type ModuleEndpointHandler,
  type ModuleRouteDeclaration,
  type ModuleRouteDeclarationFile,
} from "./contracts";
import { moduleEndpointKey, normalizeModuleEndpointPath } from "./moduleRoutePaths";

/**
 * Binds a module's route declarations to the handlers that serve them.
 *
 * `module.routes.json` is the single source of truth for a module's HTTP surface: the route
 * generator reads it to emit Next routes, and the manifest reads the same file to register
 * handlers. This function is where the two halves are checked against each other — a declared
 * endpoint with no handler, or a handler for an endpoint nobody declared, throws at startup rather
 * than producing a route that answers 404 in production.
 *
 * Values arriving from JSON are untyped, so methods, runtimes and caching modes are validated here
 * as well: a typo in a declaration must fail loudly, not silently become `undefined`.
 */

/** Handlers keyed by `moduleEndpointKey`, e.g. `"GET records/stream"` or `"GET"` for the root. */
export type ModuleEndpointHandlerMap = Readonly<Record<string, ModuleEndpointHandler>>;

const VALID_METHODS = new Set<string>(Object.values(ModuleHttpMethod));
const VALID_RUNTIMES = new Set<string>(Object.values(ModuleRuntime));
const VALID_DYNAMICS = new Set<string>(Object.values(ModuleRouteDynamic));

function describeAllowed(allowed: ReadonlySet<string>): string {
  return [...allowed].join(", ");
}

function assertValidMethod(declaration: ModuleRouteDeclaration, moduleId: string): void {
  if (!VALID_METHODS.has(declaration.method)) {
    throw new Error(
      `Module "${moduleId}" declares endpoint "${declaration.path}" with unsupported method "${declaration.method}". Supported methods: ${describeAllowed(VALID_METHODS)}.`
    );
  }
}

function assertValidRuntime(declaration: ModuleRouteDeclaration, moduleId: string): void {
  if (declaration.runtime !== undefined && !VALID_RUNTIMES.has(declaration.runtime)) {
    throw new Error(
      `Module "${moduleId}" declares endpoint "${declaration.path}" with unsupported runtime "${declaration.runtime}". Supported runtimes: ${describeAllowed(VALID_RUNTIMES)}.`
    );
  }
}

function assertValidDynamic(declaration: ModuleRouteDeclaration, moduleId: string): void {
  if (declaration.dynamic !== undefined && !VALID_DYNAMICS.has(declaration.dynamic)) {
    throw new Error(
      `Module "${moduleId}" declares endpoint "${declaration.path}" with unsupported dynamic mode "${declaration.dynamic}". Supported modes: ${describeAllowed(VALID_DYNAMICS)}.`
    );
  }
}

/**
 * Rejects a declaration file that lists the same method and path twice, which would otherwise bind
 * one of the two handlers arbitrarily.
 */
function assertUniqueDeclarations(
  declarations: ReadonlyArray<ModuleRouteDeclaration>,
  moduleId: string
): void {
  const seenKeys = new Set<string>();

  for (const declaration of declarations) {
    const key = moduleEndpointKey(declaration.method, declaration.path);
    if (seenKeys.has(key)) {
      throw new Error(
        `Module "${moduleId}" declares "${key}" twice in module.routes.json. Each method and path pair may be declared once.`
      );
    }
    seenKeys.add(key);
  }
}

/** Rejects handlers that answer to nothing, which are dead code the generator will never serve. */
function assertNoUnusedHandlers(
  handlers: ModuleEndpointHandlerMap,
  boundKeys: ReadonlySet<string>,
  moduleId: string
): void {
  const unusedKeys = Object.keys(handlers).filter((key) => !boundKeys.has(key));

  if (unusedKeys.length > 0) {
    throw new Error(
      `Module "${moduleId}" supplies handlers for "${unusedKeys.join('", "')}", which module.routes.json does not declare. Declare the endpoint or remove the handler.`
    );
  }
}

function resolveHandler(
  declaration: ModuleRouteDeclaration,
  handlers: ModuleEndpointHandlerMap,
  moduleId: string
): ModuleEndpointHandler {
  const key = moduleEndpointKey(declaration.method, declaration.path);
  const handler = handlers[key];

  if (!handler) {
    throw new Error(
      `Module "${moduleId}" declares "${key}" in module.routes.json but supplies no handler for it. Add a handler under that key.`
    );
  }

  return handler;
}

function toEndpoint(
  declaration: ModuleRouteDeclaration,
  handler: ModuleEndpointHandler
): ModuleEndpoint {
  return {
    path: normalizeModuleEndpointPath(declaration.path),
    method: declaration.method as ModuleHttpMethod,
    handler,
    runtime: declaration.runtime as ModuleRuntime | undefined,
    dynamic: declaration.dynamic as ModuleRouteDynamic | undefined,
  };
}

export function defineModuleEndpoints(
  declarationFile: ModuleRouteDeclarationFile,
  handlers: ModuleEndpointHandlerMap
): ReadonlyArray<ModuleEndpoint> {
  const { moduleId, endpoints: declarations } = declarationFile;

  assertUniqueDeclarations(declarations, moduleId);

  const boundKeys = new Set<string>();
  const endpoints = declarations.map((declaration) => {
    assertValidMethod(declaration, moduleId);
    assertValidRuntime(declaration, moduleId);
    assertValidDynamic(declaration, moduleId);

    boundKeys.add(moduleEndpointKey(declaration.method, declaration.path));
    return toEndpoint(declaration, resolveHandler(declaration, handlers, moduleId));
  });

  assertNoUnusedHandlers(handlers, boundKeys, moduleId);

  return endpoints;
}
