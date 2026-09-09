import { describe, it, expect } from "vitest";
import { createModuleRegistry } from "@/core/modules/createModuleRegistry";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import { UiSlot } from "@/ui-kit/modules/contracts";
import { statusModule } from "@/modules/status/manifest";
import { readServerStatus } from "@/modules/status/api/statusHandler";
import { ServerEnvironment } from "@/modules/status/types";
import type { ServerStatusResponse } from "@/modules/status/types";

const OK_STATUS = 200;

function buildStatusRequest(): Request {
  return new Request("http://localhost/api/m/status");
}

describe("status module handler", () => {
  it("should answer with a successful status envelope", async () => {
    // Arrange & Act
    const response = await readServerStatus(buildStatusRequest());
    const payload: ServerStatusResponse = await response.json();

    // Assert
    expect(response.status).toBe(OK_STATUS);
    expect(payload.success).toBe(true);
  });

  it("should report the running process, not a placeholder", async () => {
    // Arrange & Act
    const response = await readServerStatus(buildStatusRequest());
    const { status } = (await response.json()) as ServerStatusResponse;

    // Assert: the values must come from the process actually serving the request.
    expect(status.nodeVersion).toBe(process.version);
    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(status.uptimeLabel.length).toBeGreaterThan(0);
    expect(Object.values(ServerEnvironment)).toContain(status.environment);
    expect(new Date(status.startedAtIso).getTime()).not.toBeNaN();
  });
});

describe("status module manifest", () => {
  it("should take its id from the declaration file the generator reads", () => {
    // Assert: folder, served prefix and registered id cannot disagree.
    expect(statusModule.id).toBe("status");
  });

  it("should bind its single declared endpoint to the status handler", () => {
    // Arrange & Act
    const [endpoint, ...otherEndpoints] = statusModule.endpoints ?? [];

    // Assert
    expect(otherEndpoints).toHaveLength(0);
    expect(endpoint.method).toBe(ModuleHttpMethod.GET);
    expect(endpoint.path).toBe("");
    expect(endpoint.handler).toBe(readServerStatus);
  });

  it("should carry the per-route configuration the generated route must honour", () => {
    // Arrange & Act
    const [endpoint] = statusModule.endpoints ?? [];

    // Assert: a cached status endpoint would report a frozen uptime for ever.
    expect(endpoint.runtime).toBe("nodejs");
    expect(endpoint.dynamic).toBe("force-dynamic");
  });

  it("should contribute to a slot that a host actually mounts", () => {
    // Arrange & Act
    const [contribution, ...otherContributions] = statusModule.ui ?? [];

    // Assert: HOME_TOOL_GRID is the only slot rendered today; anything else renders nowhere.
    expect(otherContributions).toHaveLength(0);
    expect(contribution.slot).toBe(UiSlot.HOME_TOOL_GRID);
    expect(contribution.id).toBe("status.card");
  });

  it("should declare one navigation entry", () => {
    // Arrange & Act
    const navigationEntries = statusModule.navigation ?? [];

    // Assert
    expect(navigationEntries).toHaveLength(1);
    expect(navigationEntries[0].href).toBe("/api/m/status");
  });

  it("should register cleanly and resolve at the route path the generator emits", () => {
    // Arrange
    const registry = createModuleRegistry([statusModule]);

    // Act
    const registered = registry.findEndpoint(ModuleHttpMethod.GET, "status");

    // Assert
    expect(registered?.moduleId).toBe("status");
    expect(registered?.endpoint.handler).toBe(readServerStatus);
    expect(registry.uiContributions()).toHaveLength(1);
    expect(registry.navigation()).toHaveLength(1);
  });

  it("should leave an application that does not register it completely unaffected", () => {
    // Arrange: the deletion property, asserted rather than assumed.
    const registry = createModuleRegistry();

    // Assert
    expect(registry.modules).toHaveLength(0);
    expect(registry.endpoints()).toHaveLength(0);
    expect(registry.uiContributions()).toHaveLength(0);
    expect(registry.findEndpoint(ModuleHttpMethod.GET, "status")).toBeNull();
  });
});
