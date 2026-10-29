import { describe, it, expect, vi } from "vitest";
import {
  createRoutineJobsHandlers,
  type RoutineJobsHandlerDeps,
} from "@/modules/routine-jobs/api/handlers";
import {
  JobState,
  createCargarPadronesJobStore,
  type CargarPadronesJobStore,
} from "@/modules/routine-jobs/jobs/cargar-padrones/services/jobStore";
import {
  RURAL_REQUIRED_COLUMNS,
  TARGET_REQUIRED_COLUMNS,
  URBANO_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/cargar-padrones/constants";
import type { CargarPadronesResult, TypeReport } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import { STEP } from "@/modules/routine-jobs/jobs/cargar-padrones/domain/plannedSteps";
import { AnalyzeStatus } from "@/core/types/replace";

const PASSWORD = "S3cr3t!pw";
const HOUR_MS = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const TABLE_KEY = "db.local:5432|gis|cat|catastro_paispadron";
const CONFLICT_MESSAGE = "Ya hay una carga en curso para esta tabla.";
const GEOMETRY_TYPE = "geometry(MultiPolygon,32721)";
const BASE_URL = "http://localhost/api/modules/routine-jobs";

// Mutable JSON bodies built to be corrupted field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

const typeReport = (): TypeReport => ({
  rowsRead: 10,
  groups: 8,
  rowsMerged: 2,
  repaired: 0,
  insertedInvalid: 0,
  repairedInUnion: 0,
  noGeometry: 0,
  nullKeyRows: 0,
  attributeConflicts: 0,
  attributeConflictSamples: [],
  inserted: 8,
});

const resultFixture = (overrides: Partial<CargarPadronesResult> = {}): CargarPadronesResult => ({
  dryRun: false,
  targetModified: true,
  outcomeUnknown: false,
  report: { rural: typeReport(), urbano: typeReport() },
  totals: { rowsRead: 20, groups: 16, rowsMerged: 4, inserted: 16 },
  ambiguousLocalityCodes: [],
  ambiguousLocalityTotal: 0,
  warnings: [],
  stepTimings: [],
  analyze: { status: AnalyzeStatus.OK },
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const jsonRequest = (path: string, body: unknown): Request =>
  new Request(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const statusRequest = (query: string): Request => new Request(`${BASE_URL}/cargar-padrones/status${query}`);

const connectionBody = (): Body => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "gis_user",
  password: PASSWORD,
});

const tablesBody = (): Body => ({ connection: connectionBody(), schema: "cat" });

const columnsBody = (role = "rural"): Body => ({ connection: connectionBody(), schema: "cat", table: "paisrural", role });

const startBody = (): Body => ({
  connection: connectionBody(),
  schema: "cat",
  ruralTable: "paisrural",
  urbanoTable: "paisurbano",
  targetTable: "catastro_paispadron",
  options: { repair: true, clearMode: "delete", resetSequences: true },
  dryRun: false,
  confirm: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bodyOf(response: Response): Promise<any> {
  return response.json();
}

async function textOf(response: Response): Promise<string> {
  return response.clone().text();
}

const SPANISH_WORD = /\b(el|la|los|las|de|del|debe|no|es|un|una|con|para|en)\b/i;

async function expectSpanishError(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  const body = await bodyOf(response.clone());
  expect(body.success).toBe(false);
  expect(body.error).toBeTypeOf("string");
  expect(body.error.length).toBeGreaterThan(0);
  expect(body.error).toMatch(SPANISH_WORD);
  expect(await textOf(response)).not.toContain(PASSWORD);
}

interface CatalogFixture {
  schemaExists?: boolean;
  tables?: Array<{ name: string; kind: string }>;
  columns?: Array<{ column_name: string; data_type: string }>;
  failOpen?: Error;
  failQuery?: Error;
}

function createCatalogHarness(fixture: CatalogFixture = {}) {
  const session = {
    close: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string, ...rest: unknown[]) => {
      void rest;
      if (fixture.failQuery) throw fixture.failQuery;
      if (/a\.attname/.test(sql)) {
        return {
          rows: (fixture.columns ?? []).map((column) => ({
            column_name: column.column_name,
            data_type: column.data_type,
            is_nullable: true,
            column_default: null,
          })),
        };
      }
      if (/AS kind/.test(sql)) return { rows: fixture.tables ?? [] };
      return { rows: fixture.schemaExists === false ? [] : [{ schema_name: "cat" }] };
    }),
  };
  const openCatalogSession = vi.fn<RoutineJobsHandlerDeps["openCatalogSession"]>(async () => {
    if (fixture.failOpen) throw fixture.failOpen;
    return session;
  });
  const handlers = createRoutineJobsHandlers({ openCatalogSession });
  return { handlers, session, openCatalogSession };
}

const columnRowsFor = (required: readonly string[]) =>
  required.map((logical) => ({ column_name: logical, data_type: logical === "geom" ? GEOMETRY_TYPE : "text" }));

interface CommonCase {
  name: string;
  patch: (body: Body) => void;
}

const connectionCases: CommonCase[] = [
  { name: "connection is missing", patch: (b) => delete b.connection },
  { name: "connection is not an object", patch: (b) => (b.connection = "db.local") },
  { name: "connection is null", patch: (b) => (b.connection = null) },
  { name: "host is missing", patch: (b) => delete b.connection.host },
  { name: "host is not a string", patch: (b) => (b.connection.host = 123) },
  { name: "port is missing", patch: (b) => delete b.connection.port },
  { name: "port is not numeric", patch: (b) => (b.connection.port = "abc") },
  { name: "port is an empty string", patch: (b) => (b.connection.port = "") },
  { name: "port is a boolean", patch: (b) => (b.connection.port = true) },
  { name: "port is null", patch: (b) => (b.connection.port = null) },
  { name: "db_name is missing", patch: (b) => delete b.connection.db_name },
  { name: "db_name is not a string", patch: (b) => (b.connection.db_name = 7) },
  { name: "user is missing", patch: (b) => delete b.connection.user },
  { name: "user is null", patch: (b) => (b.connection.user = null) },
  { name: "password is missing", patch: (b) => delete b.connection.password },
  { name: "password is not a string", patch: (b) => (b.connection.password = 12345) },
  { name: "schema is missing", patch: (b) => delete b.schema },
  { name: "schema is an empty string", patch: (b) => (b.schema = "") },
  { name: "schema is not a string", patch: (b) => (b.schema = 5) },
  { name: "host is an empty string", patch: (b) => (b.connection.host = "") },
  { name: "port is 0", patch: (b) => (b.connection.port = 0) },
  { name: "port is 65536", patch: (b) => (b.connection.port = 65536) },
  { name: 'port is the string "65536"', patch: (b) => (b.connection.port = "65536") },
  { name: "port is fractional (5432.5)", patch: (b) => (b.connection.port = 5432.5) },
  { name: "port is -1", patch: (b) => (b.connection.port = -1) },
  { name: 'port is the string "-1"', patch: (b) => (b.connection.port = "-1") },
  { name: 'port has a leading space (" 5432")', patch: (b) => (b.connection.port = " 5432") },
  { name: "port is a 20-digit string", patch: (b) => (b.connection.port = "99999999999999999999") },
  { name: "user is an empty string", patch: (b) => (b.connection.user = "") },
  { name: "db_name is an empty string", patch: (b) => (b.connection.db_name = "") },
  { name: "schema is whitespace only", patch: (b) => (b.schema = "   ") },
];

const rawBodyCases: Array<[string, string]> = [
  ["the body is not valid JSON", "{not json"],
  ["the body is empty", ""],
  ["the body is a JSON array", "[]"],
  ["the body is JSON null", "null"],
  ["the body is a JSON string", '"hello"'],
];

function mutated(base: () => Body, patch: (body: Body) => void): Body {
  const body = base();
  patch(body);
  return body;
}

describe("createRoutineJobsHandlers", () => {
  describe("listTables (AC-23)", () => {
    it("AC-23: should answer 200 with success, schemaExists and the tables sorted by name", async () => {
      const harness = createCatalogHarness({
        tables: [
          { name: "zeta", kind: "TABLE" },
          { name: "alfa", kind: "VIEW" },
        ],
      });

      const response = await harness.handlers.listTables(jsonRequest("catalog/tables", tablesBody()));

      expect(response.status).toBe(200);
      expect(await bodyOf(response)).toEqual({
        success: true,
        schemaExists: true,
        tables: [
          { name: "alfa", kind: "VIEW" },
          { name: "zeta", kind: "TABLE" },
        ],
      });
    });

    it("AC-23: should answer 200 with schemaExists false and no tables when the schema does not exist", async () => {
      const harness = createCatalogHarness({ schemaExists: false });

      const response = await harness.handlers.listTables(jsonRequest("catalog/tables", tablesBody()));

      expect(response.status).toBe(200);
      expect(await bodyOf(response)).toMatchObject({ success: true, schemaExists: false, tables: [] });
    });

    it("AC-23: should open the catalog session with the request's connection and the schema in the queries", async () => {
      const harness = createCatalogHarness({ tables: [] });

      await harness.handlers.listTables(jsonRequest("catalog/tables", tablesBody()));

      expect(harness.openCatalogSession).toHaveBeenCalledTimes(1);
      expect(harness.openCatalogSession.mock.calls[0][0]).toMatchObject({
        host: "db.local",
        db_name: "gis",
        user: "gis_user",
        password: PASSWORD,
      });
      expect(harness.session.query.mock.calls.every((call) => (call[1] as unknown[]).includes("cat"))).toBe(true);
    });

    it("AC-23: should accept the port as a number", async () => {
      const harness = createCatalogHarness({ tables: [] });
      const body = mutated(tablesBody, (b) => (b.connection.port = 5432));

      const response = await harness.handlers.listTables(jsonRequest("catalog/tables", body));

      expect(response.status).toBe(200);
    });

    it("AC-23: should accept an empty password string (local databases may have none)", async () => {
      const harness = createCatalogHarness({ tables: [] });
      const body = mutated(tablesBody, (b) => (b.connection.password = ""));

      const response = await harness.handlers.listTables(jsonRequest("catalog/tables", body));

      expect(response.status).toBe(200);
      expect(harness.openCatalogSession.mock.calls[0][0]).toMatchObject({ password: "" });
    });

    it("AC-23: should close the session after a successful listing", async () => {
      const harness = createCatalogHarness({ tables: [] });

      await harness.handlers.listTables(jsonRequest("catalog/tables", tablesBody()));

      expect(harness.session.close).toHaveBeenCalledTimes(1);
    });

    it.each(connectionCases)("AC-23: should answer 400 in Spanish and not connect when $name", async ({ patch }) => {
      const harness = createCatalogHarness();

      const response = await harness.handlers.listTables(jsonRequest("catalog/tables", mutated(tablesBody, patch)));

      await expectSpanishError(response, 400);
      expect(harness.openCatalogSession).not.toHaveBeenCalled();
    });

    it.each(rawBodyCases)("AC-23: should answer 400 in Spanish and not connect when %s", async (_name, raw) => {
      const harness = createCatalogHarness();

      const response = await harness.handlers.listTables(jsonRequest("catalog/tables", raw));

      await expectSpanishError(response, 400);
      expect(harness.openCatalogSession).not.toHaveBeenCalled();
    });

    it("AC-23: should answer 500 with a generic Spanish message and no password when opening the session fails", async () => {
      const harness = createCatalogHarness({
        failOpen: new Error(`FATAL: password authentication failed for user "gis_user" (${PASSWORD})`),
      });

      const response = await harness.handlers.listTables(jsonRequest("catalog/tables", tablesBody()));

      await expectSpanishError(response, 500);
      expect(await textOf(response)).not.toContain("authentication");
    });

    it("AC-23: should answer 500 with a generic Spanish message when a query fails, and still close the session", async () => {
      const harness = createCatalogHarness({ failQuery: new Error(`relation broke ${PASSWORD}`) });

      const response = await harness.handlers.listTables(jsonRequest("catalog/tables", tablesBody()));

      await expectSpanishError(response, 500);
      expect(await textOf(response)).not.toContain("relation broke");
      expect(harness.session.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("listColumns (AC-23)", () => {
    it.each([
      ["rural", RURAL_REQUIRED_COLUMNS],
      ["urbano", URBANO_REQUIRED_COLUMNS],
      ["target", TARGET_REQUIRED_COLUMNS],
    ] as const)(
      "AC-23: should answer 200 with the resolved columns of the %s role's required logical columns",
      async (role, required) => {
        const harness = createCatalogHarness({ columns: columnRowsFor(required) });

        const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", columnsBody(role)));

        expect(response.status).toBe(200);
        const body = await bodyOf(response);
        expect(body.success).toBe(true);
        expect(body.columns.map((column: { logical: string }) => column.logical)).toEqual([...required]);
        expect(body.columns.every((column: { status: string }) => column.status === "resolved")).toBe(true);
      }
    );

    it("AC-23: should take the required columns from the role and ignore any list sent in the request", async () => {
      const harness = createCatalogHarness({ columns: columnRowsFor(RURAL_REQUIRED_COLUMNS) });
      const body = { ...columnsBody("rural"), required: ["evil_column"], columns: ["evil_column"] };

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", body));

      const parsed = await bodyOf(response);
      expect(parsed.columns.map((column: { logical: string }) => column.logical)).toEqual([...RURAL_REQUIRED_COLUMNS]);
      expect(JSON.stringify(parsed)).not.toContain("evil_column");
    });

    it("AC-23: should report a required column that the table lacks as missing", async () => {
      const present = RURAL_REQUIRED_COLUMNS.filter((name) => name !== "valreal");
      const harness = createCatalogHarness({ columns: columnRowsFor(present) });

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", columnsBody("rural")));

      const body = await bodyOf(response);
      const valreal = body.columns.find((column: { logical: string }) => column.logical === "valreal");
      expect(valreal.status).toBe("missing");
    });

    it("AC-23: should report an empty table (no columns at all) as every required column missing", async () => {
      const harness = createCatalogHarness({ columns: [] });

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", columnsBody("urbano")));

      const body = await bodyOf(response);
      expect(response.status).toBe(200);
      expect(body.columns).toHaveLength(URBANO_REQUIRED_COLUMNS.length);
      expect(body.columns.every((column: { status: string }) => column.status === "missing")).toBe(true);
    });

    it("AC-23: should resolve a column whose real name differs in case", async () => {
      const rows = columnRowsFor(RURAL_REQUIRED_COLUMNS).map((row) =>
        row.column_name === "nomdepto" ? { ...row, column_name: "NOMDEPTO" } : row
      );
      const harness = createCatalogHarness({ columns: rows });

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", columnsBody("rural")));

      const body = await bodyOf(response);
      const nomdepto = body.columns.find((column: { logical: string }) => column.logical === "nomdepto");
      expect(nomdepto).toMatchObject({ status: "resolved", column: "NOMDEPTO" });
    });

    it("AC-23: should query the catalog for the requested schema and table", async () => {
      const harness = createCatalogHarness({ columns: columnRowsFor(RURAL_REQUIRED_COLUMNS) });

      await harness.handlers.listColumns(jsonRequest("catalog/columns", columnsBody("rural")));

      const values = harness.session.query.mock.calls.map((call) => call[1] as unknown[]);
      expect(values).toContainEqual(["cat", "paisrural"]);
    });

    it("AC-23: should accept an empty password string (local databases may have none)", async () => {
      const harness = createCatalogHarness({ columns: [] });
      const body = mutated(() => columnsBody("rural"), (b) => (b.connection.password = ""));

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", body));

      expect(response.status).toBe(200);
    });

    it("AC-23: should close the session after a successful resolution", async () => {
      const harness = createCatalogHarness({ columns: [] });

      await harness.handlers.listColumns(jsonRequest("catalog/columns", columnsBody("target")));

      expect(harness.session.close).toHaveBeenCalledTimes(1);
    });

    const columnCases: CommonCase[] = [
      ...connectionCases,
      { name: "table is missing", patch: (b) => delete b.table },
      { name: "table is an empty string", patch: (b) => (b.table = "") },
      { name: "table is not a string", patch: (b) => (b.table = 9) },
      { name: "table is whitespace only", patch: (b) => (b.table = "  	 ") },
      { name: "role is missing", patch: (b) => delete b.role },
      { name: "role is unknown", patch: (b) => (b.role = "padron") },
      { name: "role is an empty string", patch: (b) => (b.role = "") },
      { name: "role is not a string", patch: (b) => (b.role = 1) },
    ];

    it.each(columnCases)("AC-23: should answer 400 in Spanish and not connect when $name", async ({ patch }) => {
      const harness = createCatalogHarness();

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", mutated(columnsBody, patch)));

      await expectSpanishError(response, 400);
      expect(harness.openCatalogSession).not.toHaveBeenCalled();
    });

    it.each(rawBodyCases)("AC-23: should answer 400 in Spanish and not connect when %s", async (_name, raw) => {
      const harness = createCatalogHarness();

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", raw));

      await expectSpanishError(response, 400);
      expect(harness.openCatalogSession).not.toHaveBeenCalled();
    });

    it("AC-23: should answer 500 with a generic Spanish message and no password when opening the session fails", async () => {
      const harness = createCatalogHarness({ failOpen: new Error(`could not connect with ${PASSWORD}`) });

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", columnsBody("rural")));

      await expectSpanishError(response, 500);
      expect(await textOf(response)).not.toContain("could not connect");
    });

    it("AC-23: should answer 500 and still close the session when the catalog query fails", async () => {
      const harness = createCatalogHarness({ failQuery: new Error(`catalog down ${PASSWORD}`) });

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", columnsBody("rural")));

      await expectSpanishError(response, 500);
      expect(harness.session.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("startCargarPadrones (AC-24)", () => {
    type RunFn = RoutineJobsHandlerDeps["run"];

    function createStartHarness(runImpl?: RunFn) {
      const store: CargarPadronesJobStore = createCargarPadronesJobStore(() => NOW);
      const tryStart = vi.spyOn(store, "tryStart");
      const progress = vi.spyOn(store, "progress");
      const sweep = vi.spyOn(store, "sweep");
      const run = vi.fn<RunFn>(runImpl ?? (async () => resultFixture()));
      const tracked: Promise<void>[] = [];
      const handlers = createRoutineJobsHandlers({
        store,
        run,
        track: (task) => void tracked.push(task),
        openCatalogSession: vi.fn(),
      });
      const settle = async (): Promise<void> => {
        await Promise.all(tracked);
      };
      const start = (body: unknown = startBody()) => handlers.startCargarPadrones(jsonRequest("cargar-padrones/start", body));
      const status = (jobId: string) => handlers.readCargarPadronesStatus(statusRequest(`?jobId=${encodeURIComponent(jobId)}`));
      return { store, tryStart, progress, sweep, run, handlers, settle, start, status, tracked };
    }

    function gatedRun() {
      const gate = deferred<CargarPadronesResult>();
      const started = deferred<void>();
      const impl: RunFn = async () => {
        started.resolve();
        return gate.promise;
      };
      return { gate, started, impl };
    }

    it("AC-24: should answer 200 with success and a jobId at once, while the run is still pending", async () => {
      const { gate, started, impl } = gatedRun();
      const harness = createStartHarness(impl);

      const response = await harness.start();
      await started.promise;

      expect(response.status).toBe(200);
      const body = await bodyOf(response);
      expect(body.success).toBe(true);
      expect(body.jobId).toBeTypeOf("string");
      expect(harness.store.get(body.jobId)?.state).toBe(JobState.RUNNING);
      gate.resolve(resultFixture());
      await harness.settle();
    });

    it("AC-24: should call run with the parsed params and a progress callback", async () => {
      const harness = createStartHarness();

      await harness.start();
      await harness.settle();

      expect(harness.run).toHaveBeenCalledTimes(1);
      const [params, onProgress] = harness.run.mock.calls[0];
      expect(params).toMatchObject({
        schema: "cat",
        ruralTable: "paisrural",
        urbanoTable: "paisurbano",
        targetTable: "catastro_paispadron",
        options: { repair: true, clearMode: "delete", resetSequences: true },
        dryRun: false,
        confirm: true,
      });
      expect(params.config).toMatchObject({ host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD });
      expect(onProgress).toBeTypeOf("function");
    });

    it("AC-24: should hand run a string port when the request sends the port as a number", async () => {
      const harness = createStartHarness();
      const body = mutated(startBody, (b) => (b.connection.port = 5432));

      await harness.start(body);
      await harness.settle();

      expect(harness.run.mock.calls[0][0].config.port).toBe("5432");
    });

    it("AC-24: should pass the options and flags through as sent", async () => {
      const harness = createStartHarness();
      const body = mutated(startBody, (b) => {
        b.options = { repair: false, clearMode: "truncate", resetSequences: false };
        b.dryRun = true;
        b.confirm = false;
      });

      const response = await harness.start(body);
      await harness.settle();

      expect(response.status).toBe(200);
      expect(harness.run.mock.calls[0][0]).toMatchObject({
        options: { repair: false, clearMode: "truncate", resetSequences: false },
        dryRun: true,
        confirm: false,
      });
    });

    it("AC-24/AC-19: should take the lock with the host:port|db|schema|table key and the dryRun flag", async () => {
      const harness = createStartHarness();

      await harness.start();
      await harness.settle();

      expect(harness.tryStart).toHaveBeenCalledTimes(1);
      expect(harness.tryStart).toHaveBeenCalledWith(TABLE_KEY, false, expect.any(Array));
    });

    it("AC-24/AC-19: should take the lock with dryRun true on a dry run", async () => {
      const harness = createStartHarness();

      await harness.start(mutated(startBody, (b) => (b.dryRun = true)));
      await harness.settle();

      expect(harness.tryStart).toHaveBeenCalledWith(TABLE_KEY, true, expect.any(Array));
    });

    it("AC-24: should feed the store with every progress report of the run", async () => {
      const harness = createStartHarness(async (_params, onProgress) => {
        onProgress({ label: "Conteo de filas", current: 2, total: 10 });
        onProgress({ label: "Carga rural", current: 5, total: 10 });
        return resultFixture();
      });

      const response = await harness.start();
      await harness.settle();

      const { jobId } = await bodyOf(response);
      expect(harness.progress).toHaveBeenCalledWith(jobId, { label: "Conteo de filas", current: 2, total: 10 });
      expect(harness.progress).toHaveBeenCalledWith(jobId, { label: "Carga rural", current: 5, total: 10 });
    });

    it("AC-24/AC-25: should show the reported step on the RUNNING job", async () => {
      const gate = deferred<CargarPadronesResult>();
      const started = deferred<void>();
      const harness = createStartHarness(async (_params, onProgress) => {
        onProgress({ label: "Carga urbana", current: 6, total: 10 });
        started.resolve();
        return gate.promise;
      });

      const response = await harness.start();
      await started.promise;

      const { jobId } = await bodyOf(response);
      expect(harness.store.get(jobId)).toMatchObject({ state: JobState.RUNNING, step: "Carga urbana", current: 6, total: 10 });
      gate.resolve(resultFixture());
      await harness.settle();
    });

    it("AC-24/AC-26: should mark the job DONE with the result when run resolves", async () => {
      const result = resultFixture({ warnings: ["aviso"] });
      const harness = createStartHarness(async () => result);

      const response = await harness.start();
      await harness.settle();

      const { jobId } = await bodyOf(response);
      const snapshot = harness.store.get(jobId);
      expect(snapshot?.state).toBe(JobState.DONE);
      expect(snapshot?.result).toEqual(result);
      expect(snapshot?.finishedAt).toBeTypeOf("number");
    });

    it("AC-25: should keep a result with outcomeUnknown as DONE with that flag, not FAILED", async () => {
      const harness = createStartHarness(async () => resultFixture({ outcomeUnknown: true, targetModified: false }));

      const response = await harness.start();
      await harness.settle();

      const { jobId } = await bodyOf(response);
      expect(harness.store.get(jobId)).toMatchObject({ state: JobState.DONE, outcomeUnknown: true });
    });

    it("AC-24/AC-26: should mark the job FAILED with the message when run rejects", async () => {
      const harness = createStartHarness(async () => {
        throw new Error("No se pudo completar la carga: disco lleno.");
      });

      const response = await harness.start();
      await harness.settle();

      const { jobId } = await bodyOf(response);
      expect(harness.store.get(jobId)).toMatchObject({ state: JobState.FAILED, error: "No se pudo completar la carga: disco lleno." });
    });

    it("AC-24/AC-26: should scrub the password from the error of a failed run", async () => {
      const harness = createStartHarness(async () => {
        throw new Error(`server said password=${PASSWORD} is wrong`);
      });

      const response = await harness.start();
      await harness.settle();

      const { jobId } = await bodyOf(response);
      const snapshot = harness.store.get(jobId);
      expect(snapshot?.state).toBe(JobState.FAILED);
      expect(snapshot?.error).toContain("is wrong");
      expect(JSON.stringify(snapshot)).not.toContain(PASSWORD);
    });

    it("AC-26: should mark the job FAILED, scrubbed, when run rejects with a non-Error value", async () => {
      const harness = createStartHarness(() => Promise.reject(`plain string ${PASSWORD}`));

      const response = await harness.start();
      await harness.settle();

      const { jobId } = await bodyOf(response);
      const snapshot = harness.store.get(jobId);
      expect(snapshot?.state).toBe(JobState.FAILED);
      expect(snapshot?.error).toBeTypeOf("string");
      expect(JSON.stringify(snapshot)).not.toContain(PASSWORD);
    });

    it("AC-26: should mark the job FAILED when run throws synchronously", async () => {
      const harness = createStartHarness(() => {
        throw new Error("sync failure");
      });

      const response = await harness.start();
      await harness.settle();

      const { jobId } = await bodyOf(response);
      expect(harness.store.get(jobId)).toMatchObject({ state: JobState.FAILED, error: "sync failure" });
    });

    it("AC-26: should release the lock when the run fails so a new start works", async () => {
      const harness = createStartHarness(async () => {
        throw new Error("boom");
      });
      await harness.start();
      await harness.settle();
      harness.run.mockImplementation(async () => resultFixture());

      const again = await harness.start();
      await harness.settle();

      expect(again.status).toBe(200);
      expect((await bodyOf(again)).jobId).toBeTypeOf("string");
    });

    it("AC-19/AC-26: should release the lock when the run succeeds so a new start works", async () => {
      const harness = createStartHarness();
      await harness.start();
      await harness.settle();

      const again = await harness.start();
      await harness.settle();

      expect(again.status).toBe(200);
    });

    it("AC-24/AC-19: should answer 409 with the Spanish conflict message while a job is RUNNING for the same target", async () => {
      const { gate, started, impl } = gatedRun();
      const harness = createStartHarness(impl);
      await harness.start();
      await started.promise;

      const second = await harness.start();

      expect(second.status).toBe(409);
      expect(await bodyOf(second)).toEqual({ success: false, error: CONFLICT_MESSAGE });
      expect(harness.run).toHaveBeenCalledTimes(1);
      gate.resolve(resultFixture());
      await harness.settle();
    });

    it("AC-24/AC-19: should answer 409 for the same target even if the source tables differ", async () => {
      const { gate, started, impl } = gatedRun();
      const harness = createStartHarness(impl);
      await harness.start();
      await started.promise;

      const second = await harness.start(
        mutated(startBody, (b) => {
          b.ruralTable = "paisrural_otro";
          b.urbanoTable = "paisurbano_otro";
        })
      );

      expect(second.status).toBe(409);
      gate.resolve(resultFixture());
      await harness.settle();
    });

    it("AC-24/AC-19: should answer 409 when the port is a number and the running job's port was a string", async () => {
      const { gate, started, impl } = gatedRun();
      const harness = createStartHarness(impl);
      await harness.start();
      await started.promise;

      const second = await harness.start(mutated(startBody, (b) => (b.connection.port = 5432)));

      expect(second.status).toBe(409);
      gate.resolve(resultFixture());
      await harness.settle();
    });

    it("AC-24/AC-19: should answer 409 for a dry run while a real run of the same target is RUNNING", async () => {
      const { gate, started, impl } = gatedRun();
      const harness = createStartHarness(impl);
      await harness.start();
      await started.promise;

      const second = await harness.start(mutated(startBody, (b) => (b.dryRun = true)));

      expect(second.status).toBe(409);
      gate.resolve(resultFixture());
      await harness.settle();
    });

    it.each([
      ["target table", (b: Body) => (b.targetTable = "otra_tabla")],
      ["schema", (b: Body) => (b.schema = "otro_schema")],
      ["database", (b: Body) => (b.connection.db_name = "otra_db")],
      ["host", (b: Body) => (b.connection.host = "otro.host")],
      ["port", (b: Body) => (b.connection.port = "5433")],
    ])("AC-24/AC-19: should allow a parallel run when only the %s differs", async (_name, patch) => {
      const { gate, started, impl } = gatedRun();
      const harness = createStartHarness(impl);
      const first = await harness.start();
      await started.promise;

      const second = await harness.start(mutated(startBody, patch));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect((await bodyOf(second)).jobId).not.toBe((await bodyOf(first)).jobId);
      gate.resolve(resultFixture());
      await harness.settle();
    });

    const startCases: CommonCase[] = [
      ...connectionCases,
      { name: "ruralTable is missing", patch: (b) => delete b.ruralTable },
      { name: "ruralTable is empty", patch: (b) => (b.ruralTable = "") },
      { name: "urbanoTable is missing", patch: (b) => delete b.urbanoTable },
      { name: "urbanoTable is not a string", patch: (b) => (b.urbanoTable = 3) },
      { name: "targetTable is missing", patch: (b) => delete b.targetTable },
      { name: "targetTable is empty", patch: (b) => (b.targetTable = "") },
      { name: "options is missing", patch: (b) => delete b.options },
      { name: "options is null", patch: (b) => (b.options = null) },
      { name: "options is not an object", patch: (b) => (b.options = "delete") },
      { name: "options.repair is not a boolean", patch: (b) => (b.options.repair = "yes") },
      { name: "options.repair is missing", patch: (b) => delete b.options.repair },
      { name: "options.clearMode is unknown", patch: (b) => (b.options.clearMode = "cascade") },
      { name: "options.clearMode is missing", patch: (b) => delete b.options.clearMode },
      { name: "options.resetSequences is not a boolean", patch: (b) => (b.options.resetSequences = 1) },
      { name: "options.resetSequences is missing", patch: (b) => delete b.options.resetSequences },
      { name: "dryRun is not a boolean", patch: (b) => (b.dryRun = "true") },
      { name: "confirm is not a boolean", patch: (b) => (b.confirm = "true") },
      { name: "dryRun is missing", patch: (b) => delete b.dryRun },
      { name: "confirm is missing", patch: (b) => delete b.confirm },
      { name: "ruralTable is whitespace only", patch: (b) => (b.ruralTable = "  ") },
      { name: "urbanoTable is whitespace only", patch: (b) => (b.urbanoTable = " ") },
      { name: "targetTable is whitespace only", patch: (b) => (b.targetTable = "	") },
    ];

    it.each(startCases)("AC-24: should answer 400 in Spanish, take no lock and run nothing when $name", async ({ patch }) => {
      const harness = createStartHarness();

      const response = await harness.start(mutated(startBody, patch));
      await harness.settle();

      await expectSpanishError(response, 400);
      expect(harness.tryStart).not.toHaveBeenCalled();
      expect(harness.run).not.toHaveBeenCalled();
    });

    it.each(rawBodyCases)("AC-24: should answer 400 in Spanish, take no lock and run nothing when %s", async (_name, raw) => {
      const harness = createStartHarness();

      const response = await harness.start(raw);

      await expectSpanishError(response, 400);
      expect(harness.tryStart).not.toHaveBeenCalled();
      expect(harness.run).not.toHaveBeenCalled();
    });

    it("AC-24: should accept an empty password string and hand it to run", async () => {
      const harness = createStartHarness();

      const response = await harness.start(mutated(startBody, (b) => (b.connection.password = "")));
      await harness.settle();

      expect(response.status).toBe(200);
      expect(harness.run.mock.calls[0][0].config.password).toBe("");
    });

    it("AC-24: should let a valid start work after an invalid one for the same target (lock not taken)", async () => {
      const harness = createStartHarness();
      const invalid = await harness.start(mutated(startBody, (b) => (b.options.clearMode = "cascade")));

      const valid = await harness.start();
      await harness.settle();

      expect(invalid.status).toBe(400);
      expect(valid.status).toBe(200);
    });

    it("AC-19/AC-24: should reject a real run with confirm false with 400 before taking the lock", async () => {
      const harness = createStartHarness();

      const response = await harness.start(mutated(startBody, (b) => (b.confirm = false)));
      await harness.settle();

      await expectSpanishError(response, 400);
      expect(harness.tryStart).not.toHaveBeenCalled();
      expect(harness.run).not.toHaveBeenCalled();
      const later = await harness.start();
      await harness.settle();
      expect(later.status).toBe(200);
    });

    it("AC-18/AC-19: should accept a dry run with confirm false", async () => {
      const harness = createStartHarness();

      const response = await harness.start(
        mutated(startBody, (b) => {
          b.dryRun = true;
          b.confirm = false;
        })
      );
      await harness.settle();

      expect(response.status).toBe(200);
      expect(harness.run).toHaveBeenCalledTimes(1);
    });

    it("AC-19/AC-24: should accept a dry run with confirm true", async () => {
      const harness = createStartHarness();

      const response = await harness.start(mutated(startBody, (b) => (b.dryRun = true)));
      await harness.settle();

      expect(response.status).toBe(200);
    });

    it("AC-24: should never put the password in the start, conflict or validation responses", async () => {
      const { gate, started, impl } = gatedRun();
      const harness = createStartHarness(impl);

      const ok = await harness.start();
      await started.promise;
      const conflict = await harness.start();
      const invalid = await harness.start(mutated(startBody, (b) => (b.options = null)));

      expect(await textOf(ok)).not.toContain(PASSWORD);
      expect(await textOf(conflict)).not.toContain(PASSWORD);
      expect(await textOf(invalid)).not.toContain(PASSWORD);
      gate.resolve(resultFixture());
      await harness.settle();
    });

    it("AC-24/AC-25: should never keep the password in the stored snapshot, even when the result echoes it", async () => {
      const result = resultFixture({
        warnings: [`conexión con clave ${PASSWORD}`],
        analyze: { status: AnalyzeStatus.FAILED, message: `analyze falló: ${PASSWORD}` },
      });
      const harness = createStartHarness(async () => result);

      const response = await harness.start();
      await harness.settle();

      const { jobId } = await bodyOf(response);
      expect(JSON.stringify(harness.store.get(jobId))).not.toContain(PASSWORD);
    });

    it("AC-25/AC-26: should sweep finished jobs older than one hour on start", async () => {
      const harness = createStartHarness();

      await harness.start();
      await harness.settle();

      expect(harness.sweep).toHaveBeenCalledWith(HOUR_MS);
    });
  });

  describe("readCargarPadronesStatus (AC-25)", () => {
    type RunFn = RoutineJobsHandlerDeps["run"];

    function createStatusHarness(runImpl?: RunFn) {
      const store = createCargarPadronesJobStore(() => NOW);
      const sweep = vi.spyOn(store, "sweep");
      const run = vi.fn<RunFn>(runImpl ?? (async () => resultFixture()));
      const tracked: Promise<void>[] = [];
      const handlers = createRoutineJobsHandlers({
        store,
        run,
        track: (task) => void tracked.push(task),
        openCatalogSession: vi.fn(),
      });
      const start = async (body: unknown = startBody()): Promise<string> => {
        const response = await handlers.startCargarPadrones(jsonRequest("cargar-padrones/start", body));
        return (await response.json()).jobId as string;
      };
      const status = (query: string) => handlers.readCargarPadronesStatus(statusRequest(query));
      const settle = async (): Promise<void> => {
        await Promise.all(tracked);
      };
      return { store, sweep, handlers, start, status, settle };
    }

    it("AC-25: should answer 200 with the RUNNING job shape (step null before any progress)", async () => {
      const gate = deferred<CargarPadronesResult>();
      const started = deferred<void>();
      const harness = createStatusHarness(async () => {
        started.resolve();
        return gate.promise;
      });
      const jobId = await harness.start();
      await started.promise;

      const response = await harness.status(`?jobId=${jobId}`);

      expect(response.status).toBe(200);
      const body = await bodyOf(response);
      expect(body.success).toBe(true);
      expect(body.job).toMatchObject({ jobId, state: "RUNNING", step: null, dryRun: false, startedAt: NOW });
      expect(body.job.finishedAt).toBeUndefined();
      expect(body.job.result).toBeUndefined();
      expect(body.job.error).toBeUndefined();
      gate.resolve(resultFixture());
      await harness.settle();
    });

    it("AC-25: should expose the Spanish step label with current and total", async () => {
      const gate = deferred<CargarPadronesResult>();
      const started = deferred<void>();
      const harness = createStatusHarness(async (_params, onProgress) => {
        onProgress({ label: "Carga rural", current: 5, total: 10 });
        started.resolve();
        return gate.promise;
      });
      const jobId = await harness.start();
      await started.promise;

      const body = await bodyOf(await harness.status(`?jobId=${jobId}`));

      expect(body.job).toMatchObject({ state: "RUNNING", step: "Carga rural", current: 5, total: 10 });
      gate.resolve(resultFixture());
      await harness.settle();
    });

    it("AC-25: should expose the planned steps of the started job in the order they will run", async () => {
      const gate = deferred<CargarPadronesResult>();
      const started = deferred<void>();
      const harness = createStatusHarness(async () => {
        started.resolve();
        return gate.promise;
      });
      const jobId = await harness.start();
      await started.promise;

      const body = await bodyOf(await harness.status(`?jobId=${jobId}`));

      expect(body.job.steps).toEqual([
        STEP.VALIDATE,
        STEP.COUNT,
        STEP.CLEAR,
        STEP.SEQUENCES_RESET,
        STEP.LOAD_RURAL,
        STEP.LOAD_URBANO,
        STEP.REPORT,
        STEP.SEQUENCES_REPAIR,
        STEP.COMMIT,
        STEP.ANALYZE,
      ]);
      gate.resolve(resultFixture());
      await harness.settle();
    });

    it("AC-25: should expose the DONE job with its result and finishedAt", async () => {
      const result = resultFixture({ warnings: ["aviso uno"] });
      const harness = createStatusHarness(async () => result);
      const jobId = await harness.start();
      await harness.settle();

      const body = await bodyOf(await harness.status(`?jobId=${jobId}`));

      expect(body.job).toMatchObject({ jobId, state: "DONE", dryRun: false });
      expect(body.job.result).toEqual(result);
      expect(body.job.finishedAt).toBeTypeOf("number");
    });

    it("AC-25: should expose a dry run flag on the job", async () => {
      const harness = createStatusHarness(async () => resultFixture({ dryRun: true, targetModified: false }));
      const jobId = await harness.start(mutated(startBody, (b) => (b.dryRun = true)));
      await harness.settle();

      const body = await bodyOf(await harness.status(`?jobId=${jobId}`));

      expect(body.job.dryRun).toBe(true);
    });

    it("AC-25: should keep a result with outcomeUnknown as DONE with that flag", async () => {
      const harness = createStatusHarness(async () => resultFixture({ outcomeUnknown: true, targetModified: false }));
      const jobId = await harness.start();
      await harness.settle();

      const body = await bodyOf(await harness.status(`?jobId=${jobId}`));

      expect(body.job.state).toBe("DONE");
      expect(body.job.outcomeUnknown).toBe(true);
    });

    it("AC-25: should expose the FAILED job with the run's Spanish error", async () => {
      const harness = createStatusHarness(async () => {
        throw new Error("No se pudo completar la carga: disco lleno. La tabla destino no fue modificada.");
      });
      const jobId = await harness.start();
      await harness.settle();

      const body = await bodyOf(await harness.status(`?jobId=${jobId}`));

      expect(body.job.state).toBe("FAILED");
      expect(body.job.error).toBe("No se pudo completar la carga: disco lleno. La tabla destino no fue modificada.");
      expect(body.job.result).toBeUndefined();
    });

    it("AC-25: should scrub the password from the error", async () => {
      const harness = createStatusHarness(async () => {
        throw new Error(`falló la autenticación con ${PASSWORD} en el servidor`);
      });
      const jobId = await harness.start();
      await harness.settle();

      const response = await harness.status(`?jobId=${jobId}`);

      const text = await textOf(response);
      expect(text).not.toContain(PASSWORD);
      expect((await bodyOf(response)).job.error).toContain("falló la autenticación");
    });

    it("AC-25: should scrub the password from every field of the result", async () => {
      const harness = createStatusHarness(async () =>
        resultFixture({
          warnings: [`aviso con ${PASSWORD}`],
          analyze: { status: AnalyzeStatus.FAILED, message: `ANALYZE falló ${PASSWORD}` },
          stepTimings: [{ label: `paso ${PASSWORD}`, ms: 1 }],
        })
      );
      const jobId = await harness.start();
      await harness.settle();

      const response = await harness.status(`?jobId=${jobId}`);

      expect(await textOf(response)).not.toContain(PASSWORD);
      const { job } = await bodyOf(response);
      expect(job.result.warnings[0]).toContain("aviso con");
      expect(job.result.analyze.message).toContain("ANALYZE falló");
      expect(job.result.totals).toEqual({ rowsRead: 20, groups: 16, rowsMerged: 4, inserted: 16 });
    });

    it.each([
      ["no query string", ""],
      ["an empty jobId", "?jobId="],
      ["another parameter only", "?id=abc"],
    ])("AC-25: should answer 400 in Spanish when the request has %s", async (_name, query) => {
      const harness = createStatusHarness();

      const response = await harness.status(query);

      await expectSpanishError(response, 400);
    });

    it("AC-25: should answer 404 in Spanish for an unknown job id", async () => {
      const harness = createStatusHarness();

      const response = await harness.status("?jobId=00000000-0000-0000-0000-000000000000");

      await expectSpanishError(response, 404);
    });

    it("AC-25/AC-26: should sweep finished jobs older than one hour on status", async () => {
      const harness = createStatusHarness();
      const jobId = await harness.start();
      await harness.settle();
      harness.sweep.mockClear();

      await harness.status(`?jobId=${jobId}`);

      expect(harness.sweep).toHaveBeenCalledTimes(1);
      expect(harness.sweep).toHaveBeenCalledWith(HOUR_MS);
    });

    it("AC-25/AC-26: should answer 404 for a job that was swept as older than one hour", async () => {
      const clock = { value: NOW };
      const store = createCargarPadronesJobStore(() => clock.value);
      const tracked: Promise<void>[] = [];
      const handlers = createRoutineJobsHandlers({
        store,
        run: async () => resultFixture(),
        track: (task) => void tracked.push(task),
        openCatalogSession: vi.fn(),
      });
      const started = await handlers.startCargarPadrones(jsonRequest("cargar-padrones/start", startBody()));
      const { jobId } = await started.json();
      await Promise.all(tracked);
      clock.value = NOW + HOUR_MS + 1;

      const response = await handlers.readCargarPadronesStatus(statusRequest(`?jobId=${jobId}`));

      expect(response.status).toBe(404);
    });
  });
});

describe("createRoutineJobsHandlers hardening", () => {
  type RunFn = RoutineJobsHandlerDeps["run"];

  function createWiring(options: { store?: CargarPadronesJobStore; run?: RunFn } = {}) {
    const store = options.store ?? createCargarPadronesJobStore(() => NOW);
    const run = vi.fn<RunFn>(options.run ?? (async () => resultFixture()));
    const tracked: Promise<void>[] = [];
    const openCatalogSession = vi.fn<RoutineJobsHandlerDeps["openCatalogSession"]>(async () => ({
      query: async () => ({ rows: [] }),
      close: async () => undefined,
    }));
    const handlers = createRoutineJobsHandlers({
      store,
      run,
      track: (task: Promise<void>) => void tracked.push(task),
      openCatalogSession,
    });
    const tryStart = vi.spyOn(store, "tryStart");
    return {
      store,
      run,
      handlers,
      tryStart,
      openCatalogSession,
      settle: async (): Promise<void> => {
        await Promise.all(tracked);
      },
      start: (body: unknown = startBody()) => handlers.startCargarPadrones(jsonRequest("cargar-padrones/start", body)),
      status: (query: string) => handlers.readCargarPadronesStatus(statusRequest(query)),
    };
  }

  function gated() {
    const gate = deferred<CargarPadronesResult>();
    const started = deferred<void>();
    const run: RunFn = async () => {
      started.resolve();
      return gate.promise;
    };
    return { gate, started, run };
  }

  describe("port bounds", () => {
    const acceptedPorts: Array<[string, number | string]> = [
      ["1", 1],
      ["65535", 65535],
      ['the string "5432"', "5432"],
      ["65535 as a string", "65535"],
    ];

    it.each(acceptedPorts)("AC-23: should accept the port %s on listTables", async (_name, port) => {
      const harness = createCatalogHarness({ tables: [] });
      const body = mutated(tablesBody, (b) => (b.connection.port = port));

      const response = await harness.handlers.listTables(jsonRequest("catalog/tables", body));

      expect(response.status).toBe(200);
    });

    it.each(acceptedPorts)("AC-23: should accept the port %s on listColumns", async (_name, port) => {
      const harness = createCatalogHarness({ columns: [] });
      const body = mutated(() => columnsBody("rural"), (b) => (b.connection.port = port));

      const response = await harness.handlers.listColumns(jsonRequest("catalog/columns", body));

      expect(response.status).toBe(200);
    });

    it.each(acceptedPorts)("AC-24: should accept the port %s on start", async (_name, port) => {
      const wiring = createWiring();

      const response = await wiring.start(mutated(startBody, (b) => (b.connection.port = port)));
      await wiring.settle();

      expect(response.status).toBe(200);
    });
  });

  describe("lock key normalisation", () => {
    it.each([
      ["a different host case", "DB.local"],
      ["surrounding whitespace on the host", " db.local "],
      ["both host case and whitespace", "  DB.Local\t"],
    ])("AC-19/AC-24: should answer 409 for a start that differs only by %s", async (_name, host) => {
      const { gate, started, run } = gated();
      const wiring = createWiring({ run });
      await wiring.start();
      await started.promise;

      const second = await wiring.start(mutated(startBody, (b) => (b.connection.host = host)));

      expect(second.status).toBe(409);
      expect(await bodyOf(second)).toEqual({ success: false, error: CONFLICT_MESSAGE });
      gate.resolve(resultFixture());
      await wiring.settle();
    });

    it("AC-19/AC-24: should keep localhost and 127.0.0.1 as two separate keys (aliases are not resolved)", async () => {
      const { gate, started, run } = gated();
      const wiring = createWiring({ run });
      const first = await wiring.start(mutated(startBody, (b) => (b.connection.host = "localhost")));
      await started.promise;

      const second = await wiring.start(mutated(startBody, (b) => (b.connection.host = "127.0.0.1")));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      gate.resolve(resultFixture());
      await wiring.settle();
    });
  });

  describe("distinct tables at the request layer", () => {
    it.each([
      ["ruralTable equals urbanoTable", (b: Body) => (b.urbanoTable = b.ruralTable)],
      ["targetTable equals ruralTable", (b: Body) => (b.targetTable = b.ruralTable)],
      ["targetTable equals urbanoTable", (b: Body) => (b.targetTable = b.urbanoTable)],
    ])("AC-14b/AC-24: should answer 400 in Spanish before the lock when %s", async (_name, patch) => {
      const wiring = createWiring();

      const response = await wiring.start(mutated(startBody, patch));
      await wiring.settle();

      await expectSpanishError(response, 400);
      const body = await bodyOf(response);
      expect(body.error).toMatch(/distint|diferent/i);
      expect(body.jobId).toBeUndefined();
      expect(wiring.tryStart).not.toHaveBeenCalled();
      expect(wiring.run).not.toHaveBeenCalled();
    });

    it("AC-14b/AC-24: should let a valid start work after a same-table start was refused", async () => {
      const wiring = createWiring();
      await wiring.start(mutated(startBody, (b) => (b.urbanoTable = b.ruralTable)));

      const valid = await wiring.start();
      await wiring.settle();

      expect(valid.status).toBe(200);
      expect(wiring.run).toHaveBeenCalledTimes(1);
    });
  });

  describe("scrubbing of progress", () => {
    it("AC-25: should redact the password in the stored step label and never expose it through status", async () => {
      const { gate, started, run: gatedImpl } = gated();
      const wiring = createWiring({
        run: async (params, onProgress) => {
          onProgress({ label: `Carga ${PASSWORD} rural`, current: 5, total: 10 });
          return gatedImpl(params, onProgress);
        },
      });
      const response = await wiring.start();
      await started.promise;

      const { jobId } = await bodyOf(response);
      const snapshot = wiring.store.get(jobId);
      expect(snapshot?.step).toBeTypeOf("string");
      expect(snapshot?.step).toContain("Carga");
      expect(JSON.stringify(snapshot)).not.toContain(PASSWORD);
      const statusResponse = await wiring.status(`?jobId=${jobId}`);
      expect(statusResponse.status).toBe(200);
      expect(await textOf(statusResponse)).not.toContain(PASSWORD);
      gate.resolve(resultFixture());
      await wiring.settle();
    });
  });

  describe("failing store", () => {
    it("AC-26: should keep the run going and end DONE when store.progress throws", async () => {
      const real = createCargarPadronesJobStore(() => NOW);
      const store: CargarPadronesJobStore = {
        ...real,
        progress: () => {
          throw new Error("progress store exploded");
        },
      };
      const result = resultFixture({ warnings: ["aviso"] });
      const wiring = createWiring({
        store,
        run: async (_params, onProgress) => {
          onProgress({ label: "Carga rural", current: 5, total: 10 });
          onProgress({ label: "Carga urbana", current: 6, total: 10 });
          return result;
        },
      });

      const response = await wiring.start();
      await wiring.settle();

      const { jobId } = await bodyOf(response);
      expect(real.get(jobId)?.state).toBe(JobState.DONE);
      expect(real.get(jobId)?.result).toEqual(result);
    });

    it("AC-26: should end FAILED with a scrubbed message and free the lock when store.finish throws", async () => {
      const real = createCargarPadronesJobStore(() => NOW);
      const store: CargarPadronesJobStore = {
        ...real,
        finish: () => {
          throw new Error(`finish exploded ${PASSWORD}`);
        },
      };
      const wiring = createWiring({ store });

      const response = await wiring.start();
      await wiring.settle();

      const { jobId } = await bodyOf(response);
      const snapshot = real.get(jobId);
      expect(snapshot?.state).toBe(JobState.FAILED);
      expect(snapshot?.error).toContain("finish exploded");
      expect(JSON.stringify(snapshot)).not.toContain(PASSWORD);
      const again = await wiring.start();
      await wiring.settle();
      expect(again.status).toBe(200);
      expect((await bodyOf(again)).jobId).not.toBe(jobId);
    });
  });

  describe("exact messages", () => {
    it("AC-19/AC-24: should answer 400 with the exact confirmation text on a real run without confirm (message not fixed by the spec)", async () => {
      const wiring = createWiring();

      const response = await wiring.start(mutated(startBody, (b) => (b.confirm = false)));

      expect(response.status).toBe(400);
      expect(await bodyOf(response)).toEqual({
        success: false,
        error: "Confirme la carga para escribir en la tabla destino. Sin confirmación solo se permite la simulación.",
      });
    });

    it("AC-23/AC-24: should answer 400 with the exact invalid-JSON text (message not fixed by the spec)", async () => {
      const wiring = createWiring();

      const response = await wiring.start("{not json");

      expect(response.status).toBe(400);
      expect(await bodyOf(response)).toEqual({ success: false, error: "El cuerpo de la petición no es JSON válido." });
    });

    it("AC-24: should answer 409 with the exact conflict text fixed by the spec", async () => {
      const { gate, started, run } = gated();
      const wiring = createWiring({ run });
      await wiring.start();
      await started.promise;

      const response = await wiring.start();

      expect(response.status).toBe(409);
      expect(await bodyOf(response)).toEqual({ success: false, error: "Ya hay una carga en curso para esta tabla." });
      gate.resolve(resultFixture());
      await wiring.settle();
    });

    it("AC-25: should answer 404 with the exact unknown-job text (message not fixed by the spec)", async () => {
      const wiring = createWiring();

      const response = await wiring.status("?jobId=unknown-id");

      expect(response.status).toBe(404);
      expect(await bodyOf(response)).toEqual({ success: false, error: "No existe un trabajo con ese identificador." });
    });

    it("AC-25: should answer 400 with the exact missing-jobId text (message not fixed by the spec)", async () => {
      const wiring = createWiring();

      const response = await wiring.status("");

      expect(response.status).toBe(400);
      expect(await bodyOf(response)).toEqual({ success: false, error: "El parámetro jobId es obligatorio." });
    });
  });
});
