import { describe, it, expect } from "vitest";
import { createModuleRegistry } from "@/core/modules/createModuleRegistry";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import { UiSlot } from "@/ui-kit/modules/contracts";
import { moduleRegistry } from "@/app/modules.registry";
import { routineJobsModule } from "@/modules/routine-jobs/manifest";
import routeDeclarations from "@/modules/routine-jobs/module.routes.json";
import { RoutineJobsDashboard } from "@/modules/routine-jobs/ui/RoutineJobsDashboard";
import { RoutineJobsHomeCard } from "@/modules/routine-jobs/ui/RoutineJobsHomeCard";

const EXPECTED_ENDPOINTS = [
  "GET actualizar-padron/status",
  "GET actualizar-padron/backup",
  "GET cargar-padrones/status",
  "POST actualizar-padron/start",
  "POST cargar-localidades/start",
  "GET cargar-localidades/status",
  "POST unidad-territorial/start",
  "GET unidad-territorial/status",
  "POST completar-unidad-territorial/start",
  "GET completar-unidad-territorial/status",
  "POST cargar-padrones/start",
  "POST catalog/columns",
  "POST catalog/tables",
];

const keyOf = (endpoint: { method: string; path: string }): string => `${endpoint.method} ${endpoint.path}`;

describe("routine jobs module declaration", () => {
  describe("module.routes.json (AC-23..AC-25)", () => {
    it("AC-23: should declare the routine-jobs module id", () => {
      expect(routeDeclarations.moduleId).toBe("routine-jobs");
    });

    it("AC-23/AC-24/AC-25: should declare exactly the endpoints of the jobs", () => {
      const declared = routeDeclarations.endpoints.map(keyOf).sort();

      expect(declared).toEqual([...EXPECTED_ENDPOINTS].sort());
    });

    it("AC-23/AC-24/AC-25: should declare every endpoint as nodejs and force-dynamic", () => {
      for (const endpoint of routeDeclarations.endpoints) {
        expect(endpoint.runtime).toBe("nodejs");
        expect(endpoint.dynamic).toBe("force-dynamic");
      }
    });

    it("AC-33: should declare exactly one page, the module root titled Trabajos de rutina", () => {
      const pages = (routeDeclarations as { pages?: unknown[] }).pages ?? [];

      expect(pages).toEqual([{ path: "", title: "Trabajos de rutina" }]);
    });

    it("AC-23: should keep every secret out of URLs by declaring catalog and start as POST", () => {
      const methods = Object.fromEntries(routeDeclarations.endpoints.map((endpoint) => [endpoint.path, endpoint.method]));

      expect(methods["catalog/tables"]).toBe("POST");
      expect(methods["catalog/columns"]).toBe("POST");
      expect(methods["cargar-padrones/start"]).toBe("POST");
      expect(methods["cargar-padrones/status"]).toBe("GET");
    });
  });

  describe("manifest", () => {
    it("AC-23: should take its id from the declaration file and match the module folder name", () => {
      expect(routineJobsModule.id).toBe("routine-jobs");
      expect(routineJobsModule.id).toBe(routeDeclarations.moduleId);
    });

    it("AC-23: should have a non-empty display name", () => {
      expect(routineJobsModule.name.length).toBeGreaterThan(0);
    });

    it("AC-23/AC-24/AC-25: should bind a handler to every declared endpoint and nothing else", () => {
      const endpoints = routineJobsModule.endpoints ?? [];

      expect(endpoints.map(keyOf).sort()).toEqual([...EXPECTED_ENDPOINTS].sort());
      expect(endpoints.every((endpoint) => typeof endpoint.handler === "function")).toBe(true);
    });

    it("AC-23/AC-24/AC-25: should serve every endpoint dynamically on the node runtime", () => {
      const endpoints = routineJobsModule.endpoints ?? [];

      expect(endpoints.every((endpoint) => endpoint.runtime === "nodejs")).toBe(true);
      expect(endpoints.every((endpoint) => endpoint.dynamic === "force-dynamic")).toBe(true);
    });

    it("AC-33: should bind the module root page to the dashboard", () => {
      const pages = routineJobsModule.pages ?? [];

      expect(pages).toHaveLength(1);
      expect(pages[0].path).toBe("");
      expect(pages[0].title).toBe("Trabajos de rutina");
      expect(pages[0].Component).toBe(RoutineJobsDashboard);
    });

    it("AC-33: should add one navigation entry to the module page", () => {
      const navigation = routineJobsModule.navigation ?? [];

      expect(navigation).toHaveLength(1);
      expect(navigation[0].label).toBe("Trabajos de rutina");
      expect(navigation[0].href).toBe("/tools/m/routine-jobs");
      expect(typeof navigation[0].order).toBe("number");
      expect(typeof navigation[0].iconName).toBe("string");
      expect((navigation[0].iconName ?? "").length).toBeGreaterThan(0);
    });

    it("AC-33: should contribute only the home card, into the home tool grid", () => {
      const contributions = routineJobsModule.ui ?? [];

      expect(contributions).toHaveLength(1);
      expect(contributions[0].slot).toBe(UiSlot.HOME_TOOL_GRID);
      expect(contributions[0].id).toBe("routine-jobs.card");
      expect(contributions[0].Component).toBe(RoutineJobsHomeCard);
    });

    it("AC-34: should declare the module wiki directory", () => {
      expect(routineJobsModule.wiki).toEqual({ contentDir: "src/modules/routine-jobs/wiki" });
    });

    it("AC-33: should own the page the navigation entry and home card link to", () => {
      const registry = createModuleRegistry([routineJobsModule]);

      const page = registry.findPage("routine-jobs");

      expect(page?.moduleId).toBe("routine-jobs");
      expect(page?.page.Component).toBe(RoutineJobsDashboard);
      expect(registry.pages()).toHaveLength(1);
      expect(registry.navigation()).toHaveLength(1);
    });

    it("AC-23/AC-24/AC-25: should expose the routes the browser client will call", () => {
      const registry = createModuleRegistry([routineJobsModule]);

      const expectedRoutes: ReadonlyArray<[ModuleHttpMethod, string]> = [
        [ModuleHttpMethod.POST, "routine-jobs/catalog/tables"],
        [ModuleHttpMethod.POST, "routine-jobs/catalog/columns"],
        [ModuleHttpMethod.POST, "routine-jobs/cargar-padrones/start"],
        [ModuleHttpMethod.GET, "routine-jobs/cargar-padrones/status"],
      ];

      for (const [method, routePath] of expectedRoutes) {
        expect(registry.findEndpoint(method, routePath)?.moduleId).toBe("routine-jobs");
      }
    });

    it("AC-23: should not answer a method that was not declared", () => {
      const registry = createModuleRegistry([routineJobsModule]);

      expect(registry.findEndpoint(ModuleHttpMethod.GET, "routine-jobs/catalog/tables")).toBeNull();
      expect(registry.findEndpoint(ModuleHttpMethod.POST, "routine-jobs/cargar-padrones/status")).toBeNull();
    });

    it("AC-23: should register cleanly on its own", () => {
      const registry = createModuleRegistry([routineJobsModule]);

      expect(registry.modules).toHaveLength(1);
      expect(registry.endpoints()).toHaveLength(routeDeclarations.endpoints.length);
    });

    it("AC-23: should leave an application that does not register it unaffected", () => {
      const registry = createModuleRegistry();

      expect(registry.findEndpoint(ModuleHttpMethod.POST, "routine-jobs/catalog/tables")).toBeNull();
    });
  });

  describe("composition root", () => {
    it("AC-23: should be listed in the application's module registry", () => {
      expect(moduleRegistry.modules.map((module) => module.id)).toContain("routine-jobs");
    });

    it("AC-33: should serve its page through the application's module registry", () => {
      expect(moduleRegistry.findPage("routine-jobs")?.moduleId).toBe("routine-jobs");
    });

    it("AC-34: should expose its wiki source through the application's module registry", () => {
      const sources = moduleRegistry.wikiSources();

      expect(sources.find((source) => source.toolSlug === "routine-jobs")?.contentDir).toBe("src/modules/routine-jobs/wiki");
    });

    it("AC-23/AC-24/AC-25: should serve its endpoints through the application's module registry", () => {
      expect(moduleRegistry.findEndpoint(ModuleHttpMethod.POST, "routine-jobs/catalog/tables")?.moduleId).toBe("routine-jobs");
      expect(moduleRegistry.findEndpoint(ModuleHttpMethod.POST, "routine-jobs/catalog/columns")?.moduleId).toBe("routine-jobs");
      expect(moduleRegistry.findEndpoint(ModuleHttpMethod.POST, "routine-jobs/cargar-padrones/start")?.moduleId).toBe("routine-jobs");
      expect(moduleRegistry.findEndpoint(ModuleHttpMethod.GET, "routine-jobs/cargar-padrones/status")?.moduleId).toBe("routine-jobs");
    });
  });
});
