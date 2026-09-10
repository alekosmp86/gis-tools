import type { Page, Request as PlaywrightRequest, Route } from "@playwright/test";
import {
  DEFAULT_DB_COLUMNS_RESPONSE,
  DEFAULT_EXECUTE_RESPONSE,
  DEFAULT_TEST_RESPONSE,
  buildNdjsonStream,
} from "../fixtures/dbFixtures";
import {
  DEFAULT_WATCHED_SOURCES,
  DEFAULT_SOURCE_SUMMARIES,
  DEFAULT_CATALOG_GROUPS,
  SAMPLE_CATALOG_FILE_CSV,
} from "../fixtures/watcherFixtures";

export type DbColumnsResponse = typeof DEFAULT_DB_COLUMNS_RESPONSE;
export type DbExecuteResponse = typeof DEFAULT_EXECUTE_RESPONSE;
export type DbTestResponse = typeof DEFAULT_TEST_RESPONSE;
export type WatchedSourceFixture = (typeof DEFAULT_WATCHED_SOURCES)[number];
export type SourceSummaryFixture = (typeof DEFAULT_SOURCE_SUMMARIES)[number];
export type CatalogGroupFixture = (typeof DEFAULT_CATALOG_GROUPS)[number];

export interface MockBackendOptions {
  columns?: DbColumnsResponse | ((body: Record<string, unknown>) => DbColumnsResponse);
  columnsStatus?: number;
  recordsStream?: string | ((body: Record<string, unknown>) => string);
  recordsStatus?: number;
  execute?: DbExecuteResponse | ((body: Record<string, unknown>) => DbExecuteResponse);
  executeStatus?: number;
  testDb?: DbTestResponse | ((body: Record<string, unknown>) => DbTestResponse);
  watcherSources?:
    | WatchedSourceFixture[]
    | ((req: PlaywrightRequest) => WatchedSourceFixture[]);
  watcherSummaries?:
    | SourceSummaryFixture[]
    | ((req: PlaywrightRequest) => SourceSummaryFixture[]);
  watcherCatalog?: CatalogGroupFixture[] | ((url: URL) => CatalogGroupFixture[]);
  watcherCatalogFile?:
    | { content: string | Buffer; contentType?: string }
    | ((url: URL) => { content: string | Buffer; contentType?: string });
  watcherRemove?:
    | { success: boolean; sources?: WatchedSourceFixture[] }
    | ((body: Record<string, unknown>) => { success: boolean; sources?: WatchedSourceFixture[] });
  watcherUpdate?:
    | { status?: number; body?: unknown }
    | ((body: Record<string, unknown>) => { status?: number; body?: unknown });
}

function resolveOverride<TArg, TResult>(
  override: TResult | ((arg: TArg) => TResult) | undefined,
  arg: TArg,
  fallback: TResult | (() => TResult)
): TResult {
  if (typeof override === "function") {
    return (override as (arg: TArg) => TResult)(arg);
  }
  if (override !== undefined) {
    return override;
  }
  return typeof fallback === "function" ? (fallback as () => TResult)() : fallback;
}

/**
 * Intercepts all backend endpoints used by the GIS Tools application with sane mock fixtures.
 * Callers can selectively override individual endpoint responses.
 */
export async function mockBackend(page: Page, options: MockBackendOptions = {}) {
  let currentSources: WatchedSourceFixture[] = Array.isArray(options.watcherSources)
    ? [...options.watcherSources]
    : [...DEFAULT_WATCHED_SOURCES];

  const routes: Array<{ pattern: string; handler: (route: Route) => Promise<void> }> = [
    // 1. /api/db/columns
    {
      pattern: "**/api/db/columns",
      handler: async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        if (options.columnsStatus && options.columnsStatus !== 200) {
          return route.fulfill({
            status: options.columnsStatus,
            contentType: "application/json",
            body: JSON.stringify({ success: false, error: "Error al inspeccionar tabla" }),
          });
        }
        const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
        const responseData = resolveOverride(options.columns, body, () => ({
          ...DEFAULT_DB_COLUMNS_RESPONSE,
          tableName: (body.table_name as string) || DEFAULT_DB_COLUMNS_RESPONSE.tableName,
          schema: (body.schema_name as string) || DEFAULT_DB_COLUMNS_RESPONSE.schema,
        }));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(responseData),
        });
      },
    },

    // 2. /api/db/records/stream
    {
      pattern: "**/api/db/records/stream",
      handler: async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        if (options.recordsStatus && options.recordsStatus !== 200) {
          return route.fulfill({
            status: options.recordsStatus,
            contentType: "application/json",
            body: JSON.stringify({ type: "ERROR", error: "Error en la transmisión de datos" }),
          });
        }
        const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
        const ndjson = resolveOverride(options.recordsStream, body, () => buildNdjsonStream());
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache",
          },
          body: ndjson,
        });
      },
    },

    // 3. /api/db/execute
    {
      pattern: "**/api/db/execute",
      handler: async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
        const resp = resolveOverride(options.execute, body, DEFAULT_EXECUTE_RESPONSE);
        await route.fulfill({
          status: options.executeStatus || 200,
          contentType: "application/json",
          body: JSON.stringify(resp),
        });
      },
    },

    // 4. /api/db/test
    {
      pattern: "**/api/db/test",
      handler: async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
        const resp = resolveOverride(options.testDb, body, DEFAULT_TEST_RESPONSE);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(resp),
        });
      },
    },

    // 5. /api/m/cartography-watcher/sources/remove
    {
      pattern: "**/api/m/cartography-watcher/sources/remove",
      handler: async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const body = (route.request().postDataJSON() || {}) as { sourceId?: string };
        if (body.sourceId) {
          currentSources = currentSources.filter((sourceItem) => sourceItem.id !== body.sourceId);
        }
        const resp = resolveOverride(options.watcherRemove, body, () => ({
          success: true,
          sources: currentSources,
        }));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(resp),
        });
      },
    },

    // 6. /api/m/cartography-watcher/sources/update
    {
      pattern: "**/api/m/cartography-watcher/sources/update",
      handler: async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
        if (options.watcherUpdate) {
          const result =
            typeof options.watcherUpdate === "function"
              ? options.watcherUpdate(body)
              : options.watcherUpdate;
          return route.fulfill({
            status: result.status ?? 200,
            contentType: "application/json",
            body: JSON.stringify(result.body ?? result),
          });
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, sources: currentSources }),
        });
      },
    },

    // 7. /api/m/cartography-watcher/sources
    {
      pattern: "**/api/m/cartography-watcher/sources",
      handler: async (route) => {
        if (route.request().method() === "POST") {
          const body = (route.request().postDataJSON() || {}) as { url?: string };
          const rawUrl = body.url || "nueva-fuente";
          const slug = rawUrl.includes("/dataset/")
            ? rawUrl.split("/dataset/")[1].replace(/\/.*$/, "")
            : rawUrl.replace(/^https?:\/\/[^/]+\//, "");
          const newSource: WatchedSourceFixture = {
            id: `src-added-${Date.now()}`,
            title: `Fuente ${slug}`,
            portalHost: "catalogodatos.gub.uy",
            datasetSlug: slug,
            description: "Fuente agregada dinámicamente",
            isDefault: false,
          };
          currentSources = [...currentSources, newSource];
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              success: true,
              sources: currentSources,
            }),
          });
        }
        const list = resolveOverride(options.watcherSources, route.request(), currentSources);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, sources: list }),
        });
      },
    },

    // 8. /api/m/cartography-watcher/summaries
    {
      pattern: "**/api/m/cartography-watcher/summaries",
      handler: async (route) => {
        const summaries = resolveOverride(
          options.watcherSummaries,
          route.request(),
          DEFAULT_SOURCE_SUMMARIES
        );
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, summaries }),
        });
      },
    },

    // 9. /api/m/cartography-watcher/catalog/file
    {
      pattern: "**/api/m/cartography-watcher/catalog/file**",
      handler: async (route) => {
        const url = new URL(route.request().url());
        const fileData = resolveOverride(options.watcherCatalogFile, url, {
          content: SAMPLE_CATALOG_FILE_CSV,
          contentType: "text/csv; charset=utf-8",
        });
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": fileData.contentType || "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="parcelas_montevideo.csv"',
          },
          body: fileData.content,
        });
      },
    },

    // 10. /api/m/cartography-watcher/catalog (registered after /catalog/file so it matches first and falls back on /catalog/file)
    {
      pattern: "**/api/m/cartography-watcher/catalog**",
      handler: async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.includes("/catalog/file")) {
          return route.fallback();
        }
        const formatFilter = url.searchParams.get("format");
        const defaultGroups =
          formatFilter && formatFilter !== "ALL"
            ? DEFAULT_CATALOG_GROUPS.map((group) => ({
                ...group,
                resources: group.resources.filter(
                  (res) => res.format.toUpperCase() === formatFilter.toUpperCase()
                ),
              }))
            : DEFAULT_CATALOG_GROUPS;
        const groups = resolveOverride(options.watcherCatalog, url, defaultGroups);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, groups }),
        });
      },
    },
  ];

  for (const { pattern, handler } of routes) {
    await page.route(pattern, handler);
  }
}
