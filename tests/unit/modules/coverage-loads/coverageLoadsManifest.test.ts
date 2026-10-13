import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import { createModuleRegistry } from "@/core/modules/createModuleRegistry";
import { UiSlot } from "@/ui-kit/modules/contracts";
import { csvBytes, validDataLines } from "./csvBuilders";

/**
 * Only the database boundary is replaced: the handlers, the manifest wiring and the route
 * declarations are the real ones, so an endpoint bound to the wrong handler shows in behaviour.
 */
const repositoryCalls = vi.hoisted(() => ({
  inspected: 0,
  loaded: 0,
  reports: [] as string[],
}));

vi.mock("@/modules/coverage-loads/indicators/services/PgIndicatorsRepository", () => ({
  PgIndicatorsRepository: class {
    async inspectHistory() {
      repositoryCalls.inspected += 1;
      return { existingRowsByDate: {}, shortfalls: [] };
    }

    async loadCuts() {
      repositoryCalls.loaded += 1;
      return { cuts: [], totalInserted: 0, totalReplaced: 0, hasIncompleteCut: false, rejectedRows: [] };
    }

    async readReport(_connection: unknown, kind: string) {
      repositoryCalls.reports.push(kind);
      return [];
    }
  },
}));

const { coverageLoadsModule } = await import("@/modules/coverage-loads/manifest");
const { COVERAGE_SECTIONS, CoverageSectionId } = await import("@/modules/coverage-loads/ui/coverageSections");
const { moduleRegistry } = await import("@/app/modules.registry");
const routeDeclarations = (await import("@/modules/coverage-loads/module.routes.json")).default;

/** Slots a host actually renders today. Contributing anywhere else renders nowhere, silently. */
const MOUNTED_SLOTS: ReadonlyArray<UiSlot> = [UiSlot.HOME_TOOL_GRID, UiSlot.FILE_SOURCE_TABS];

const API = "coverage-loads/indicators";
const CONNECTION = { host: "h", port: "5432", db_name: "d", user: "u", password: "p" };

function findHandler(path: string) {
  const registered = createModuleRegistry([coverageLoadsModule]).findEndpoint(ModuleHttpMethod.POST, path);
  if (!registered) throw new Error(`no endpoint ${path}`);
  return registered.endpoint.handler;
}

function uploadRequest(confirm: boolean): Request {
  const form = new FormData();
  form.append("connection", JSON.stringify(CONNECTION));
  form.append("files", new File([csvBytes(validDataLines(3)) as BlobPart], "IndicadoresLTE_20260901.csv"));
  if (confirm) form.append("confirm", "true");
  return new Request(`http://localhost/api/m/${API}`, { method: "POST", body: form });
}

beforeEach(() => {
  repositoryCalls.inspected = 0;
  repositoryCalls.loaded = 0;
  repositoryCalls.reports.length = 0;
});

describe("coverage loads manifest", () => {
  describe("identity and endpoints (AC-22, AC-27, AC-29)", () => {
    it("should take its id from the declaration file the generator reads", () => {
      // Arrange, Act & Assert
      expect(coverageLoadsModule.id).toBe("coverage-loads");
      expect(coverageLoadsModule.id).toBe(routeDeclarations.moduleId);
    });

    it("should declare exactly the three indicator endpoints, all POST", () => {
      // Arrange, Act & Assert
      expect(routeDeclarations.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual([
        "POST indicators/plan",
        "POST indicators/load",
        "POST indicators/reports",
      ]);
    });

    it("should bind a handler to every declared endpoint and keep nodejs / force-dynamic", () => {
      // Arrange & Act
      const endpoints = coverageLoadsModule.endpoints ?? [];

      // Assert
      expect(endpoints).toHaveLength(3);
      expect(endpoints.every((endpoint) => typeof endpoint.handler === "function")).toBe(true);
      expect(endpoints.every((endpoint) => endpoint.runtime === "nodejs")).toBe(true);
      expect(endpoints.every((endpoint) => endpoint.dynamic === "force-dynamic")).toBe(true);
      expect(endpoints.every((endpoint) => endpoint.method === ModuleHttpMethod.POST)).toBe(true);
    });

    it("should expose the endpoints as POST only, so credentials never travel in a URL", () => {
      // Arrange
      const registry = createModuleRegistry([coverageLoadsModule]);

      // Act & Assert
      for (const name of ["plan", "load", "reports"]) {
        expect(registry.findEndpoint(ModuleHttpMethod.POST, `${API}/${name}`)?.moduleId).toBe("coverage-loads");
        expect(registry.findEndpoint(ModuleHttpMethod.GET, `${API}/${name}`)).toBeNull();
      }
      expect(registry.findEndpoint(ModuleHttpMethod.POST, `${API}/shp`)).toBeNull();
    });

    it("should bind indicators/plan to the plan handler: it inspects the history and never writes", async () => {
      // Arrange
      const handler = findHandler(`${API}/plan`);

      // Act
      const response = await handler(uploadRequest(true));

      // Assert
      expect(response.status).toBe(200);
      expect((await response.json()).plan.cuts).toHaveLength(1);
      expect(repositoryCalls).toMatchObject({ inspected: 1, loaded: 0 });
    });

    it("should bind indicators/load to the load handler: a confirmed upload is written", async () => {
      // Arrange
      const handler = findHandler(`${API}/load`);

      // Act
      const unconfirmed = await handler(uploadRequest(false));
      const confirmed = await handler(uploadRequest(true));

      // Assert
      expect(unconfirmed.status).toBe(400);
      expect(confirmed.status).toBe(200);
      expect(repositoryCalls.loaded).toBe(1);
    });

    it("should bind indicators/reports to the reports handler: it reads the asked report", async () => {
      // Arrange
      const handler = findHandler(`${API}/reports`);
      const request = new Request(`http://localhost/api/m/${API}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection: CONNECTION, kind: "mayor50" }),
      });

      // Act
      const response = await handler(request);

      // Assert
      expect(response.headers.get("Content-Disposition")).toContain("mayor50");
      expect(repositoryCalls.reports).toEqual(["mayor50"]);
    });
  });

  describe("page and navigation (AC-27)", () => {
    it("should own the page at the module root, titled Cargas de Coberturas", () => {
      // Arrange
      const registry = createModuleRegistry([coverageLoadsModule]);

      // Act
      const page = registry.findPage("coverage-loads");

      // Assert
      expect(routeDeclarations.pages).toEqual([{ path: "", title: "Cargas de Coberturas" }]);
      expect(page?.moduleId).toBe("coverage-loads");
      expect(typeof page?.page.Component).toBe("function");
      expect(coverageLoadsModule.name).toBe("Cargas de Coberturas");
    });

    it("should link navigation to the module page", () => {
      // Arrange & Act
      const navigation = coverageLoadsModule.navigation ?? [];

      // Assert
      expect(navigation).toHaveLength(1);
      expect(navigation[0]).toMatchObject({ label: "Cargas de Coberturas", href: "/tools/m/coverage-loads" });
    });

    it("should contribute one HOME_TOOL_GRID card after the existing ones, into a mounted slot", () => {
      // Arrange & Act
      const contributions = coverageLoadsModule.ui ?? [];

      // Assert
      expect(contributions).toHaveLength(1);
      expect(contributions[0].slot).toBe(UiSlot.HOME_TOOL_GRID);
      expect(MOUNTED_SLOTS).toContain(contributions[0].slot);
      expect(contributions[0].order).toBeGreaterThan(110);
      expect(typeof contributions[0].Component).toBe("function");
    });

    it("should offer exactly one section, Indicadores LTE", () => {
      // Arrange & Act & Assert
      expect(COVERAGE_SECTIONS).toHaveLength(1);
      expect(COVERAGE_SECTIONS[0].label).toBe("Indicadores LTE");
      expect(COVERAGE_SECTIONS[0].id).toBe(CoverageSectionId.INDICATORS);
      expect(typeof COVERAGE_SECTIONS[0].Component).toBe("function");
    });
  });

  describe("registration", () => {
    it("should be part of the application's composition root", () => {
      // Arrange & Act & Assert
      expect(moduleRegistry.modules.map((module) => module.id)).toContain("coverage-loads");
      expect(moduleRegistry.findEndpoint(ModuleHttpMethod.POST, `${API}/plan`)?.moduleId).toBe("coverage-loads");
      expect(moduleRegistry.findPage("coverage-loads")?.moduleId).toBe("coverage-loads");
    });

    it("should register cleanly on its own", () => {
      // Arrange
      const registry = createModuleRegistry([coverageLoadsModule]);

      // Assert
      expect(registry.modules).toHaveLength(1);
      expect(registry.endpoints()).toHaveLength(3);
      expect(registry.pages()).toHaveLength(1);
      expect(registry.uiContributions()).toHaveLength(1);
    });

    it("should leave an application that does not register it completely unaffected", () => {
      // Arrange
      const registry = createModuleRegistry();

      // Assert
      expect(registry.findEndpoint(ModuleHttpMethod.POST, `${API}/plan`)).toBeNull();
      expect(registry.findPage("coverage-loads")).toBeNull();
    });
  });
});

describe("module structure (AC-29, AC-30)", () => {
  const MODULE_DIR = fileURLToPath(new URL("../../../../src/modules/coverage-loads", import.meta.url));
  const API_DIR = fileURLToPath(new URL("../../../../src/app/api/m/coverage-loads", import.meta.url));
  const PAGE_DIR = fileURLToPath(new URL("../../../../src/app/tools/m/coverage-loads", import.meta.url));

  function listFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
  }

  const moduleFiles = listFiles(MODULE_DIR);
  const sourceFiles = moduleFiles.filter((path) => /\.(ts|tsx|json|css)$/.test(path));
  const sources = new Map(sourceFiles.map((path) => [path, readFileSync(path, "utf8")]));

  it("should contain no SHP file or folder anywhere in the module or its generated routes", () => {
    // Arrange
    const everyPath = [...moduleFiles, ...listFiles(API_DIR), ...listFiles(PAGE_DIR)].map((path) => relative(MODULE_DIR, path));

    // Act
    const offenders = everyPath.filter((path) => /shp|shape/i.test(path));

    // Assert
    expect(offenders).toEqual([]);
  });

  it("should mention no SHP route, tab or placeholder in any source file", () => {
    // Arrange
    const offenders = [...sources.entries()]
      .filter(([, text]) => /\bshp\b|shapefile|\.shp\b|carga\s+shp/i.test(text))
      .map(([path]) => relative(MODULE_DIR, path));

    // Assert
    expect(offenders).toEqual([]);
  });

  it("should serve nothing but the indicators endpoints from the generated route tree", () => {
    // Arrange
    const routes = listFiles(API_DIR).map((path) => relative(API_DIR, path).replace(/\\/g, "/"));

    // Assert
    expect(routes.sort()).toEqual(["indicators/load/route.ts", "indicators/plan/route.ts", "indicators/reports/route.ts"]);
  });

  it("should not import any other module", () => {
    // Arrange
    const importOfAnotherModule = /from\s+["']@\/modules\/(?!coverage-loads\b)/;
    const offenders = [...sources.entries()].filter(([, text]) => importOfAnotherModule.test(text)).map(([path]) => relative(MODULE_DIR, path));

    // Assert
    expect(offenders).toEqual([]);
  });

  it("should keep shared/ free of imports from the indicators part", () => {
    // Arrange
    const offenders = [...sources.entries()]
      .filter(([path]) => relative(MODULE_DIR, path).startsWith("shared"))
      .filter(([, text]) => /from\s+["'](\.\.\/)+indicators|@\/modules\/coverage-loads\/indicators/.test(text))
      .map(([path]) => relative(MODULE_DIR, path));

    // Assert
    expect(offenders).toEqual([]);
  });

  it("should keep the browser entry (client.ts) free of node and database imports", () => {
    // Arrange
    const clientSource = sources.get(join(MODULE_DIR, "indicators", "client.ts")) ?? "";

    // Assert
    expect(clientSource).not.toMatch(/from\s+["'](pg|node:|fs|path)/);
    expect(clientSource).not.toMatch(/services\/|api\//);
  });
});
