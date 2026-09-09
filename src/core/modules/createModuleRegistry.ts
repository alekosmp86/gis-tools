import type {
  ModuleManifest,
  ModuleNavigationEntry,
  ModuleRegistry,
  RegisteredEndpoint,
} from "./contracts";

/** Separator between a module id and its endpoint path in the generated route surface. */
const ROUTE_SEGMENT_SEPARATOR = "/";

/** Module ids become URL segments and directory names, so they are constrained. */
const VALID_MODULE_ID = /^[a-z][a-z0-9-]*$/;

/**
 * Validates ids so a malformed module fails at construction rather than producing a broken route.
 */
function assertValidModuleId(moduleId: string): void {
  if (!VALID_MODULE_ID.test(moduleId)) {
    throw new Error(
      `Invalid module id "${moduleId}". Ids become URL segments and folder names, so they must be lowercase and may contain only letters, digits and hyphens.`
    );
  }
}

/**
 * Rejects two modules claiming the same id, which would make registry lookups ambiguous and
 * silently shadow one module's endpoints with another's.
 */
function assertUniqueModuleIds(manifests: ReadonlyArray<ModuleManifest<never>>): void {
  const seenIds = new Set<string>();

  for (const manifest of manifests) {
    if (seenIds.has(manifest.id)) {
      throw new Error(
        `Duplicate module id "${manifest.id}". Each module must be registered once in the composition root.`
      );
    }
    seenIds.add(manifest.id);
  }
}

/**
 * Rejects two endpoints resolving to the same route, which would otherwise be decided by
 * registration order.
 */
function assertUniqueRoutes(endpoints: ReadonlyArray<RegisteredEndpoint>): void {
  const seenRoutes = new Set<string>();

  for (const registered of endpoints) {
    const routeKey = `${registered.endpoint.method} ${registered.routePath}`;
    if (seenRoutes.has(routeKey)) {
      throw new Error(
        `Duplicate module route "${routeKey}" contributed by "${registered.moduleId}". Two endpoints cannot serve the same method and path.`
      );
    }
    seenRoutes.add(routeKey);
  }
}

/** Normalises a declared endpoint path into the route it will be served at. */
function resolveRoutePath(moduleId: string, endpointPath: string): string {
  const trimmedPath = endpointPath.replace(/^\/+|\/+$/g, "");
  return trimmedPath.length === 0
    ? moduleId
    : `${moduleId}${ROUTE_SEGMENT_SEPARATOR}${trimmedPath}`;
}

function collectEndpoints<TUiContribution>(
  manifests: ReadonlyArray<ModuleManifest<TUiContribution>>
): ReadonlyArray<RegisteredEndpoint> {
  const collected: RegisteredEndpoint[] = [];

  for (const manifest of manifests) {
    for (const endpoint of manifest.endpoints ?? []) {
      collected.push({
        moduleId: manifest.id,
        endpoint,
        routePath: resolveRoutePath(manifest.id, endpoint.path),
      });
    }
  }

  return collected;
}

function collectNavigation<TUiContribution>(
  manifests: ReadonlyArray<ModuleManifest<TUiContribution>>
): ReadonlyArray<ModuleNavigationEntry> {
  const collected = manifests.flatMap((manifest) => [...(manifest.navigation ?? [])]);
  return collected.sort(
    (first, second) => (first.order ?? Number.MAX_SAFE_INTEGER) - (second.order ?? Number.MAX_SAFE_INTEGER)
  );
}

/**
 * Builds the registry from the manifests supplied by the composition root.
 *
 * Validation happens here, at startup, so a misconfigured module fails loudly and immediately
 * instead of producing a route that quietly never resolves. An empty list is valid and yields a
 * registry that answers every query with nothing — which is what makes removing the last module a
 * non-event.
 */
export function createModuleRegistry<TUiContribution = never>(
  manifests: ReadonlyArray<ModuleManifest<TUiContribution>> = []
): ModuleRegistry<TUiContribution> {
  for (const manifest of manifests) {
    assertValidModuleId(manifest.id);
  }
  assertUniqueModuleIds(manifests as ReadonlyArray<ModuleManifest<never>>);

  const endpoints = collectEndpoints(manifests);
  assertUniqueRoutes(endpoints);

  const navigation = collectNavigation(manifests);
  const uiContributions = manifests.flatMap((manifest) => [...(manifest.ui ?? [])]);
  const modulesById = new Map(manifests.map((manifest) => [manifest.id, manifest]));

  return {
    modules: manifests,
    findById: (moduleId) => modulesById.get(moduleId) ?? null,
    endpoints: () => endpoints,
    navigation: () => navigation,
    uiContributions: () => uiContributions,
  };
}
