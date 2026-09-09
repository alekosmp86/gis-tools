import { describe, it, expect } from "vitest";
import { defineModuleEndpoints } from "@/core/modules/defineModuleEndpoints";
import { ModuleHttpMethod, ModuleRouteDynamic, ModuleRuntime } from "@/core/modules/contracts";
import type { ModuleRouteDeclarationFile } from "@/core/modules/contracts";

const okHandler = () => new Response("ok");

function buildDeclarationFile(
  endpoints: ModuleRouteDeclarationFile["endpoints"]
): ModuleRouteDeclarationFile {
  return { moduleId: "reports", endpoints };
}

describe("defineModuleEndpoints", () => {
  it("should bind a declared endpoint to the handler registered under its key", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([
      { path: "records/stream", method: ModuleHttpMethod.GET },
    ]);

    // Act
    const endpoints = defineModuleEndpoints(declarationFile, {
      "GET records/stream": okHandler,
    });

    // Assert
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].method).toBe(ModuleHttpMethod.GET);
    expect(endpoints[0].path).toBe("records/stream");
    expect(endpoints[0].handler).toBe(okHandler);
  });

  it("should key a module-root endpoint by its method alone", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([{ path: "", method: ModuleHttpMethod.POST }]);

    // Act
    const endpoints = defineModuleEndpoints(declarationFile, { POST: okHandler });

    // Assert
    expect(endpoints[0].path).toBe("");
    expect(endpoints[0].handler).toBe(okHandler);
  });

  it("should tolerate leading and trailing slashes in a declared path", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([{ path: "/records/", method: ModuleHttpMethod.GET }]);

    // Act
    const endpoints = defineModuleEndpoints(declarationFile, { "GET records": okHandler });

    // Assert
    expect(endpoints[0].path).toBe("records");
  });

  it("should carry runtime and dynamic declarations through to the endpoint", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([
      {
        path: "records",
        method: ModuleHttpMethod.GET,
        runtime: ModuleRuntime.EDGE,
        dynamic: ModuleRouteDynamic.FORCE_DYNAMIC,
      },
    ]);

    // Act
    const [endpoint] = defineModuleEndpoints(declarationFile, { "GET records": okHandler });

    // Assert
    expect(endpoint.runtime).toBe(ModuleRuntime.EDGE);
    expect(endpoint.dynamic).toBe(ModuleRouteDynamic.FORCE_DYNAMIC);
  });

  it("should leave runtime and dynamic undefined when the declaration omits them", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([{ path: "records", method: ModuleHttpMethod.GET }]);

    // Act
    const [endpoint] = defineModuleEndpoints(declarationFile, { "GET records": okHandler });

    // Assert: the host default must stay the host default, not a value we invented.
    expect(endpoint.runtime).toBeUndefined();
    expect(endpoint.dynamic).toBeUndefined();
  });

  it("should accept a module that declares no endpoints", () => {
    expect(defineModuleEndpoints(buildDeclarationFile([]), {})).toEqual([]);
  });

  it("should reject a declared endpoint with no handler", () => {
    // Arrange: the generator would emit a route that answers 404 for ever.
    const declarationFile = buildDeclarationFile([
      { path: "records", method: ModuleHttpMethod.GET },
    ]);

    // Act & Assert
    expect(() => defineModuleEndpoints(declarationFile, {})).toThrow(
      /declares "GET records" .* supplies no handler/
    );
  });

  it("should reject a handler for an endpoint that was never declared", () => {
    // Arrange: nothing would ever route to it, so it is dead code.
    const declarationFile = buildDeclarationFile([
      { path: "records", method: ModuleHttpMethod.GET },
    ]);

    // Act & Assert
    expect(() =>
      defineModuleEndpoints(declarationFile, {
        "GET records": okHandler,
        "POST records": okHandler,
      })
    ).toThrow(/supplies handlers for "POST records"/);
  });

  it("should reject an unsupported HTTP method", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([{ path: "records", method: "OPTIONS" }]);

    // Act & Assert
    expect(() => defineModuleEndpoints(declarationFile, { "OPTIONS records": okHandler })).toThrow(
      /unsupported method "OPTIONS"/
    );
  });

  it("should reject an unsupported runtime", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([
      { path: "records", method: ModuleHttpMethod.GET, runtime: "deno" },
    ]);

    // Act & Assert
    expect(() => defineModuleEndpoints(declarationFile, { "GET records": okHandler })).toThrow(
      /unsupported runtime "deno"/
    );
  });

  it("should reject an unsupported dynamic mode", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([
      { path: "records", method: ModuleHttpMethod.GET, dynamic: "always" },
    ]);

    // Act & Assert
    expect(() => defineModuleEndpoints(declarationFile, { "GET records": okHandler })).toThrow(
      /unsupported dynamic mode "always"/
    );
  });

  it("should reject the same method and path declared twice", () => {
    // Arrange: one of the two handlers would be bound arbitrarily.
    const declarationFile = buildDeclarationFile([
      { path: "records", method: ModuleHttpMethod.GET },
      { path: "/records/", method: ModuleHttpMethod.GET },
    ]);

    // Act & Assert
    expect(() => defineModuleEndpoints(declarationFile, { "GET records": okHandler })).toThrow(
      /declares "GET records" twice/
    );
  });

  it("should allow the same path under different methods", () => {
    // Arrange
    const declarationFile = buildDeclarationFile([
      { path: "records", method: ModuleHttpMethod.GET },
      { path: "records", method: ModuleHttpMethod.POST },
    ]);

    // Act
    const endpoints = defineModuleEndpoints(declarationFile, {
      "GET records": okHandler,
      "POST records": okHandler,
    });

    // Assert
    expect(endpoints).toHaveLength(2);
  });
});
