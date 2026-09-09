import type {
  ModulePage,
  ModulePageDeclaration,
  ModuleRouteDeclarationFile,
} from "./contracts";
import { normalizeModuleEndpointPath } from "./moduleRoutePaths";

/**
 * Binds a module's page declarations to the components that render them.
 *
 * The same contract as `defineModuleEndpoints`, for the other half of a module's routed surface:
 * `module.routes.json` is read by the generator to emit page routes and by the manifest to bind
 * components, and the two are checked against each other at startup. A declared page with no
 * component, or a component for a page nobody declared, throws rather than producing a route that
 * renders nothing.
 */

/** Components keyed by their declared path; the module root is keyed by the empty string. */
export type ModulePageComponentMap<TPageComponent> = Readonly<
  Record<string, TPageComponent>
>;

function assertUniqueDeclarations(
  declarations: ReadonlyArray<ModulePageDeclaration>,
  moduleId: string
): void {
  const seenPaths = new Set<string>();

  for (const declaration of declarations) {
    const normalizedPath = normalizeModuleEndpointPath(declaration.path);
    if (seenPaths.has(normalizedPath)) {
      throw new Error(
        `Module "${moduleId}" declares page "${normalizedPath}" twice in module.routes.json. Each page path may be declared once.`
      );
    }
    seenPaths.add(normalizedPath);
  }
}

function assertNoUnusedComponents<TPageComponent>(
  components: ModulePageComponentMap<TPageComponent>,
  boundPaths: ReadonlySet<string>,
  moduleId: string
): void {
  const unusedPaths = Object.keys(components).filter((path) => !boundPaths.has(path));

  if (unusedPaths.length > 0) {
    throw new Error(
      `Module "${moduleId}" supplies page components for "${unusedPaths.join('", "')}", which module.routes.json does not declare. Declare the page or remove the component.`
    );
  }
}

function resolveComponent<TPageComponent>(
  normalizedPath: string,
  components: ModulePageComponentMap<TPageComponent>,
  moduleId: string
): TPageComponent {
  const component = components[normalizedPath];

  if (!component) {
    throw new Error(
      `Module "${moduleId}" declares page "${normalizedPath}" in module.routes.json but supplies no component for it. Add a component under that key.`
    );
  }

  return component;
}

export function definePageContributions<TPageComponent>(
  declarationFile: ModuleRouteDeclarationFile,
  components: ModulePageComponentMap<TPageComponent>
): ReadonlyArray<ModulePage<TPageComponent>> {
  const { moduleId, pages: declarations = [] } = declarationFile;

  assertUniqueDeclarations(declarations, moduleId);

  const boundPaths = new Set<string>();
  const pages = declarations.map((declaration) => {
    const normalizedPath = normalizeModuleEndpointPath(declaration.path);
    boundPaths.add(normalizedPath);

    return {
      path: normalizedPath,
      title: declaration.title,
      Component: resolveComponent(normalizedPath, components, moduleId),
    };
  });

  assertNoUnusedComponents(components, boundPaths, moduleId);

  return pages;
}
