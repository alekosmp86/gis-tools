import type { ModuleEndpointHandler, ModuleHttpMethod, ModuleRegistry } from "./contracts";

/**
 * Dispatcher used by the generated route files.
 *
 * A generated route knows two strings — its method and its route path — and nothing else. It never
 * imports a module: it asks the registry supplied by the composition root who serves that route, so
 * the invariant that only the composition root names a module survives code generation.
 *
 * Resolution happens per request rather than at module load, so a route file left behind by a
 * deleted module answers 404 instead of crashing the server at boot.
 */

const UNSERVED_ROUTE_STATUS = 404;

function buildUnservedRouteResponse(method: ModuleHttpMethod, routePath: string): Response {
  return Response.json(
    {
      success: false,
      error: `Ningún módulo registrado atiende "${method} ${routePath}". Es posible que el módulo se haya eliminado sin regenerar las rutas (npm run modules:routes).`,
    },
    { status: UNSERVED_ROUTE_STATUS }
  );
}

export function createModuleRouteHandler<TUiContribution>(
  registry: ModuleRegistry<TUiContribution>,
  method: ModuleHttpMethod,
  routePath: string
): ModuleEndpointHandler {
  return (request: Request) => {
    const registered = registry.findEndpoint(method, routePath);

    if (!registered) {
      return buildUnservedRouteResponse(method, routePath);
    }

    return registered.endpoint.handler(request);
  };
}
