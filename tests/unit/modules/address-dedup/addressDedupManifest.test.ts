import { describe, it, expect } from "vitest";
import { createModuleRegistry } from "@/core/modules/createModuleRegistry";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import { UiSlot } from "@/ui-kit/modules/contracts";
import { addressDedupModule } from "@/modules/address-dedup/manifest";
import routeDeclarations from "@/modules/address-dedup/module.routes.json";

/** Slots a host actually renders today. Contributing anywhere else renders nowhere, silently. */
const MOUNTED_SLOTS: ReadonlyArray<UiSlot> = [UiSlot.HOME_TOOL_GRID, UiSlot.FILE_SOURCE_TABS];

describe("address dedup manifest", () => {
  it("should take its id from the declaration file the generator reads", () => {
    expect(addressDedupModule.id).toBe("address-dedup");
    expect(addressDedupModule.id).toBe(routeDeclarations.moduleId);
  });

  it("should bind a handler to every declared endpoint", () => {
    // Arrange
    const declaredCount = routeDeclarations.endpoints.length;

    // Act
    const endpoints = addressDedupModule.endpoints ?? [];

    // Assert
    expect(endpoints).toHaveLength(declaredCount);
    expect(endpoints.every((endpoint) => typeof endpoint.handler === "function")).toBe(true);
  });

  it("should serve every endpoint dynamically on the node runtime", () => {
    // Arrange & Act
    const endpoints = addressDedupModule.endpoints ?? [];

    // Assert: pg needs node, and a cached analysis would show stale data for ever.
    expect(endpoints.every((endpoint) => endpoint.runtime === "nodejs")).toBe(true);
    expect(endpoints.every((endpoint) => endpoint.dynamic === "force-dynamic")).toBe(true);
  });

  it("should expose analyze and export as POST only, so credentials never travel in a URL", () => {
    // Arrange
    const registry = createModuleRegistry([addressDedupModule]);

    // Act & Assert
    expect(registry.findEndpoint(ModuleHttpMethod.POST, "address-dedup/analyze")?.moduleId).toBe("address-dedup");
    expect(registry.findEndpoint(ModuleHttpMethod.POST, "address-dedup/export")?.moduleId).toBe("address-dedup");
    expect(registry.findEndpoint(ModuleHttpMethod.GET, "address-dedup/analyze")).toBeNull();
    expect(registry.findEndpoint(ModuleHttpMethod.GET, "address-dedup/export")).toBeNull();
  });

  it("should expose provinces as POST only, so credentials never travel in a URL", () => {
    // Arrange
    const registry = createModuleRegistry([addressDedupModule]);

    // Act & Assert
    expect(registry.findEndpoint(ModuleHttpMethod.POST, "address-dedup/provinces")?.moduleId).toBe("address-dedup");
    expect(registry.findEndpoint(ModuleHttpMethod.GET, "address-dedup/provinces")).toBeNull();
  });

  it("should expose the removal endpoints as POST only, so credentials and the fingerprint never travel in a URL", () => {
    // Arrange
    const registry = createModuleRegistry([addressDedupModule]);

    // Act & Assert
    expect(registry.findEndpoint(ModuleHttpMethod.POST, "address-dedup/removal/simulate")?.moduleId).toBe("address-dedup");
    expect(registry.findEndpoint(ModuleHttpMethod.POST, "address-dedup/removal/execute")?.moduleId).toBe("address-dedup");
    expect(registry.findEndpoint(ModuleHttpMethod.GET, "address-dedup/removal/simulate")).toBeNull();
    expect(registry.findEndpoint(ModuleHttpMethod.GET, "address-dedup/removal/execute")).toBeNull();
  });

  it("should own the page at the module root", () => {
    // Arrange
    const registry = createModuleRegistry([addressDedupModule]);

    // Act
    const page = registry.findPage("address-dedup");

    // Assert
    expect(page?.moduleId).toBe("address-dedup");
    expect(typeof page?.page.Component).toBe("function");
    expect(routeDeclarations.pages.map((declaredPage) => declaredPage.path)).toEqual([""]);
  });

  it("should contribute one card, only into a slot a host actually mounts", () => {
    // Arrange & Act
    const contributions = addressDedupModule.ui ?? [];

    // Assert
    expect(contributions).toHaveLength(1);
    expect(contributions[0].slot).toBe(UiSlot.HOME_TOOL_GRID);
    expect(MOUNTED_SLOTS).toContain(contributions[0].slot);
  });

  it("should register cleanly beside the other modules", () => {
    // Arrange & Act
    const registry = createModuleRegistry([addressDedupModule]);

    // Assert
    expect(registry.modules).toHaveLength(1);
    expect(registry.endpoints()).toHaveLength(routeDeclarations.endpoints.length);
    expect(registry.pages()).toHaveLength(1);
  });

  it("should leave an application that does not register it completely unaffected", () => {
    // Arrange
    const registry = createModuleRegistry();

    // Assert
    expect(registry.findEndpoint(ModuleHttpMethod.POST, "address-dedup/analyze")).toBeNull();
    expect(registry.findPage("address-dedup")).toBeNull();
    expect(registry.uiContributions()).toHaveLength(0);
  });
});
