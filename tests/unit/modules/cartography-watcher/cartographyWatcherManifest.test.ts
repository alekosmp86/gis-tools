import { describe, it, expect } from "vitest";
import { createModuleRegistry } from "@/core/modules/createModuleRegistry";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import { UiSlot } from "@/ui-kit/modules/contracts";
import { cartographyWatcherModule } from "@/modules/cartography-watcher/manifest";
import routeDeclarations from "@/modules/cartography-watcher/module.routes.json";

/**
 * Guards the wiring between the declaration file, the manifest and the registry. The behaviour
 * behind each handler is covered separately; what matters here is that every declared route is
 * bound, and that nothing is contributed into a slot no host mounts.
 */

/** Slots a host actually renders today. Contributing anywhere else renders nowhere, silently. */
const MOUNTED_SLOTS: ReadonlyArray<UiSlot> = [UiSlot.HOME_TOOL_GRID, UiSlot.FILE_SOURCE_TABS];

describe("cartography watcher manifest", () => {
  it("should take its id from the declaration file the generator reads", () => {
    expect(cartographyWatcherModule.id).toBe("cartography-watcher");
    expect(cartographyWatcherModule.id).toBe(routeDeclarations.moduleId);
  });

  it("should bind a handler to every declared endpoint", () => {
    // Arrange
    const declaredCount = routeDeclarations.endpoints.length;

    // Act
    const endpoints = cartographyWatcherModule.endpoints ?? [];

    // Assert: defineModuleEndpoints throws on a mismatch, so this pins the count as well.
    expect(endpoints).toHaveLength(declaredCount);
    expect(endpoints.every((endpoint) => typeof endpoint.handler === "function")).toBe(true);
  });

  it("should serve every endpoint dynamically on the node runtime", () => {
    // Arrange & Act
    const endpoints = cartographyWatcherModule.endpoints ?? [];

    // Assert: the vault and the portal are both server-side, and a cached catalogue would report
    // stale deltas for ever.
    expect(endpoints.every((endpoint) => endpoint.runtime === "nodejs")).toBe(true);
    expect(endpoints.every((endpoint) => endpoint.dynamic === "force-dynamic")).toBe(true);
  });

  it("should expose the routes the browser client calls", () => {
    // Arrange
    const registry = createModuleRegistry([cartographyWatcherModule]);

    // Act & Assert
    const expectedRoutes: ReadonlyArray<[ModuleHttpMethod, string]> = [
      [ModuleHttpMethod.GET, "cartography-watcher/sources"],
      [ModuleHttpMethod.POST, "cartography-watcher/sources"],
      [ModuleHttpMethod.POST, "cartography-watcher/sources/remove"],
      [ModuleHttpMethod.GET, "cartography-watcher/summaries"],
      [ModuleHttpMethod.GET, "cartography-watcher/catalog"],
      [ModuleHttpMethod.GET, "cartography-watcher/catalog/file"],
    ];

    for (const [method, routePath] of expectedRoutes) {
      expect(registry.findEndpoint(method, routePath)?.moduleId).toBe("cartography-watcher");
    }
  });

  it("should own the page the home card links to", () => {
    // Arrange
    const registry = createModuleRegistry([cartographyWatcherModule]);

    // Act
    const page = registry.findPage("cartography-watcher");

    // Assert
    expect(page?.moduleId).toBe("cartography-watcher");
    expect(typeof page?.page.Component).toBe("function");
  });

  it("should contribute only into slots a host actually mounts", () => {
    // Arrange & Act
    const contributions = cartographyWatcherModule.ui ?? [];

    // Assert
    expect(contributions).toHaveLength(2);
    for (const contribution of contributions) {
      expect(MOUNTED_SLOTS).toContain(contribution.slot);
    }
  });

  it("should give the file source contribution the chrome a tab strip needs", () => {
    // Arrange
    const contributions = cartographyWatcherModule.ui ?? [];

    // Act
    const tabContribution = contributions.find(
      (contribution) => contribution.slot === UiSlot.FILE_SOURCE_TABS
    );

    // Assert: without a label the tab would be titled with its raw id.
    expect(tabContribution?.label).toBe("Catálogo Cartográfico");
    expect(tabContribution?.Icon).toBeDefined();
  });

  it("should register cleanly beside other modules", () => {
    // Arrange & Act: ids, routes and page routes are all validated at construction.
    const registry = createModuleRegistry([cartographyWatcherModule]);

    // Assert
    expect(registry.modules).toHaveLength(1);
    expect(registry.endpoints()).toHaveLength(routeDeclarations.endpoints.length);
    expect(registry.pages()).toHaveLength(1);
    expect(registry.navigation()).toHaveLength(1);
  });

  it("should leave an application that does not register it completely unaffected", () => {
    // Arrange: the deletion property, asserted rather than assumed.
    const registry = createModuleRegistry();

    // Assert
    expect(registry.findEndpoint(ModuleHttpMethod.GET, "cartography-watcher/sources")).toBeNull();
    expect(registry.findPage("cartography-watcher")).toBeNull();
    expect(registry.uiContributions()).toHaveLength(0);
  });
});
