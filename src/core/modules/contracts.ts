/**
 * Module contracts.
 *
 * Defined in core, implemented by modules, referenced by neither. Core depends on the *shape* of a
 * module and never on any instance: the only file permitted to name a module is the composition
 * root, which is what makes a module deletable.
 *
 * The manifest is generic over its UI contribution type so this file can stay headless. Core has no
 * opinion about React; `ui-kit` supplies the concrete contribution type and re-exports a narrowed
 * manifest for module authors.
 */

/** HTTP methods a module endpoint may declare. */
export const ModuleHttpMethod = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
} as const;

export type ModuleHttpMethod = (typeof ModuleHttpMethod)[keyof typeof ModuleHttpMethod];

/**
 * Execution environment a generated route requests from the host framework.
 *
 * Honoured by the route generator, which emits it as the route's `runtime` export. It exists only
 * because something reads it: configuration the system ignores is worse than configuration it does
 * not offer.
 */
export const ModuleRuntime = {
  NODEJS: "nodejs",
  EDGE: "edge",
} as const;

export type ModuleRuntime = (typeof ModuleRuntime)[keyof typeof ModuleRuntime];

/** Caching behaviour a generated route requests, emitted as the route's `dynamic` export. */
export const ModuleRouteDynamic = {
  AUTO: "auto",
  FORCE_DYNAMIC: "force-dynamic",
  FORCE_STATIC: "force-static",
  ERROR: "error",
} as const;

export type ModuleRouteDynamic = (typeof ModuleRouteDynamic)[keyof typeof ModuleRouteDynamic];

/**
 * Serves a module endpoint.
 *
 * Receives and returns the Web platform Request/Response, not a Next-specific type, so core stays
 * independent of the framework and a module could be lifted out to another host.
 */
export type ModuleEndpointHandler = (request: Request) => Response | Promise<Response>;

/**
 * One endpoint contributed by a module.
 *
 * Endpoints are not hand-written: they are produced by `defineModuleEndpoints`, which binds the
 * module's `module.routes.json` declarations to handlers. That JSON is also what the route
 * generator reads, so the served surface and the registered surface cannot drift.
 */
export interface ModuleEndpoint {
  /** Path relative to the module, e.g. "records/stream". No leading slash. */
  readonly path: string;
  readonly method: ModuleHttpMethod;
  readonly handler: ModuleEndpointHandler;
  /** Requested execution environment. Omitted means the host default. */
  readonly runtime?: ModuleRuntime;
  /** Requested caching behaviour. Omitted means the host default. */
  readonly dynamic?: ModuleRouteDynamic;
}

/**
 * One endpoint as declared in a module's `module.routes.json`.
 *
 * Fields arrive from JSON, so they are typed loosely here and narrowed by validation: a declaration
 * that names an unknown method or runtime must fail at startup, not resolve to `undefined`.
 */
export interface ModuleRouteDeclaration {
  readonly path: string;
  readonly method: string;
  readonly runtime?: string;
  readonly dynamic?: string;
}

/**
 * A module's route declaration file.
 *
 * The single source of truth for the module's HTTP surface: the manifest imports it to bind
 * handlers, and the generator reads it to emit routes. Neither side may add an endpoint the other
 * does not know about.
 */
export interface ModuleRouteDeclarationFile {
  readonly moduleId: string;
  readonly endpoints: ReadonlyArray<ModuleRouteDeclaration>;
}

/** A navigation entry a module wants surfaced by the host application. */
export interface ModuleNavigationEntry {
  readonly label: string;
  readonly href: string;
  /** Icon resolved by name at render time, so this stays free of component references. */
  readonly iconName?: string;
  readonly order?: number;
}

/**
 * What a module declares about itself.
 *
 * @typeParam TUiContribution - concrete UI contribution type, supplied by the presentation layer.
 */
export interface ModuleManifest<TUiContribution = never> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly endpoints?: ReadonlyArray<ModuleEndpoint>;
  readonly navigation?: ReadonlyArray<ModuleNavigationEntry>;
  readonly ui?: ReadonlyArray<TUiContribution>;
}

/** An endpoint paired with the module that contributed it. */
export interface RegisteredEndpoint {
  readonly moduleId: string;
  readonly endpoint: ModuleEndpoint;
  /** Full path served by the generated route, e.g. "reports/records/stream". */
  readonly routePath: string;
}

/** Read model exposed to hosts. Deliberately query-only: nothing registers after construction. */
export interface ModuleRegistry<TUiContribution = never> {
  readonly modules: ReadonlyArray<ModuleManifest<TUiContribution>>;
  findById(moduleId: string): ModuleManifest<TUiContribution> | null;
  endpoints(): ReadonlyArray<RegisteredEndpoint>;
  /**
   * Resolves the endpoint a generated route delegates to. Returns null when no module serves it,
   * which is exactly what a deleted module looks like to a route file left behind.
   */
  findEndpoint(method: ModuleHttpMethod, routePath: string): RegisteredEndpoint | null;
  navigation(): ReadonlyArray<ModuleNavigationEntry>;
  uiContributions(): ReadonlyArray<TUiContribution>;
}
