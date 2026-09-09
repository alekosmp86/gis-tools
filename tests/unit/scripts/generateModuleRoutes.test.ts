import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import {
  ModuleHttpMethod,
  ModuleRouteDynamic,
  ModuleRuntime,
} from "@/core/modules/contracts";
import {
  moduleEndpointKey,
  normalizeModuleEndpointPath,
  resolveModuleRoutePath,
} from "@/core/modules/moduleRoutePaths";

/**
 * The generator is a plain Node script: it cannot import the TypeScript contracts, so it mirrors
 * them. These tests exercise the generator's own rules and then hold the two copies to the same
 * answers, which is what keeps the mirror from drifting into a second source of truth.
 */
const requireCjs = createRequire(import.meta.url);
const generator = requireCjs("../../../scripts/generate-module-routes.cjs");

/** Endpoint half of a parsed declaration file, which is what most of these tests assert on. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEndpoints(fileContents: string, moduleDirName: string): any[] {
  return generator.parseDeclarationFile(fileContents, moduleDirName).endpoints;
}

function buildDeclarationJson(endpoints: unknown, moduleId = "reports"): string {
  return JSON.stringify({ moduleId, endpoints });
}

describe("generate-module-routes: declaration parsing", () => {
  it("should resolve a declared endpoint into the route it will be served at", () => {
    // Arrange
    const declarationJson = buildDeclarationJson([{ path: "records/stream", method: "GET" }]);

    // Act
    const [endpoint] = parseEndpoints(declarationJson, "reports");

    // Assert
    expect(endpoint.routePath).toBe("reports/records/stream");
    expect(endpoint.moduleId).toBe("reports");
  });

  it("should serve the module root when the declared path is empty", () => {
    // Arrange
    const declarationJson = buildDeclarationJson([{ path: "", method: "GET" }]);

    // Act
    const [endpoint] = parseEndpoints(declarationJson, "reports");

    // Assert
    expect(endpoint.routePath).toBe("reports");
  });

  it("should accept Next dynamic segments in a declared path", () => {
    // Arrange
    const declarationJson = buildDeclarationJson([{ path: "records/[id]", method: "GET" }]);

    // Act
    const [endpoint] = parseEndpoints(declarationJson, "reports");

    // Assert
    expect(endpoint.routePath).toBe("reports/records/[id]");
  });

  it("should reject a declaration whose moduleId does not match its folder", () => {
    // Arrange: a copy-pasted file would otherwise publish under another module's prefix.
    const declarationJson = buildDeclarationJson([], "otros");

    // Act & Assert
    expect(() => generator.parseDeclarationFile(declarationJson, "reports")).toThrow(
      /declares moduleId "otros" but lives in folder "reports"/
    );
  });

  it("should reject a moduleId that cannot be a URL segment", () => {
    expect(() => generator.parseDeclarationFile(buildDeclarationJson([], "Reports"), "Reports")).toThrow(
      /must be lowercase/
    );
  });

  it("should read a declaration file saved with a byte order mark", () => {
    // Arrange: Windows editors add one, and the TypeScript import tolerates it, so this must too.
    const declarationJson = `\uFEFF${buildDeclarationJson([{ path: "records", method: "GET" }])}`;

    // Act
    const [endpoint] = parseEndpoints(declarationJson, "reports");

    // Assert
    expect(endpoint.routePath).toBe("reports/records");
  });

  it("should reject invalid JSON with the offending file named", () => {
    expect(() => generator.parseDeclarationFile("{ not json", "reports")).toThrow(
      /src\/modules\/reports\/module\.routes\.json: invalid JSON/
    );
  });

  it("should reject a file without an endpoints array", () => {
    expect(() => generator.parseDeclarationFile(JSON.stringify({ moduleId: "reports" }), "reports")).toThrow(
      /"endpoints" must be an array/
    );
  });

  it("should reject an unsupported method, runtime or dynamic mode", () => {
    expect(() =>
      generator.parseDeclarationFile(buildDeclarationJson([{ path: "a", method: "OPTIONS" }]), "reports")
    ).toThrow(/unsupported method "OPTIONS"/);

    expect(() =>
      generator.parseDeclarationFile(
        buildDeclarationJson([{ path: "a", method: "GET", runtime: "deno" }]),
        "reports"
      )
    ).toThrow(/unsupported runtime "deno"/);

    expect(() =>
      generator.parseDeclarationFile(
        buildDeclarationJson([{ path: "a", method: "GET", dynamic: "always" }]),
        "reports"
      )
    ).toThrow(/unsupported dynamic mode "always"/);
  });

  it("should reject a path segment that cannot become a folder name", () => {
    expect(() =>
      generator.parseDeclarationFile(buildDeclarationJson([{ path: "Records List", method: "GET" }]), "reports")
    ).toThrow(/is not a usable route segment/);
  });

  it("should reject the same method and path declared twice", () => {
    // Arrange
    const declarationJson = buildDeclarationJson([
      { path: "records", method: "GET" },
      { path: "/records/", method: "GET" },
    ]);

    // Act & Assert
    expect(() => generator.parseDeclarationFile(declarationJson, "reports")).toThrow(
      /declares "GET records" twice/
    );
  });
});

describe("generate-module-routes: route planning", () => {
  it("should emit one route file per path, carrying every method declared on it", () => {
    // Arrange
    const endpoints = parseEndpoints(
      buildDeclarationJson([
        { path: "records", method: "POST" },
        { path: "records", method: "GET" },
      ]),
      "reports"
    );

    // Act
    const [group, ...otherGroups] = generator.groupEndpointsByRoute(endpoints);

    // Assert: one file, methods in canonical order regardless of declaration order.
    expect(otherGroups).toHaveLength(0);
    expect(group.methods).toEqual(["GET", "POST"]);
  });

  it("should reject two methods on one path asking for different runtimes", () => {
    // Arrange: Next configures runtime per file, so the two cannot both be honoured.
    const endpoints = parseEndpoints(
      buildDeclarationJson([
        { path: "records", method: "GET", runtime: "edge" },
        { path: "records", method: "POST", runtime: "nodejs" },
      ]),
      "reports"
    );

    // Act & Assert
    expect(() => generator.groupEndpointsByRoute(endpoints)).toThrow(/Conflicting configuration/);
  });

  it("should place a generated route under src/app/api/m mirroring its route path", () => {
    // Arrange
    const endpoints = parseEndpoints(
      buildDeclarationJson([{ path: "records/stream", method: "GET" }]),
      "reports"
    );

    // Act
    const [file] = generator.planGeneratedFiles({ endpoints, pages: [] });

    // Assert
    expect(file.relativePath).toBe("src/app/api/m/reports/records/stream/route.ts");
  });

  it("should plan nothing when no module declares an endpoint", () => {
    expect(generator.planGeneratedFiles({ endpoints: [], pages: [] })).toEqual([]);
  });

  it("should emit a do-not-edit banner, a handler per method and no module import", () => {
    // Arrange
    const endpoints = parseEndpoints(
      buildDeclarationJson([
        { path: "records", method: "GET" },
        { path: "records", method: "DELETE" },
      ]),
      "reports"
    );

    // Act
    const [file] = generator.planGeneratedFiles({ endpoints, pages: [] });

    // Assert
    expect(file.contents).toContain("GENERATED FILE — DO NOT EDIT");
    expect(file.contents).toContain('const ROUTE_PATH = "reports/records";');
    expect(file.contents).toContain("export const GET = createModuleRouteHandler(");
    expect(file.contents).toContain("export const DELETE = createModuleRouteHandler(");
    // The invariant: only the composition root may name a module.
    expect(file.contents).not.toContain("@/modules/");
  });

  it("should emit runtime and dynamic exports only when they are declared", () => {
    // Arrange
    const configuredEndpoints = parseEndpoints(
      buildDeclarationJson([
        { path: "records", method: "GET", runtime: "edge", dynamic: "force-dynamic" },
      ]),
      "reports"
    );
    const plainEndpoints = parseEndpoints(
      buildDeclarationJson([{ path: "records", method: "GET" }]),
      "reports"
    );

    // Act
    const [configuredFile] = generator.planGeneratedFiles({ endpoints: configuredEndpoints, pages: [] });
    const [plainFile] = generator.planGeneratedFiles({ endpoints: plainEndpoints, pages: [] });

    // Assert
    expect(configuredFile.contents).toContain('export const runtime = "edge";');
    expect(configuredFile.contents).toContain('export const dynamic = "force-dynamic";');
    expect(plainFile.contents).not.toContain("export const runtime");
    expect(plainFile.contents).not.toContain("export const dynamic");
  });
});

describe("generate-module-routes: agreement with the core contracts", () => {
  it("should mirror the methods, runtimes and dynamic modes core defines", () => {
    expect(generator.HTTP_METHODS).toEqual(Object.values(ModuleHttpMethod));
    expect(generator.RUNTIMES).toEqual(Object.values(ModuleRuntime));
    expect(generator.DYNAMIC_MODES).toEqual(Object.values(ModuleRouteDynamic));
  });

  it("should resolve paths and keys exactly as core does", () => {
    // Arrange
    const declaredPaths = ["", "/", "records", "/records/", "records/stream", "records/[id]"];

    // Act & Assert
    for (const declaredPath of declaredPaths) {
      expect(generator.normalizeEndpointPath(declaredPath)).toBe(
        normalizeModuleEndpointPath(declaredPath)
      );
      expect(generator.resolveRoutePath("reports", declaredPath)).toBe(
        resolveModuleRoutePath("reports", declaredPath)
      );
      expect(generator.endpointKey(ModuleHttpMethod.GET, declaredPath)).toBe(
        moduleEndpointKey(ModuleHttpMethod.GET, declaredPath)
      );
    }
  });
});

describe("generate-module-routes: staleness check", () => {
  it("should report the committed tree as up to date", () => {
    // Arrange & Act: --check must pass on a clean checkout, which is what makes it a usable gate.
    const exitCode = generator.main(["--check"]);

    // Assert
    expect(exitCode).toBe(0);
  });
});

describe("generate-module-routes: page declarations", () => {
  function buildPageDeclarationJson(pages: unknown, moduleId = "reports"): string {
    return JSON.stringify({ moduleId, endpoints: [], pages });
  }

  it("should resolve a declared page into the route it will be served at", () => {
    // Arrange
    const declarationJson = buildPageDeclarationJson([{ path: "", title: "Reportes" }]);

    // Act
    const { pages } = generator.parseDeclarationFile(declarationJson, "reports");

    // Assert
    expect(pages[0].routePath).toBe("reports");
    expect(pages[0].title).toBe("Reportes");
  });

  it("should treat pages as optional", () => {
    // Arrange: most modules contribute endpoints only.
    const declarationJson = JSON.stringify({ moduleId: "reports", endpoints: [] });

    // Act & Assert
    expect(generator.parseDeclarationFile(declarationJson, "reports").pages).toEqual([]);
  });

  it("should reject a page without a usable title", () => {
    // Arrange: the title becomes the document title, so an empty one is a defect.
    expect(() =>
      generator.parseDeclarationFile(buildPageDeclarationJson([{ path: "", title: "  " }]), "reports")
    ).toThrow(/needs a non-empty "title"/);

    expect(() =>
      generator.parseDeclarationFile(buildPageDeclarationJson([{ path: "" }]), "reports")
    ).toThrow(/needs a non-empty "title"/);
  });

  it("should reject the same page path declared twice", () => {
    // Arrange
    const declarationJson = buildPageDeclarationJson([
      { path: "detalle", title: "Detalle" },
      { path: "/detalle/", title: "Duplicado" },
    ]);

    // Act & Assert
    expect(() => generator.parseDeclarationFile(declarationJson, "reports")).toThrow(
      /declares page "detalle" twice/
    );
  });

  it("should place a generated page under src/app/tools/m mirroring its route path", () => {
    // Arrange
    const { pages } = generator.parseDeclarationFile(
      buildPageDeclarationJson([{ path: "detalle", title: "Detalle" }]),
      "reports"
    );

    // Act
    const [file] = generator.planGeneratedFiles({ endpoints: [], pages });

    // Assert
    expect(file.relativePath).toBe("src/app/tools/m/reports/detalle/page.tsx");
  });

  it("should emit a page that resolves through the registry and never imports a module", () => {
    // Arrange
    const { pages } = generator.parseDeclarationFile(
      buildPageDeclarationJson([{ path: "", title: "Reportes" }]),
      "reports"
    );

    // Act
    const [file] = generator.planGeneratedFiles({ endpoints: [], pages });

    // Assert
    expect(file.contents).toContain("GENERATED FILE — DO NOT EDIT");
    expect(file.contents).toContain('const PAGE_ROUTE_PATH = "reports";');
    expect(file.contents).toContain("moduleRegistry.findPage(PAGE_ROUTE_PATH)");
    expect(file.contents).toContain("ModuleErrorBoundary");
    expect(file.contents).toContain("notFound()");
    expect(file.contents).toContain('title: "Reportes"');
    // The invariant: only the composition root may name a module.
    expect(file.contents).not.toContain("@/modules/");
  });

  it("should plan endpoint and page files together for one module", () => {
    // Arrange
    const declarationJson = JSON.stringify({
      moduleId: "reports",
      endpoints: [{ path: "datos", method: "GET" }],
      pages: [{ path: "", title: "Reportes" }],
    });

    // Act
    const planned = generator.planGeneratedFiles(
      generator.parseDeclarationFile(declarationJson, "reports")
    );

    // Assert
    expect(planned.map((file: { relativePath: string }) => file.relativePath)).toEqual([
      "src/app/api/m/reports/datos/route.ts",
      "src/app/tools/m/reports/page.tsx",
    ]);
  });
});
