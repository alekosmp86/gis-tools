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
  avanceInspected: 0,
  avanceLoads: [] as boolean[],
  avanceReports: [] as string[][],
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

vi.mock("@/modules/coverage-loads/avance-ftth/services/PgAvanceFtthRepository", () => ({
  PgAvanceFtthRepository: class {
    async inspect() {
      repositoryCalls.avanceInspected += 1;
      return {
        staging: { INT: { rows: 0, fechaact: null }, UDPEM: { rows: 0, fechaact: null } },
        avance: { rows: 0, oldestLoad: null, newestLoad: null, loadedToday: false },
        historyRows: 0,
        zoneRows: 10,
        zoneStatuses: [],
        avanceByStatus: [],
        shortfalls: [],
      };
    }

    async load(_connection: unknown, request: { dryRun: boolean }) {
      repositoryCalls.avanceLoads.push(request.dryRun);
      return {
        dryRun: request.dryRun,
        files: [],
        history: { copied: 0, skipped: false, reason: null },
        avanceInserted: 0,
        byStatus: [],
        reports: [],
        elapsedMs: 1,
        warnings: [],
        rejectedRows: [],
      };
    }

    async readReports(_connection: unknown, kinds: string[]) {
      repositoryCalls.avanceReports.push([...kinds]);
      return kinds.map((kind) => ({ kind, rows: [], error: null }));
    }
  },
}));

const { coverageLoadsModule } = await import("@/modules/coverage-loads/manifest");
const { COVERAGE_STAGES, CoverageStageId } = await import("@/modules/coverage-loads/workflow/ui/coverageStages");
const { moduleRegistry } = await import("@/app/modules.registry");
const routeDeclarations = (await import("@/modules/coverage-loads/module.routes.json")).default;

/** Slots a host actually renders today. Contributing anywhere else renders nowhere, silently. */
const MOUNTED_SLOTS: ReadonlyArray<UiSlot> = [UiSlot.HOME_TOOL_GRID, UiSlot.FILE_SOURCE_TABS, UiSlot.APP_STATUS];

const API = "coverage-loads/indicators";
const AVANCE_API = "coverage-loads/avance-ftth";
const AVANCE_ENDPOINTS = ["POST avance-ftth/plan", "POST avance-ftth/load", "POST avance-ftth/reports"];
const AVANCE_ROUTE_NAMES = ["load", "plan", "reports"];
const AVANCE_CSV = "central;cable;zona;empresa;plano_al_com;ejecutor;director_obra;etiqueta;conca;edificio\nC;01;01;E;;;;X;K;ED1\n";
const SHP_ENDPOINTS = [
  "POST shp/upload",
  "POST shp/plan",
  "POST shp/start",
  "GET shp/status",
  "GET shp/jobs",
  "POST shp/cancel",
  "GET shp/log",
  "POST shp/discard",
];
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
  return new Request(`http://localhost/api/m/${API}`, { method: "POST", headers: { "content-length": "2048" }, body: form });
}

/** The upload endpoints require a declared Content-Length (AC-26); a browser always sends one. */
const AVANCE_DECLARED_UPLOAD_BYTES = "2048";

function avanceUploadRequest(path: string, fields: Record<string, string> = {}): Request {
  const form = new FormData();
  form.append("connection", JSON.stringify(CONNECTION));
  form.append("files", new File([AVANCE_CSV], "SituacionFTTH_INT_21092026.csv"));
  form.append("files", new File([AVANCE_CSV], "SituacionFTTH_UDPEM_21092026.csv"));
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return new Request(`http://localhost/api/m/${AVANCE_API}/${path}`, {
    method: "POST",
    headers: { "content-length": AVANCE_DECLARED_UPLOAD_BYTES },
    body: form,
  });
}

beforeEach(() => {
  repositoryCalls.inspected = 0;
  repositoryCalls.loaded = 0;
  repositoryCalls.reports.length = 0;
  repositoryCalls.avanceInspected = 0;
  repositoryCalls.avanceLoads.length = 0;
  repositoryCalls.avanceReports.length = 0;
});

describe("coverage loads manifest", () => {
  describe("identity and endpoints (AC-22, AC-27, AC-29)", () => {
    it("should take its id from the declaration file the generator reads", () => {
      // Arrange, Act & Assert
      expect(coverageLoadsModule.id).toBe("coverage-loads");
      expect(coverageLoadsModule.id).toBe(routeDeclarations.moduleId);
    });

    it("should declare the three indicator endpoints, the three avance-ftth endpoints (all POST) and then the eight shp endpoints", () => {
      // Arrange, Act & Assert
      expect(routeDeclarations.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual([
        "POST indicators/plan",
        "POST indicators/load",
        "POST indicators/reports",
        ...AVANCE_ENDPOINTS,
        ...SHP_ENDPOINTS,
      ]);
    });

    it("should declare nodejs and force-dynamic for each avance-ftth endpoint and bind every declared endpoint to a handler", () => {
      // Arrange
      const declared = routeDeclarations.endpoints.filter((endpoint) => endpoint.path.startsWith("avance-ftth/"));
      const bound = (coverageLoadsModule.endpoints ?? []).filter((endpoint) => endpoint.path.startsWith("avance-ftth/"));

      // Act & Assert
      expect(declared).toHaveLength(3);
      expect(declared.every((endpoint) => endpoint.method === "POST" && endpoint.runtime === "nodejs" && endpoint.dynamic === "force-dynamic")).toBe(true);
      expect(bound.map((endpoint) => endpoint.path).sort()).toEqual(declared.map((endpoint) => endpoint.path).sort());
      expect(bound.every((endpoint) => typeof endpoint.handler === "function")).toBe(true);
    });

    it("should bind a handler to every declared endpoint and keep nodejs / force-dynamic", () => {
      // Arrange & Act
      const endpoints = coverageLoadsModule.endpoints ?? [];

      // Assert
      expect(endpoints).toHaveLength(14);
      expect(endpoints.every((endpoint) => typeof endpoint.handler === "function")).toBe(true);
      expect(endpoints.every((endpoint) => endpoint.runtime === "nodejs")).toBe(true);
      expect(endpoints.every((endpoint) => endpoint.dynamic === "force-dynamic")).toBe(true);
      expect(endpoints.filter((endpoint) => endpoint.path.startsWith("indicators/")).every((endpoint) => endpoint.method === ModuleHttpMethod.POST)).toBe(true);
    });

    it("should declare nodejs and force-dynamic for each shp endpoint in the route declarations", () => {
      // Arrange
      const shp = routeDeclarations.endpoints.filter((endpoint) => endpoint.path.startsWith("shp/"));

      // Act & Assert
      expect(shp).toHaveLength(8);
      expect(shp.every((endpoint) => endpoint.runtime === "nodejs" && endpoint.dynamic === "force-dynamic")).toBe(true);
    });

    it("should expose each shp endpoint with its declared method only (GET for status/jobs/log, POST otherwise)", () => {
      // Arrange
      const registry = createModuleRegistry([coverageLoadsModule]);

      // Act & Assert
      for (const entry of SHP_ENDPOINTS) {
        const [method, path] = entry.split(" ");
        const other = method === "GET" ? ModuleHttpMethod.POST : ModuleHttpMethod.GET;
        expect(registry.findEndpoint(method as ModuleHttpMethod, `coverage-loads/${path}`)?.moduleId).toBe("coverage-loads");
        expect(registry.findEndpoint(other, `coverage-loads/${path}`)).toBeNull();
      }
    });

    it("should bind each shp endpoint to its own handler, which answers in the shp error envelope", async () => {
      // Arrange
      const registry = createModuleRegistry([coverageLoadsModule]);
      const call = (method: ModuleHttpMethod, name: string) => {
        const found = registry.findEndpoint(method, `coverage-loads/shp/${name}`);
        if (!found) throw new Error(`no shp endpoint ${name}`);
        const init = method === ModuleHttpMethod.GET ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
        return found.endpoint.handler(new Request(`http://localhost/api/m/coverage-loads/shp/${name}`, init));
      };

      // Act
      const statusResponse = await call(ModuleHttpMethod.GET, "status");
      const logResponse = await call(ModuleHttpMethod.GET, "log");
      const cancelResponse = await call(ModuleHttpMethod.POST, "cancel");
      const discardResponse = await call(ModuleHttpMethod.POST, "discard");
      const planResponse = await call(ModuleHttpMethod.POST, "plan");
      const startResponse = await call(ModuleHttpMethod.POST, "start");

      // Assert: no jobId given, so every one refuses with 400 and a Spanish error
      for (const response of [statusResponse, logResponse, cancelResponse, discardResponse, planResponse, startResponse]) {
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(typeof body.error).toBe("string");
      }
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

  describe("avance-ftth endpoint binding (AC-24)", () => {
    it("should expose the avance-ftth endpoints as POST only", () => {
      // Arrange
      const registry = createModuleRegistry([coverageLoadsModule]);

      // Act & Assert
      for (const name of AVANCE_ROUTE_NAMES) {
        expect(registry.findEndpoint(ModuleHttpMethod.POST, `${AVANCE_API}/${name}`)?.moduleId).toBe("coverage-loads");
        expect(registry.findEndpoint(ModuleHttpMethod.GET, `${AVANCE_API}/${name}`)).toBeNull();
      }
    });

    it("should bind avance-ftth/plan to the plan handler: it inspects and never writes", async () => {
      // Arrange
      const handler = findHandler(`${AVANCE_API}/plan`);

      // Act
      const response = await handler(avanceUploadRequest("plan"));

      // Assert
      expect(response.status).toBe(200);
      expect((await response.json()).plan.files).toHaveLength(2);
      expect(repositoryCalls.avanceInspected).toBe(1);
      expect(repositoryCalls.avanceLoads).toEqual([]);
    });

    it("should bind avance-ftth/load to the load handler: unconfirmed is refused, a dry run reaches the write path", async () => {
      // Arrange
      const handler = findHandler(`${AVANCE_API}/load`);

      // Act
      const unconfirmed = await handler(avanceUploadRequest("load"));
      const dryRun = await handler(avanceUploadRequest("load", { dryRun: "true" }));
      const confirmed = await handler(avanceUploadRequest("load", { confirm: "true" }));

      // Assert
      expect(unconfirmed.status).toBe(400);
      expect(dryRun.status).toBe(200);
      expect(confirmed.status).toBe(200);
      expect(repositoryCalls.avanceLoads).toEqual([true, false]);
    });

    it("should bind avance-ftth/reports to the reports handler: it reads the asked report", async () => {
      // Arrange
      const handler = findHandler(`${AVANCE_API}/reports`);
      const request = new Request(`http://localhost/api/m/${AVANCE_API}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection: CONNECTION, kind: "duplicado_planilla_obras" }),
      });

      // Act
      const response = await handler(request);

      // Assert
      expect(response.headers.get("Content-Disposition")).toContain("reporte_avance_duplicado_planilla_obras_");
      expect(repositoryCalls.avanceReports).toEqual([["duplicado_planilla_obras"]]);
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

    it("should contribute one HOME_TOOL_GRID card after the existing ones plus one APP_STATUS chip, into mounted slots", () => {
      // Arrange & Act
      const all = coverageLoadsModule.ui ?? [];
      const contributions = all.filter((c) => c.slot === UiSlot.HOME_TOOL_GRID);

      // Assert
      expect(all).toHaveLength(2);
      expect(all.filter((c) => c.slot === UiSlot.APP_STATUS)).toHaveLength(1);
      expect(all.every((c) => MOUNTED_SLOTS.includes(c.slot))).toBe(true);
      expect(contributions).toHaveLength(1);
      expect(contributions[0].slot).toBe(UiSlot.HOME_TOOL_GRID);
      expect(MOUNTED_SLOTS).toContain(contributions[0].slot);
      expect(contributions[0].order).toBeGreaterThan(110);
      expect(typeof contributions[0].Component).toBe("function");
    });

    it("should offer three stages in order: Indicadores LTE, Cargas SHP, then Avance FTTH", () => {
      // Arrange & Act & Assert
      expect(COVERAGE_STAGES.map((stage) => stage.label)).toEqual(["Indicadores LTE", "Cargas SHP", "Avance FTTH"]);
      expect(COVERAGE_STAGES.map((stage) => stage.id)).toEqual([
        CoverageStageId.INDICATORS,
        CoverageStageId.SHP,
        CoverageStageId.AVANCE_FTTH,
      ]);
      expect(COVERAGE_STAGES.every((stage) => typeof stage.Panel === "function")).toBe(true);
      expect(typeof COVERAGE_STAGES[0].ResultExtras).toBe("function");
      expect(typeof COVERAGE_STAGES[2].ResultExtras).toBe("function");
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
      expect(registry.endpoints()).toHaveLength(14);
      expect(registry.pages()).toHaveLength(1);
      expect(registry.uiContributions()).toHaveLength(2);
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

  const toName = (path: string) => relative(MODULE_DIR, path).replace(/\\/g, "/");
  const SHP_ROUTE_NAMES = ["cancel", "discard", "jobs", "log", "plan", "start", "status", "upload"];

  it("should keep SHP code only under shp/ (plus the allowed wiring files, the stage registry and the generated shp routes)", () => {
    // Arrange
    const ALLOWED_OUTSIDE_SHP = ["manifest.ts", "module.routes.json", "api/handlers.ts", "shared/httpResponses.ts", "workflow/domain/coverageStageId.ts", "workflow/domain/loadType.ts","workflow/ui/coverageStages.ts"];
    const outsideShp = moduleFiles.map(toName).filter((name) => !name.startsWith("shp/"));
    const pagePaths = listFiles(PAGE_DIR).map((path) => relative(PAGE_DIR, path));

    // Act
    const namedOffenders = outsideShp.filter((name) => /shp|shape/i.test(name));
    const mentionOffenders = [...sources.entries()]
      .map(([path, text]) => [toName(path), text] as const)
      .filter(([name]) => !name.startsWith("shp/") && !ALLOWED_OUTSIDE_SHP.includes(name))
      .filter(([, text]) => /\bshp\b|shapefile|\.shp\b|carga\s+shp/i.test(text))
      .map(([name]) => name);

    // Assert
    expect(namedOffenders).toEqual([]);
    expect(mentionOffenders).toEqual([]);
    expect(pagePaths.filter((path) => /shp|shape/i.test(path))).toEqual([]);
  });

  it("should host the SHP UI as a stage under shp/ui and add no extra page", () => {
    // Arrange
    const shpUiFiles = moduleFiles.map(toName).filter((name) => name.startsWith("shp/ui/") && /\.(tsx|css)$/.test(name));

    // Assert
    expect(shpUiFiles).toContain("shp/ui/ShpPanel.tsx");
    expect(COVERAGE_STAGES.map((stage) => stage.id)).toEqual([
      CoverageStageId.INDICATORS,
      CoverageStageId.SHP,
      CoverageStageId.AVANCE_FTTH,
    ]);
    expect(routeDeclarations.pages).toHaveLength(1);
  });

  it("should not be referenced from outside the module (except the generated shp routes and the registry)", () => {
    // Arrange
    const SRC_DIR = fileURLToPath(new URL("../../../../src", import.meta.url));
    const generatedShpRoutes = join(API_DIR, "shp");
    const scanned = ["app", "core", "ui-kit"].flatMap((folder) => listFiles(join(SRC_DIR, folder)));

    // Act
    const offenders = scanned
      .filter((path) => !path.startsWith(generatedShpRoutes))
      .filter((path) => !/modules\.registry\.ts$/.test(path))
      .filter((path) => /coverage-loads\/shp/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC_DIR, path));

    // Assert
    expect(offenders).toEqual([]);
  });

  it("should serve the indicators endpoints, the three avance-ftth endpoints and the eight generated shp routes from the route tree", () => {
    // Arrange
    const routes = listFiles(API_DIR).map((path) => relative(API_DIR, path).replace(/\\/g, "/"));

    // Assert
    expect(routes.sort()).toEqual(
      [
        "indicators/load/route.ts",
        "indicators/plan/route.ts",
        "indicators/reports/route.ts",
        ...AVANCE_ROUTE_NAMES.map((name) => `avance-ftth/${name}/route.ts`),
        ...SHP_ROUTE_NAMES.map((name) => `shp/${name}/route.ts`),
      ].sort()
    );
  });

  it("should generate each avance-ftth route as POST, nodejs and force-dynamic bound to its declared path", () => {
    // Arrange & Act & Assert
    for (const name of AVANCE_ROUTE_NAMES) {
      const text = readFileSync(join(API_DIR, "avance-ftth", name, "route.ts"), "utf8");
      expect(text).toContain("export const POST = createModuleRouteHandler(");
      expect(text).toContain("ModuleHttpMethod.POST");
      expect(text).toContain(`"coverage-loads/avance-ftth/${name}"`);
      expect(text).toContain('export const runtime = "nodejs"');
      expect(text).toContain('export const dynamic = "force-dynamic"');
    }
  });

  it("should generate each shp route with the declared method, nodejs and force-dynamic", () => {
    // Arrange & Act & Assert
    for (const entry of SHP_ENDPOINTS) {
      const [method, path] = entry.split(" ");
      const text = readFileSync(join(API_DIR, path, "route.ts"), "utf8");
      expect(text).toContain(`export const ${method} = createModuleRouteHandler(`);
      expect(text).toContain(`ModuleHttpMethod.${method}`);
      expect(text).toContain(`"coverage-loads/${path}"`);
      expect(text).toContain('export const runtime = "nodejs"');
      expect(text).toContain('export const dynamic = "force-dynamic"');
    }
  });

  describe("shp boundaries", () => {
    const shpEntries = () =>
      [...sources.entries()].map(([path, text]) => ({ name: toName(path), path, text })).filter((entry) => entry.name.startsWith("shp/"));
    const importSpecifiers = (text: string) => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);

    it("should keep shp/job imports to relative .ts files inside shp/job, node: built-ins and pg", () => {
      // Arrange
      const JOB_DIR = join(MODULE_DIR, "shp", "job");
      const offenders: string[] = [];
      const jobFiles = shpEntries().filter((entry) => entry.name.startsWith("shp/job/") && entry.name.endsWith(".ts"));

      // Act
      for (const entry of jobFiles) {
        for (const specifier of importSpecifiers(entry.text)) {
          if (specifier.startsWith("node:") || specifier === "pg" || specifier === "pg-copy-streams") continue;
          const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
          const insideJob = isRelative && !relative(JOB_DIR, join(entry.path, "..", specifier)).startsWith("..");
          if (!isRelative || !specifier.endsWith(".ts") || !insideJob) offenders.push(`${entry.name} -> ${specifier}`);
        }
      }

      // Assert
      expect(jobFiles.length).toBeGreaterThan(10);
      expect(offenders).toEqual([]);
    });

    it("should keep shp/job free of enum, namespace and constructor parameter properties", () => {
      // Arrange
      const forbidden = /^\s*(export\s+)?(const\s+)?enum\s|^\s*(export\s+)?(declare\s+)?namespace\s|constructor\s*\((?:[^)]*,)?\s*(private|public|protected|readonly)\s+\w/m;
      const offenders = shpEntries()
        .filter((entry) => entry.name.startsWith("shp/job/") && entry.name.endsWith(".ts"))
        .filter((entry) => forbidden.test(entry.text))
        .map((entry) => entry.name);

      // Assert
      expect(offenders).toEqual([]);
    });

    it("should never import ui/ from shp/api or shp/services", () => {
      // Arrange
      const offenders = shpEntries()
        .filter((entry) => /^shp\/(api|services)\//.test(entry.name))
        .filter((entry) => importSpecifiers(entry.text).some((specifier) => /(^|\/)ui(\/|$)/.test(specifier)))
        .map((entry) => entry.name);

      // Assert
      expect(offenders).toEqual([]);
    });

    it("should keep shp/, indicators/ and workflow/ independent of one another (except the registry importing shp/ui)", () => {
      // Arrange
      const all = [...sources.entries()].map(([path, text]) => ({ name: toName(path), text }));
      const importsOf = (folder: string, target: string) =>
        all
          .filter((entry) => entry.name.startsWith(`${folder}/`))
          .filter((entry) =>
            importSpecifiers(entry.text).some(
              (specifier) => new RegExp(`(^|/)${target}(/|$)`).test(specifier) && /coverage-loads|^\.\.?\//.test(specifier)
            )
          )
          .map((entry) => entry.name);

      // Act & Assert
      expect(importsOf("indicators", "shp")).toEqual([]);
      expect(importsOf("workflow", "shp")).toEqual(["workflow/ui/coverageStages.ts"]);
      expect(importsOf("shp", "indicators")).toEqual([]);
      expect(importsOf("shp", "workflow")).toEqual([]);
    });

    it("should let shp/job stay free of shared/ while shp/api may use it", () => {
      // Arrange
      const importsShared = (entry: { text: string }) => importSpecifiers(entry.text).some((specifier) => /(^|\/)shared(\/|$)/.test(specifier));

      // Act & Assert
      expect(shpEntries().filter((entry) => entry.name.startsWith("shp/job/")).filter(importsShared).map((entry) => entry.name)).toEqual([]);
      expect(shpEntries().filter((entry) => entry.name.startsWith("shp/api/")).some(importsShared)).toBe(true);
    });
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

  const inFolder = (folder: string) => ([path]: [string, string]) =>
    relative(MODULE_DIR, path).replace(/\\/g, "/").startsWith(`${folder}/`);
  const relativeName = ([path]: [string, string]) => relative(MODULE_DIR, path).replace(/\\/g, "/");

  it("should scan the new workflow/ and shared/ folders", () => {
    // Arrange
    const entries = [...sources.entries()];

    // Act & Assert
    expect(entries.filter(inFolder("workflow")).length).toBeGreaterThan(0);
    expect(entries.filter(inFolder("shared")).length).toBeGreaterThan(0);
    expect(entries.filter(inFolder("indicators")).length).toBeGreaterThan(0);
  });

  it("should keep shared/ free of imports from workflow/", () => {
    // Arrange
    const offenders = [...sources.entries()]
      .filter(inFolder("shared"))
      .filter(([, text]) => /from\s+["'](\.\.\/)+workflow|@\/modules\/coverage-loads\/workflow/.test(text))
      .map(relativeName);

    // Assert
    expect(offenders).toEqual([]);
  });

  it("should keep indicators/ free of imports from workflow/", () => {
    // Arrange
    const offenders = [...sources.entries()]
      .filter(inFolder("indicators"))
      .filter(([, text]) => /from\s+["'][^"']*\/workflow\b|@\/modules\/coverage-loads\/workflow/.test(text))
      .map(relativeName);

    // Assert
    expect(offenders).toEqual([]);
  });

  it("should keep workflow/ unaware of the indicators part except in the one stage registry", () => {
    // Arrange
    const offenders = [...sources.entries()]
      .filter(inFolder("workflow"))
      .filter(([, text]) => /indicators\//.test(text))
      .map(relativeName);

    // Assert
    expect(offenders).toEqual(["workflow/ui/coverageStages.ts"]);
  });

  it("should name indicators/ nowhere in shared/", () => {
    // Arrange
    const offenders = [...sources.entries()].filter(inFolder("shared")).filter(([, text]) => /indicators\//.test(text)).map(relativeName);

    // Assert
    expect(offenders).toEqual([]);
  });

  it("should have dropped the superseded section tabs and per-flow connection step", () => {
    // Arrange
    const names = moduleFiles.map((path) => relative(MODULE_DIR, path).replace(/\\/g, "/"));

    // Act & Assert
    expect(names).not.toContain("ui/coverageSections.ts");
    expect(names).not.toContain("ui/CoverageSectionTabs.tsx");
    expect(names).not.toContain("indicators/ui/IndicatorsConnectionStep.tsx");
    expect(names).not.toContain("indicators/ui/indicatorsSteps.ts");
  });

  it("should keep the browser entry (client.ts) free of node and database imports", () => {
    // Arrange
    const clientSource = sources.get(join(MODULE_DIR, "indicators", "client.ts")) ?? "";

    // Assert
    expect(clientSource).not.toMatch(/from\s+["'](pg|node:|fs|path)/);
    expect(clientSource).not.toMatch(/services\/|api\//);
  });
});
