import { describe, it, expect } from "vitest";
import { createModuleRegistry } from "@/core/modules/createModuleRegistry";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import type { ModuleManifest } from "@/core/modules/contracts";

function buildManifest(overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id: "reports",
    name: "Reportes",
    ...overrides,
  } as ModuleManifest;
}

const okResponse = () => new Response("ok");

describe("createModuleRegistry", () => {
  it("should return an empty registry when no modules are registered", () => {
    // Arrange & Act: an application with zero modules must be fully valid.
    const registry = createModuleRegistry();

    // Assert
    expect(registry.modules).toHaveLength(0);
    expect(registry.endpoints()).toHaveLength(0);
    expect(registry.navigation()).toHaveLength(0);
    expect(registry.uiContributions()).toHaveLength(0);
    expect(registry.findById("anything")).toBeNull();
  });

  it("should default to an empty registry when called with no argument", () => {
    expect(() => createModuleRegistry()).not.toThrow();
  });

  it("should find a registered module by id and return null for an unknown one", () => {
    // Arrange
    const registry = createModuleRegistry([buildManifest()]);

    // Act & Assert
    expect(registry.findById("reports")?.name).toBe("Reportes");
    expect(registry.findById("missing")).toBeNull();
  });

  it("should prefix endpoint paths with the module id", () => {
    // Arrange
    const registry = createModuleRegistry([
      buildManifest({
        endpoints: [
          { path: "records/stream", method: ModuleHttpMethod.POST, handler: okResponse },
        ],
      }),
    ]);

    // Act
    const [registered] = registry.endpoints();

    // Assert
    expect(registered.routePath).toBe("reports/records/stream");
    expect(registered.moduleId).toBe("reports");
  });

  it("should tolerate leading and trailing slashes in a declared path", () => {
    // Arrange
    const registry = createModuleRegistry([
      buildManifest({
        endpoints: [{ path: "/records/", method: ModuleHttpMethod.GET, handler: okResponse }],
      }),
    ]);

    // Assert
    expect(registry.endpoints()[0].routePath).toBe("reports/records");
  });

  it("should serve a module root when the declared path is empty", () => {
    // Arrange
    const registry = createModuleRegistry([
      buildManifest({
        endpoints: [{ path: "", method: ModuleHttpMethod.GET, handler: okResponse }],
      }),
    ]);

    // Assert
    expect(registry.endpoints()[0].routePath).toBe("reports");
  });

  it("should reject two modules claiming the same id", () => {
    // Arrange: ambiguous lookups would silently shadow one module's endpoints.
    const manifests = [buildManifest(), buildManifest({ name: "Otro" })];

    // Act & Assert
    expect(() => createModuleRegistry(manifests)).toThrow(/Duplicate module id "reports"/);
  });

  it("should reject two endpoints resolving to the same method and path", () => {
    // Arrange
    const manifests = [
      buildManifest({
        endpoints: [
          { path: "records", method: ModuleHttpMethod.GET, handler: okResponse },
          { path: "/records", method: ModuleHttpMethod.GET, handler: okResponse },
        ],
      }),
    ];

    // Act & Assert
    expect(() => createModuleRegistry(manifests)).toThrow(/Duplicate module route/);
  });

  it("should allow the same path under different methods", () => {
    // Arrange
    const registry = createModuleRegistry([
      buildManifest({
        endpoints: [
          { path: "records", method: ModuleHttpMethod.GET, handler: okResponse },
          { path: "records", method: ModuleHttpMethod.POST, handler: okResponse },
        ],
      }),
    ]);

    // Assert
    expect(registry.endpoints()).toHaveLength(2);
  });

  it("should reject a module id that cannot be a URL segment", () => {
    // Arrange & Act & Assert
    expect(() => createModuleRegistry([buildManifest({ id: "Reports" })])).toThrow(
      /Invalid module id/
    );
    expect(() => createModuleRegistry([buildManifest({ id: "my module" })])).toThrow(
      /Invalid module id/
    );
    expect(() => createModuleRegistry([buildManifest({ id: "2fast" })])).toThrow(
      /Invalid module id/
    );
  });

  it("should accept lowercase hyphenated ids", () => {
    expect(() => createModuleRegistry([buildManifest({ id: "db-reports" })])).not.toThrow();
  });

  it("should order navigation entries by their declared order", () => {
    // Arrange
    const registry = createModuleRegistry([
      buildManifest({
        id: "alpha",
        navigation: [{ label: "Tercero", href: "/c", order: 30 }],
      }),
      buildManifest({
        id: "beta",
        navigation: [
          { label: "Primero", href: "/a", order: 10 },
          { label: "Segundo", href: "/b", order: 20 },
        ],
      }),
    ]);

    // Act
    const labels = registry.navigation().map((entry) => entry.label);

    // Assert
    expect(labels).toEqual(["Primero", "Segundo", "Tercero"]);
  });

  it("should place navigation entries without an order last", () => {
    // Arrange
    const registry = createModuleRegistry([
      buildManifest({
        navigation: [
          { label: "Sin orden", href: "/z" },
          { label: "Con orden", href: "/a", order: 5 },
        ],
      }),
    ]);

    // Assert
    expect(registry.navigation().map((entry) => entry.label)).toEqual(["Con orden", "Sin orden"]);
  });

  it("should aggregate endpoints across several modules", () => {
    // Arrange
    const registry = createModuleRegistry([
      buildManifest({
        id: "alpha",
        endpoints: [{ path: "ping", method: ModuleHttpMethod.GET, handler: okResponse }],
      }),
      buildManifest({
        id: "beta",
        endpoints: [{ path: "ping", method: ModuleHttpMethod.GET, handler: okResponse }],
      }),
    ]);

    // Assert: same declared path, different modules, so no collision.
    expect(registry.endpoints().map((registered) => registered.routePath)).toEqual([
      "alpha/ping",
      "beta/ping",
    ]);
  });
});
