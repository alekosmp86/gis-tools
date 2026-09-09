import { describe, it, expect } from "vitest";
import { createModuleRegistry } from "@/core/modules/createModuleRegistry";
import { createModuleRouteHandler } from "@/core/modules/createModuleRouteHandler";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import type { ModuleManifest } from "@/core/modules/contracts";

const UNSERVED_ROUTE_STATUS = 404;

function buildRequest(): Request {
  return new Request("http://localhost/api/m/reports/records");
}

function buildManifest(handler: (request: Request) => Response): ModuleManifest {
  return {
    id: "reports",
    name: "Reportes",
    endpoints: [{ path: "records", method: ModuleHttpMethod.GET, handler }],
  };
}

describe("createModuleRouteHandler", () => {
  it("should delegate to the handler the registry resolves for the route", async () => {
    // Arrange
    const registry = createModuleRegistry([
      buildManifest(() => new Response("registros", { status: 200 })),
    ]);
    const route = createModuleRouteHandler(registry, ModuleHttpMethod.GET, "reports/records");

    // Act
    const response = await route(buildRequest());

    // Assert
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("registros");
  });

  it("should pass the incoming request through untouched", async () => {
    // Arrange
    let receivedRequest: Request | null = null;
    const registry = createModuleRegistry([
      buildManifest((request) => {
        receivedRequest = request;
        return new Response("ok");
      }),
    ]);
    const route = createModuleRouteHandler(registry, ModuleHttpMethod.GET, "reports/records");
    const request = buildRequest();

    // Act
    await route(request);

    // Assert
    expect(receivedRequest).toBe(request);
  });

  it("should answer 404 when no module serves the route", async () => {
    // Arrange: this is a generated route file left behind by a deleted module.
    const registry = createModuleRegistry();
    const route = createModuleRouteHandler(registry, ModuleHttpMethod.GET, "reports/records");

    // Act
    const response = await route(buildRequest());

    // Assert
    expect(response.status).toBe(UNSERVED_ROUTE_STATUS);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it("should answer 404 when the route is served under a different method", async () => {
    // Arrange
    const registry = createModuleRegistry([buildManifest(() => new Response("ok"))]);
    const route = createModuleRouteHandler(registry, ModuleHttpMethod.POST, "reports/records");

    // Act
    const response = await route(buildRequest());

    // Assert
    expect(response.status).toBe(UNSERVED_ROUTE_STATUS);
  });

  it("should resolve per request, so a registry query happens at call time and not at import time", () => {
    // Arrange: a route file must never throw while the module graph is being loaded.
    const registry = createModuleRegistry();

    // Act & Assert
    expect(() =>
      createModuleRouteHandler(registry, ModuleHttpMethod.GET, "reports/records")
    ).not.toThrow();
  });
});
