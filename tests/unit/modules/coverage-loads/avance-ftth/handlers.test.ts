import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AvanceFileKind,
  MAX_BODY_BYTES,
  MAX_FILE_BYTES,
  REPORT_COLUMNS,
  REPORT_KINDS,
  ReportKind,
} from "@/modules/coverage-loads/avance-ftth/constants";
import { createAvanceFtthHandlers } from "@/modules/coverage-loads/avance-ftth/api/handlers";
import { buildReportText } from "@/modules/coverage-loads/avance-ftth/domain/reportFiles";
import { buildPlan, LoadRefusedError } from "@/modules/coverage-loads/avance-ftth/domain/plan";
import type { AvanceFtthRepository, LoadRequest } from "@/modules/coverage-loads/avance-ftth/services/AvanceFtthRepository";
import type { AvanceDbState, AvanceLoadResult, ReportData } from "@/modules/coverage-loads/avance-ftth/types";
import type { DbConnection } from "@/modules/coverage-loads/types";
import { fixtureBytes } from "./avanceHarness";

const PASSWORD = "hunter2-very-secret";
const BASE_URL = "http://localhost/api/m/coverage-loads/avance-ftth";
const RUN_DAY = new Date(2026, 9, 9, 12, 0, 0);
const CONNECTION_FIELDS = { host: "db.example", port: "5433", db_name: "carto", user: "operator", password: PASSWORD };
const INT_NAME = "SituacionFTTH_INT_21092026.csv";
const UDPEM_NAME = "SituacionFTTH_UDPEM_21092026.csv";

const HEALTHY_STATE: AvanceDbState = {
  staging: {
    [AvanceFileKind.INT]: { rows: 0, fechaact: null },
    [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
  },
  avance: { rows: 0, oldestLoad: null, newestLoad: null, loadedToday: false },
  historyRows: 0,
  zoneRows: 100,
  zoneStatuses: [{ status: "Existente", count: 100 }],
  avanceByStatus: [],
  shortfalls: [],
};

function loadResult(request: LoadRequest): AvanceLoadResult {
  return {
    dryRun: request.dryRun,
    files: request.files.map((file) => ({
      kind: file.kind,
      fileName: file.fileName,
      rowsLoaded: file.rows.length,
      junkDeleted: file.junkRows,
      avanceInserted: 1,
      unmatchedKeys: 0,
    })),
    history: { copied: 0, skipped: false, reason: null },
    avanceInserted: request.files.length,
    byStatus: [],
    reports: [],
    elapsedMs: 3,
    warnings: [],
    rejectedRows: [],
    rejectedTotal: 0,
  };
}

class FakeRepository implements AvanceFtthRepository {
  public state: AvanceDbState = HEALTHY_STATE;
  public failure: unknown = null;
  public loadFailure: unknown = null;
  public reportData: ReportData[] | null = null;
  public readonly inspected: DbConnection[] = [];
  public readonly loads: Array<{ connection: DbConnection; request: LoadRequest }> = [];
  public readonly reportRequests: Array<{ connection: DbConnection; kinds: ReadonlyArray<ReportKind> }> = [];

  async inspect(connection: DbConnection): Promise<AvanceDbState> {
    this.inspected.push(connection);
    if (this.failure !== null) throw this.failure;
    return this.state;
  }

  async load(connection: DbConnection, request: LoadRequest): Promise<AvanceLoadResult> {
    this.loads.push({ connection, request });
    if (this.loadFailure !== null) throw this.loadFailure;
    return loadResult(request);
  }

  async readReports(connection: DbConnection, kinds: ReadonlyArray<ReportKind>): Promise<ReportData[]> {
    this.reportRequests.push({ connection, kinds });
    if (this.failure !== null) throw this.failure;
    return this.reportData ?? kinds.map((kind) => ({ kind, rows: [], error: null }));
  }
}

interface UploadSpec {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const INT_FILE: UploadSpec = { name: INT_NAME, bytes: fixtureBytes(INT_NAME) };
const UDPEM_FILE: UploadSpec = { name: UDPEM_NAME, bytes: fixtureBytes(UDPEM_NAME) };

const CONTENT_LENGTH_HEADER = "content-length";
/** What a browser or proxy declares for a small upload; the handlers read the header, not the real stream. */
const DECLARED_UPLOAD_BYTES = "2048";

interface FormSpec {
  readonly connection?: unknown;
  readonly files?: ReadonlyArray<UploadSpec>;
  readonly confirm?: string;
  readonly dryRun?: string;
  readonly rawFileEntries?: ReadonlyArray<string>;
  /** The declared Content-Length; `null` sends no such header at all. */
  readonly contentLength?: string | null;
}

function uploadRequest(path: string, spec: FormSpec = {}): Request {
  const form = new FormData();
  const connection = spec.connection === undefined ? CONNECTION_FIELDS : spec.connection;
  if (connection !== null) form.append("connection", typeof connection === "string" ? connection : JSON.stringify(connection));
  for (const file of spec.files ?? [INT_FILE, UDPEM_FILE]) {
    form.append("files", new File([file.bytes as BlobPart], file.name, { type: "text/csv" }));
  }
  for (const entry of spec.rawFileEntries ?? []) form.append("files", entry);
  if (spec.confirm !== undefined) form.append("confirm", spec.confirm);
  if (spec.dryRun !== undefined) form.append("dryRun", spec.dryRun);
  const contentLength = spec.contentLength === undefined ? DECLARED_UPLOAD_BYTES : spec.contentLength;
  const headers: Record<string, string> = contentLength === null ? {} : { [CONTENT_LENGTH_HEADER]: contentLength };
  return new Request(`${BASE_URL}/${path}`, { method: "POST", headers, body: form });
}

function jsonRequest(path: string, body: unknown): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [CONTENT_LENGTH_HEADER]: String(new TextEncoder().encode(text).length) },
    body: text,
  });
}

function setup() {
  const repository = new FakeRepository();
  const handlers = createAvanceFtthHandlers({ repository, now: () => RUN_DAY });
  return { repository, handlers };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("avance-ftth handlers", () => {
  describe("plan (AC-7, AC-8, AC-11)", () => {
    it("should answer 200 with the plan of both files and write nothing", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.plan(uploadRequest("plan"));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.plan.canLoad).toBe(true);
      expect(payload.plan.files).toHaveLength(2);
      expect(payload.plan.files[0]).toMatchObject({ kind: "INT", rowsRead: 19, validRows: 19, junkRows: 4, duplicateKeys: 1 });
      expect(payload.plan.files[1]).toMatchObject({ kind: "UDPEM", rowsRead: 13, validRows: 13, junkRows: 3, duplicateKeys: 1 });
      expect(repository.loads).toEqual([]);
      expect(repository.reportRequests).toEqual([]);
    });

    it("should hand the repository the normalised connection and ask it only to inspect", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      await handlers.plan(uploadRequest("plan"));

      // Assert
      expect(repository.inspected).toEqual([{ host: "db.example", port: 5433, db_name: "carto", user: "operator", password: PASSWORD }]);
    });

    it("should never send the parsed rows back to the browser", async () => {
      // Arrange
      const { handlers } = setup();

      // Act
      const raw = await (await handlers.plan(uploadRequest("plan"))).text();

      // Assert
      expect(raw).not.toContain("SORMRCDS01");
    });

    it("should answer 200 with canLoad false and the file error when a name is invalid", async () => {
      // Arrange
      const { handlers } = setup();
      const files = [INT_FILE, { name: "SituacionFTTH_UDPEM_31022026.csv", bytes: UDPEM_FILE.bytes }];

      // Act
      const payload = await (await handlers.plan(uploadRequest("plan", { files }))).json();

      // Assert
      expect(payload.plan.canLoad).toBe(false);
      expect(payload.plan.fileErrors.map((error: { fileName: string }) => error.fileName)).toContain("SituacionFTTH_UDPEM_31022026.csv");
      expect(payload.plan.files).toHaveLength(1);
    });

    it("should refuse a pair of two files of the same kind", async () => {
      // Arrange
      const { handlers } = setup();
      const files = [INT_FILE, { name: "SituacionFTTH_INT_22092026.csv", bytes: INT_FILE.bytes }];

      // Act
      const payload = await (await handlers.plan(uploadRequest("plan", { files }))).json();

      // Assert
      expect(payload.plan.canLoad).toBe(false);
      expect(payload.plan.files).toEqual([]);
      expect(payload.plan.fileErrors).toHaveLength(3);
    });

    it("should list rejected rows with their file and line", async () => {
      // Arrange
      const { handlers } = setup();
      const bad = new TextEncoder().encode("h\nsolo;dos\n");
      const files = [{ name: INT_NAME, bytes: bad }, UDPEM_FILE];

      // Act
      const payload = await (await handlers.plan(uploadRequest("plan", { files }))).json();

      // Assert
      expect(payload.plan.files[0].rejectedRows).toEqual([
        { file: INT_NAME, line: 2, text: "solo;dos", reason: "Se esperaban 10 columnas y hay 2." },
      ]);
      expect(payload.plan.canLoad).toBe(false);
    });

    it("should report a file over the size limit as a file error without parsing it", async () => {
      // Arrange
      const { handlers } = setup();
      const huge = { name: INT_NAME, bytes: new Uint8Array(MAX_FILE_BYTES + 1).fill(0x41) };

      // Act
      const payload = await (await handlers.plan(uploadRequest("plan", { files: [huge, UDPEM_FILE] }))).json();

      // Assert
      expect(payload.plan.fileErrors[0].message).toBe(`El archivo "${INT_NAME}" supera el tamaño máximo de ${MAX_FILE_BYTES} bytes.`);
    });

    it("should plan a file of exactly the size limit", async () => {
      // Arrange
      const { handlers } = setup();
      const atLimit = { name: INT_NAME, bytes: new Uint8Array(MAX_FILE_BYTES).fill(0x41) };

      // Act
      const payload = await (await handlers.plan(uploadRequest("plan", { files: [atLimit, UDPEM_FILE] }))).json();

      // Assert
      expect(payload.plan.fileErrors).toEqual([]);
    });
  });

  describe("validation (AC-25, AC-26)", () => {
    it.each(["plan", "load"] as const)("should answer 400 when the %s request is not multipart", async (endpoint) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers[endpoint](jsonRequest(endpoint, { connection: CONNECTION_FIELDS }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(payload).toEqual({ success: false, error: "La solicitud debe ser un formulario multipart válido." });
      expect(repository.inspected).toEqual([]);
      expect(repository.loads).toEqual([]);
    });

    it.each([
      ["none", []],
      ["one", [INT_FILE]],
      ["three", [INT_FILE, UDPEM_FILE, { name: "SituacionFTTH_INT_22092026.csv", bytes: INT_FILE.bytes }]],
    ])("should answer 400 when %s file(s) are sent instead of two", async (_label, files) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.plan(uploadRequest("plan", { files }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(payload.error).toBe("Hay que subir exactamente 2 archivos: uno de Interior y uno de Montevideo (UDPEM).");
      expect(repository.inspected).toEqual([]);
    });

    it("should answer 400 when the files field holds text instead of a file", async () => {
      // Arrange
      const { handlers } = setup();

      // Act
      const response = await handlers.plan(uploadRequest("plan", { files: [INT_FILE], rawFileEntries: ["no soy un archivo"] }));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("El campo de archivos solo admite archivos.");
    });

    it.each([
      ["missing", null],
      ["not JSON", "{no es json"],
      ["a JSON array", "[1,2]"],
      ["without db_name", { ...CONNECTION_FIELDS, db_name: "  " }],
      ["without user", { ...CONNECTION_FIELDS, user: "" }],
      ["without password", { ...CONNECTION_FIELDS, password: "" }],
    ])("should answer 400 when the connection is %s", async (_label, connection) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.plan(uploadRequest("plan", { connection }));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).success).toBe(false);
      expect(repository.inspected).toEqual([]);
    });

    it("should default the host and port when the connection omits them", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      await handlers.plan(uploadRequest("plan", { connection: { db_name: "carto", user: "u", password: "p" } }));

      // Assert
      expect(repository.inspected[0]).toMatchObject({ host: "localhost", port: 5432 });
    });

    it.each(["plan", "load"] as const)("should answer 413 for %s before reading the form when Content-Length is over the cap", async (endpoint) => {
      // Arrange
      const { repository, handlers } = setup();
      const request = uploadRequest(endpoint, { confirm: "true" });
      const oversize = new Request(request.url, {
        method: "POST",
        headers: { "content-length": String(MAX_BODY_BYTES + 1) },
        body: await request.clone().arrayBuffer(),
      });
      const formSpy = vi.spyOn(oversize, "formData");

      // Act
      const response = await handlers[endpoint](oversize);
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(413);
      expect(payload.error).toBe(`La solicitud supera el tamaño máximo de ${MAX_BODY_BYTES} bytes.`);
      expect(formSpy).not.toHaveBeenCalled();
      expect(repository.inspected).toEqual([]);
    });

    it.each(["plan", "load"] as const)("should answer 411 for %s before reading the form when there is no Content-Length header", async (endpoint) => {
      // Arrange
      const { repository, handlers } = setup();
      const request = uploadRequest(endpoint, { confirm: "true", contentLength: null });
      const formSpy = vi.spyOn(request, "formData");

      // Act
      const response = await handlers[endpoint](request);
      const payload = await response.json();

      // Assert
      expect(request.headers.has(CONTENT_LENGTH_HEADER)).toBe(false);
      expect(response.status).toBe(411);
      expect(payload).toEqual({ success: false, error: "La solicitud debe declarar su tamaño (encabezado Content-Length)." });
      expect(formSpy).not.toHaveBeenCalled();
      expect(repository.inspected).toEqual([]);
      expect(repository.loads).toEqual([]);
    });

    it.each(["plan", "load"] as const)("should behave as before for %s when a valid Content-Length is declared", async (endpoint) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers[endpoint](uploadRequest(endpoint, { confirm: "true", contentLength: "2048" }));

      // Assert
      expect(response.status).toBe(200);
      expect(repository.inspected).toHaveLength(1);
    });

    it("should not require Content-Length on the JSON reports endpoint", async () => {
      // Arrange
      const { handlers } = setup();
      const request = new Request(`${BASE_URL}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection: CONNECTION_FIELDS, kind: ReportKind.DUPLICADO }),
      });

      // Act
      const response = await handlers.reports(request);

      // Assert
      expect(request.headers.has(CONTENT_LENGTH_HEADER)).toBe(false);
      expect(response.status).toBe(200);
    });

    it("should not answer 413 when Content-Length equals the cap or is not a number", async () => {
      // Arrange
      const { handlers } = setup();
      const withHeader = (value: string) =>
        new Request(`${BASE_URL}/plan`, { method: "POST", headers: { "content-length": value, "content-type": "text/plain" }, body: "x" });

      // Act
      const atCap = await handlers.plan(withHeader(String(MAX_BODY_BYTES)));
      const garbage = await handlers.plan(withHeader("abc"));

      // Assert
      expect(atCap.status).toBe(400);
      expect(garbage.status).toBe(400);
    });

    it("should size the body cap as two files plus overhead", () => {
      // Arrange & Act & Assert
      expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
      expect(MAX_BODY_BYTES).toBeGreaterThan(2 * MAX_FILE_BYTES);
    });
  });

  describe("load (AC-11, AC-19)", () => {
    it("should answer 400 and write nothing when the load is not confirmed", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.load(uploadRequest("load"));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(payload).toEqual({ success: false, error: "Hay que confirmar la carga para reemplazar el Avance." });
      expect(repository.loads).toEqual([]);
    });

    it.each(["false", "yes", "TRUE", "1", ""])("should treat confirm=%j as not confirmed", async (value) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: value }));

      // Assert
      expect(response.status).toBe(400);
      expect(repository.loads).toEqual([]);
    });

    it("should write and answer 200 with the result when confirmed, passing the parsed files and dryRun false", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.result.dryRun).toBe(false);
      expect(repository.loads).toHaveLength(1);
      const { connection, request } = repository.loads[0];
      expect(connection.password).toBe(PASSWORD);
      expect(request.dryRun).toBe(false);
      expect(request.files.map((file) => [file.kind, file.rows.length])).toEqual([["INT", 19], ["UDPEM", 13]]);
    });

    it("should run a dry run without confirm and call the write path with the flag", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.load(uploadRequest("load", { dryRun: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(payload.result.dryRun).toBe(true);
      expect(repository.loads[0].request.dryRun).toBe(true);
    });

    it.each(["false", "1", "TRUE"])("should treat dryRun=%j as a real load that still needs confirmation", async (value) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.load(uploadRequest("load", { dryRun: value }));

      // Assert
      expect(response.status).toBe(400);
      expect(repository.loads).toEqual([]);
    });

    it("should answer 409 with the plan and call no write when a file has an error", async () => {
      // Arrange
      const { repository, handlers } = setup();
      const files = [INT_FILE, { name: "malo.csv", bytes: UDPEM_FILE.bytes }];

      // Act
      const response = await handlers.load(uploadRequest("load", { files, confirm: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(409);
      expect(payload.success).toBe(false);
      expect(payload.error).toContain('"malo.csv"');
      expect(payload.plan.canLoad).toBe(false);
      expect(repository.loads).toEqual([]);
    });

    it("should answer 409 for a dry run with blockers too, and never call the write path", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.state = { ...HEALTHY_STATE, zoneRows: 0, zoneStatuses: [] };

      // Act
      const response = await handlers.load(uploadRequest("load", { dryRun: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(409);
      expect(payload.plan.blockers).toHaveLength(1);
      expect(payload.error).toContain("está vacía");
      expect(repository.loads).toEqual([]);
    });

    it("should answer 409 with the plan when a privilege is missing", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.state = {
        ...HEALTHY_STATE,
        shortfalls: [{ table: "public.avance_uruguay_planilla", tableExists: true, missing: ["TRUNCATE"] }],
      };

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(409);
      expect(payload.error).toContain("Faltan privilegios sobre public.avance_uruguay_planilla: TRUNCATE.");
      expect(payload.plan.privilegeShortfalls).toHaveLength(1);
      expect(repository.loads).toEqual([]);
    });

    it("should answer 409 with the refusal plan when the repository refuses inside the transaction", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.loadFailure = new LoadRefusedError("cambió la base", buildPlan([], [{ fileName: "x.csv", message: "cambió" }], HEALTHY_STATE));

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(409);
      expect(payload.error).toBe("cambió la base");
      expect(payload.plan.fileErrors).toEqual([{ fileName: "x.csv", message: "cambió" }]);
    });

    it("should warn but still load when only warnings apply (never an extra checkbox)", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.state = {
        ...HEALTHY_STATE,
        staging: {
          [AvanceFileKind.INT]: { rows: 9999, fechaact: "21092026" },
          [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
        },
      };

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true" }));

      // Assert
      expect(response.status).toBe(200);
      expect(repository.loads).toHaveLength(1);
    });
  });

  describe("errors scrub the password (AC-25)", () => {
    it.each(["plan", "load"] as const)("should answer 500 without the password in the %s body", async (endpoint) => {
      // Arrange
      const { repository, handlers } = setup();
      repository.failure = new Error(`password authentication failed for user "operator" (password: ${PASSWORD})`);

      // Act
      const response = await handlers[endpoint](uploadRequest(endpoint, { confirm: "true" }));
      const raw = await response.text();

      // Assert
      expect(response.status).toBe(500);
      expect(raw).not.toContain(PASSWORD);
      expect(JSON.parse(raw).error).toContain("password: ***");
    });

    it("should scrub every occurrence from a failing load", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.loadFailure = new Error(`${PASSWORD} ${PASSWORD}`);

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true" }));

      // Assert
      expect(response.status).toBe(500);
      expect((await response.json()).error).toBe("*** ***");
    });

    it("should fall back to a Spanish message when something other than an Error is thrown", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.failure = "texto suelto";

      // Act
      const plan = await handlers.plan(uploadRequest("plan"));
      const reports = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS }));

      // Assert
      expect((await plan.json()).error).toBe("No se pudo preparar el plan de carga.");
      expect((await reports.json()).error).toBe("No se pudo generar el reporte.");
    });

    it("should map the lock and statement timeouts of the database without echoing the password", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.loadFailure = Object.assign(new Error(`canceling ${PASSWORD}`), { code: "57014" });

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true" }));
      const raw = await response.text();

      // Assert
      expect(response.status).toBe(504);
      expect(raw).not.toContain(PASSWORD);
    });

    it("should never write the credentials to the console", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.failure = new Error(`boom ${PASSWORD}`);
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined)
      );

      // Act
      await handlers.plan(uploadRequest("plan"));
      await handlers.load(uploadRequest("load", { confirm: "true" }));
      await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS }));

      // Assert
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD);
    });
  });

  describe("reports (AC-21 .. AC-23)", () => {
    const sampleRows = (kind: ReportKind): ReportData => ({
      kind,
      rows: [REPORT_COLUMNS[kind].map((column) => `${column.name} ñ`)],
      error: null,
    });

    it.each([
      [ReportKind.DUPLICADO, "reporte_avance_duplicado_planilla_obras_20261009.txt"],
      [ReportKind.ERROR_ESTADOS, "reporte_avance_error_estados_modificados_20261009.txt"],
      [ReportKind.EN_PLANILLA_NO_EN_SIGRA, "reporte_avance_zonas_en_planilla_no_en_SIGRA_20261009.txt"],
      [ReportKind.EN_SIGRA_NO_EN_PLANILLA, "reporte_avance_zonas_en_SIGRA_no_en_planilla_20261009.txt"],
      [ReportKind.FUERA_CENTRAL, "reporte_avance_ZONAS_FTTH_fuera_central_20261009.txt"],
    ])("should answer the %s report as one attachment named with the injected run day", async (kind, fileName) => {
      // Arrange
      const { repository, handlers } = setup();
      repository.reportData = [sampleRows(kind)];

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind }));
      const body = new Uint8Array(await response.arrayBuffer());

      // Assert
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/plain; charset=iso-8859-1");
      expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${fileName}"`);
      expect(response.headers.get("Content-Length")).toBe(String(body.length));
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(Array.from(body)).toEqual(Array.from(buildReportText(kind, sampleRows(kind).rows ?? [])));
      expect(repository.reportRequests).toEqual([{ connection: expect.objectContaining({ db_name: "carto" }), kinds: [kind] }]);
    });

    it("should answer the zip of all five reports when no kind is asked", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS }));
      const body = new Uint8Array(await response.arrayBuffer());

      // Assert
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/zip");
      expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="AvanceFTTH_Reportes20261009.zip"');
      expect(response.headers.get("Content-Length")).toBe(String(body.length));
      expect(Array.from(body.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
      expect(repository.reportRequests[0].kinds).toEqual(REPORT_KINDS);
    });

    it("should treat an explicit null kind like no kind", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: null }));

      // Assert
      expect(response.headers.get("Content-Type")).toBe("application/zip");
      expect(repository.reportRequests[0].kinds).toEqual(REPORT_KINDS);
    });

    it("should answer a header-only file when the report has no rows", async () => {
      // Arrange
      const { handlers } = setup();

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: ReportKind.EN_PLANILLA_NO_EN_SIGRA }));
      const text = Buffer.from(await response.arrayBuffer()).toString("latin1");

      // Assert
      expect(text).toBe("edificio;cable;zona;conca;etiqueta\n");
    });

    it.each([
      ["an unknown kind", { connection: CONNECTION_FIELDS, kind: "todos" }],
      ["a numeric kind", { connection: CONNECTION_FIELDS, kind: 1 }],
      ["a kind with other case", { connection: CONNECTION_FIELDS, kind: "zonas_en_sigra_no_en_planilla" }],
    ])("should answer 400 for %s", async (_label, body) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.reports(jsonRequest("reports", body));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("El tipo de reporte no es válido.");
      expect(repository.reportRequests).toEqual([]);
    });

    it.each([
      ["malformed JSON", "{no json"],
      ["a JSON array", "[]"],
      ["a JSON scalar", "42"],
      ["an empty body", ""],
    ])("should answer 400 for %s", async (_label, body) => {
      // Arrange
      const { handlers } = setup();

      // Act
      const response = await handlers.reports(jsonRequest("reports", body));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("El cuerpo de la solicitud debe ser un JSON válido.");
    });

    it.each([
      ["a missing connection", {}],
      ["a missing password", { connection: { ...CONNECTION_FIELDS, password: "" } }],
    ])("should answer 400 for %s", async (_label, body) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.reports(jsonRequest("reports", body));

      // Assert
      expect(response.status).toBe(400);
      expect(repository.reportRequests).toEqual([]);
    });

    it("should fail the request, naming the report, when any asked report failed (never a half-made zip)", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.reportData = [
        { kind: ReportKind.DUPLICADO, rows: [], error: null },
        { kind: ReportKind.FUERA_CENTRAL, rows: null, error: `timeout ${PASSWORD}` },
      ];

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS }));
      const raw = await response.text();

      // Assert
      expect(response.status).toBe(500);
      expect(raw).not.toContain(PASSWORD);
      expect(JSON.parse(raw).error).toBe('No se pudo generar el reporte. "Zonas FTTH fuera de la central": timeout ***');
    });

    it("should be independent of any load: it only reads the reports", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: ReportKind.DUPLICADO }));

      // Assert
      expect(repository.loads).toEqual([]);
      expect(repository.inspected).toEqual([]);
    });

    it("should name the file with the real clock when none is injected", async () => {
      // Arrange
      const repository = new FakeRepository();
      const handlers = createAvanceFtthHandlers({ repository });

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: ReportKind.DUPLICADO }));

      // Assert
      expect(response.headers.get("Content-Disposition")).toMatch(
        /^attachment; filename="reporte_avance_duplicado_planilla_obras_\d{8}\.txt"$/
      );
    });
  });

  describe("assembly (AC-24)", () => {
    it("should build the three handlers when no dependency is injected", () => {
      // Arrange & Act
      const handlers = createAvanceFtthHandlers();

      // Assert
      expect(Object.keys(handlers).sort()).toEqual(["load", "plan", "reports"]);
      for (const handler of Object.values(handlers)) expect(typeof handler).toBe("function");
    });
  });
});
