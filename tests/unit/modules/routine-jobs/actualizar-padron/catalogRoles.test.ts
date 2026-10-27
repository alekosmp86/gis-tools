import { describe, it, expect, vi } from "vitest";
import {
  createRoutineJobsHandlers,
  type RoutineJobsHandlerDeps,
} from "@/modules/routine-jobs/api/handlers";
import {
  LOCALITY_REQUIRED_COLUMNS,
  PADRON_REQUIRED_COLUMNS,
  PROVINCE_REQUIRED_COLUMNS,
  STAGING_REQUIRED_COLUMNS,
  WORK_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/actualizar-padron/constants";

const PASSWORD = "Ac7ual!zar-pw";
const BASE_URL = "http://localhost/api/modules/routine-jobs";
const GEOMETRY_TYPE = "geometry(MultiPolygon,32721)";
const GEOMETRY_COLUMNS: readonly string[] = ["geom", "geometry"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

interface CatalogColumn {
  column_name: string;
  data_type: string;
}

const columnRowsFor = (names: readonly string[]): CatalogColumn[] =>
  names.map((name) => ({
    column_name: name,
    data_type: GEOMETRY_COLUMNS.includes(name) ? GEOMETRY_TYPE : "text",
  }));

const columnsBody = (role: unknown, extra: Body = {}): Body => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  schema: "cat",
  table: "padron_trabajo",
  role,
  ...extra,
});

const jsonRequest = (path: string, body: unknown): Request =>
  new Request(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function createCatalogHarness(columns: CatalogColumn[]) {
  const session = {
    close: vi.fn(async () => undefined),
    query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(async (sql) => {
      if (/a\.attname/.test(sql)) {
        return { rows: columns.map((column) => ({ ...column, is_nullable: true, column_default: null })) };
      }
      return { rows: [{ schema_name: "cat" }] };
    }),
  };
  const openCatalogSession = vi.fn<RoutineJobsHandlerDeps["openCatalogSession"]>(async () => session);
  const handlers = createRoutineJobsHandlers({ openCatalogSession });
  return { handlers, session, openCatalogSession };
}

describe("catalog columns for the actualizar-padron roles (AP-1, AP-2, AP-4)", () => {
  it.each([
    ["actualizar-staging", STAGING_REQUIRED_COLUMNS],
    ["actualizar-temp", WORK_REQUIRED_COLUMNS],
    ["actualizar-padron", PADRON_REQUIRED_COLUMNS],
    ["actualizar-provincia", PROVINCE_REQUIRED_COLUMNS],
    ["actualizar-localidad", LOCALITY_REQUIRED_COLUMNS],
  ])(
    "should answer 200 with the resolved job constants columns of the %s role",
    async (role, required) => {
      const harness = createCatalogHarness(columnRowsFor(required));

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", columnsBody(role)));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.columns.map((column: { logical: string }) => column.logical)).toEqual([...required]);
      expect(body.columns.every((column: { status: string }) => column.status === "resolved")).toBe(true);
    }
  );

  it("should report a required column of the work role that the table lacks as missing", async () => {
    const present = WORK_REQUIRED_COLUMNS.filter((name) => name !== "number");
    const harness = createCatalogHarness(columnRowsFor(present));

    const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", columnsBody("actualizar-temp")));

    const body = await response.json();
    const number = body.columns.find((column: { logical: string }) => column.logical === "number");
    expect(number.status).toBe("missing");
  });

  it("should take the required columns of the work role from the job, ignoring a list sent in the request", async () => {
    const harness = createCatalogHarness(columnRowsFor(WORK_REQUIRED_COLUMNS));
    const body = columnsBody("actualizar-temp", { required: ["evil_column"], columns: ["evil_column"] });

    const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", body));

    const parsed = await response.json();
    expect(parsed.columns.map((column: { logical: string }) => column.logical)).toEqual([...WORK_REQUIRED_COLUMNS]);
    expect(JSON.stringify(parsed)).not.toContain("evil_column");
  });

  it("should query the catalog with the schema and table sent for an actualizar role", async () => {
    const harness = createCatalogHarness(columnRowsFor(STAGING_REQUIRED_COLUMNS));

    await harness.handlers.listColumns(
      jsonRequest("catalog/columns", columnsBody("actualizar-staging", { schema: "stg", table: "padron_stg" }))
    );

    const catalogCalls = harness.session.query.mock.calls.filter((call) => /a\.attname/.test(call[0]));
    expect(catalogCalls.length).toBeGreaterThan(0);
    expect(catalogCalls[0][1]).toEqual(expect.arrayContaining(["stg", "padron_stg"]));
  });

  it("should answer 400 in Spanish for an unknown actualizar role and never open the catalog", async () => {
    const harness = createCatalogHarness([]);

    const response = await harness.handlers.listColumns(
      jsonRequest("catalog/columns", columnsBody("actualizar-otro"))
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/\b(el|debe|es)\b/i);
    expect(harness.openCatalogSession).not.toHaveBeenCalled();
  });
});
