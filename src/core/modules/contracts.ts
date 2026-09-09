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

/** Execution environment for a generated route, mirroring the Next segment option. */
export const ModuleRuntime = {
  NODE: "nodejs",
  EDGE: "edge",
} as const;

export type ModuleRuntime = (typeof ModuleRuntime)[keyof typeof ModuleRuntime];

/**
 * One endpoint contributed by a module.
 *
 * `handler` receives and returns the Web platform Request/Response, not a Next-specific type, so
 * core stays independent of the framework and a module could be lifted out to another host.
 */
export interface ModuleEndpoint {
  /** Path relative to the module, e.g. "records/stream". No leading slash. */
  readonly path: string;
  readonly method: ModuleHttpMethod;
  readonly handler: (request: Request) => Response | Promise<Response>;
  /** Per-route configuration carried through to the generated route file. */
  readonly runtime?: ModuleRuntime;
  /** Opt out of static optimisation for streaming or per-request work. */
  readonly dynamic?: boolean;
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
  navigation(): ReadonlyArray<ModuleNavigationEntry>;
  uiContributions(): ReadonlyArray<TUiContribution>;
}
