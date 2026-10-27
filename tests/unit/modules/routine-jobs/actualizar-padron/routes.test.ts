import { describe, it, expect } from "vitest";
import { createModuleRegistry } from "@/core/modules/createModuleRegistry";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import { routineJobsModule } from "@/modules/routine-jobs/manifest";
import routeDeclarations from "@/modules/routine-jobs/module.routes.json";

const ACTUALIZAR_ENDPOINTS = ["POST actualizar-padron/start", "GET actualizar-padron/status"];
const CARGAR_ENDPOINTS = ["POST cargar-padrones/start", "GET cargar-padrones/status"];
const LOCALIDADES_ENDPOINTS = ["POST cargar-localidades/start", "GET cargar-localidades/status"];
const CATALOG_ENDPOINTS = ["POST catalog/tables", "POST catalog/columns"];
const BASE_URL = "http://localhost/api/modules/routine-jobs";

const keyOf = (endpoint: { method: string; path: string }): string => `${endpoint.method} ${endpoint.path}`;

describe("routine jobs actualizar-padron routes", () => {
  describe("module.routes.json (AP-36)", () => {
    it("should declare the actualizar-padron start endpoint as POST", () => {
      const endpoint = routeDeclarations.endpoints.find((entry) => entry.path === "actualizar-padron/start");

      expect(endpoint?.method).toBe("POST");
    });

    it("should declare the actualizar-padron status endpoint as GET", () => {
      const endpoint = routeDeclarations.endpoints.find((entry) => entry.path === "actualizar-padron/status");

      expect(endpoint?.method).toBe("GET");
    });

    it("should declare both actualizar-padron endpoints as nodejs and force-dynamic", () => {
      const declared = routeDeclarations.endpoints.filter((entry) => entry.path.startsWith("actualizar-padron/"));

      expect(declared).toHaveLength(2);
      for (const endpoint of declared) {
        expect(endpoint.runtime).toBe("nodejs");
        expect(endpoint.dynamic).toBe("force-dynamic");
      }
    });

    it("should declare exactly the endpoints of the routine jobs and the catalog", () => {
      const declared = routeDeclarations.endpoints.map(keyOf).sort();

      expect(declared).toEqual([...ACTUALIZAR_ENDPOINTS, ...CARGAR_ENDPOINTS, ...LOCALIDADES_ENDPOINTS, ...CATALOG_ENDPOINTS].sort());
    });

    it("should keep the cargar and catalog endpoints declared exactly as before", () => {
      const declared = routeDeclarations.endpoints.map(keyOf);

      for (const key of [...CARGAR_ENDPOINTS, ...CATALOG_ENDPOINTS]) {
        expect(declared).toContain(key);
      }
    });
  });

  describe("manifest bindings (AP-36)", () => {
    it("should bind a handler to each actualizar-padron endpoint", () => {
      const endpoints = routineJobsModule.endpoints ?? [];

      for (const key of ACTUALIZAR_ENDPOINTS) {
        const endpoint = endpoints.find((entry) => keyOf(entry) === key);
        expect(endpoint?.handler, key).toBeTypeOf("function");
      }
    });

    it("should bind every declared endpoint, the actualizar-padron ones included, and nothing else", () => {
      const endpoints = routineJobsModule.endpoints ?? [];

      expect(endpoints.map(keyOf).sort()).toEqual(
        [...ACTUALIZAR_ENDPOINTS, ...CARGAR_ENDPOINTS, ...LOCALIDADES_ENDPOINTS, ...CATALOG_ENDPOINTS].sort()
      );
    });

    it("should answer the actualizar start route with the parse-first handler and no stub", async () => {
      const endpoint = (routineJobsModule.endpoints ?? []).find(
        (entry) => keyOf(entry) === "POST actualizar-padron/start"
      );

      const response = await endpoint?.handler(
        new Request(`${BASE_URL}/actualizar-padron/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{not json",
        })
      );

      expect(response?.status).toBe(400);
      expect(await response?.json()).toEqual({
        success: false,
        error: "El cuerpo de la petición no es JSON válido.",
      });
    });

    it("should answer the actualizar status route with 400 in Spanish when jobId is missing", async () => {
      const endpoint = (routineJobsModule.endpoints ?? []).find(
        (entry) => keyOf(entry) === "GET actualizar-padron/status"
      );

      const response = await endpoint?.handler(new Request(`${BASE_URL}/actualizar-padron/status`));

      expect(response?.status).toBe(400);
      expect(await response?.json()).toEqual({
        success: false,
        error: "El parámetro jobId es obligatorio.",
      });
    });

    it("should keep the module's page, navigation and home card unchanged", () => {
      expect(routineJobsModule.pages).toHaveLength(1);
      expect(routineJobsModule.navigation).toHaveLength(1);
      expect(routineJobsModule.ui).toHaveLength(1);
    });
  });

  describe("registry routing (AP-36)", () => {
    it("should serve the actualizar start route as POST from the module", () => {
      const registry = createModuleRegistry([routineJobsModule]);

      expect(registry.findEndpoint(ModuleHttpMethod.POST, "routine-jobs/actualizar-padron/start")?.moduleId).toBe(
        "routine-jobs"
      );
    });

    it("should serve the actualizar status route as GET from the module", () => {
      const registry = createModuleRegistry([routineJobsModule]);

      expect(registry.findEndpoint(ModuleHttpMethod.GET, "routine-jobs/actualizar-padron/status")?.moduleId).toBe(
        "routine-jobs"
      );
    });

    it("should not answer the actualizar start route with GET or the status route with POST", () => {
      const registry = createModuleRegistry([routineJobsModule]);

      expect(registry.findEndpoint(ModuleHttpMethod.GET, "routine-jobs/actualizar-padron/start")).toBeNull();
      expect(registry.findEndpoint(ModuleHttpMethod.POST, "routine-jobs/actualizar-padron/status")).toBeNull();
    });
  });
});
