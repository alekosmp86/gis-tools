import { createModuleRegistry } from "@/core/modules/createModuleRegistry";
import type { UiContribution } from "@/ui-kit/modules/contracts";
import type { AppModuleManifest } from "@/ui-kit/modules/contracts";

/**
 * Composition root.
 *
 * This is the only file in the application permitted to name a module — the lint boundaries make
 * that a build error everywhere else. Core and ui-kit depend on the module *contracts*, never on a
 * module, so this list is the single point of coupling between the application and its extensions.
 *
 * To add a module: import its manifest and add it to the array below.
 * To remove one: delete its folder and delete its line. Nothing else refers to it.
 *
 * An empty list is a valid, fully working application.
 */
const activeModules: ReadonlyArray<AppModuleManifest> = [];

export const moduleRegistry = createModuleRegistry<UiContribution>(activeModules);
