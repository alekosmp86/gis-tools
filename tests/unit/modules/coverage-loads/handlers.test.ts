import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoverageLoadsHandlers } from "@/modules/coverage-loads/api/handlers";
import { ReportKind } from "@/modules/coverage-loads/indicators/constants";
import { createIndicatorsHandlers } from "@/modules/coverage-loads/indicators/api/handlers";
import { readUploads } from "@/modules/coverage-loads/indicators/api/uploadReaders";
import { buildLoadResult } from "@/modules/coverage-loads/indicators/domain/loadResult";
import { LoadRefusedError, buildPlan } from "@/modules/coverage-loads/indicators/domain/plan";
import type { HistoryState } from "@/modules/coverage-loads/indicators/domain/plan";
import type {
  IndicatorsRepository,
  LoadRequest,
} from "@/modules/coverage-loads/indicators/services/IndicatorsRepository";
import type { LoadResult, ParsedCut, ReportRow } from "@/modules/coverage-loads/indicators/types";
import type { DbConnection } from "@/modules/coverage-loads/types";
import { csvBytes, latin1Bytes, validDataLines } from "./csvBuilders";

const PASSWORD = "hunter2-very-secret";
const BASE_URL = "http://localhost/api/m/coverage-loads/indicators";
const RUN_DAY = new Date(2026, 9, 9, 12, 0, 0);

const CONNECTION_FIELDS = { host: "db.example", port: "5433", db_name: "carto", user: "operator", password: PASSWORD };

class FakeRepository implements IndicatorsRepository {
  public history: HistoryState = { existingRowsByDate: {}, shortfalls: [] };
  public reportRows: ReportRow[] = [];
  public failure: unknown = null;
  public loadFailure: unknown = null;
  public readonly inspected: Array<{ connection: DbConnection; fechaacts: ReadonlyArray<string> }> = [];
  public readonly loads: Array<{ connection: DbConnection; request: LoadRequest }> = [];
  public readonly reportRequests: Array<{ connection: DbConnection; kind: ReportKind }> = [];

  async inspectHistory(connection: DbConnection, fechaacts: ReadonlyArray<string>): Promise<HistoryState> {
    this.inspected.push({ connection, fechaacts });
    if (this.failure !== null) throw this.failure;
    return this.history;
  }

  async loadCuts(connection: DbConnection, request: LoadRequest): Promise<LoadResult> {
    this.loads.push({ connection, request });
    if (this.loadFailure !== null) throw this.loadFailure;
    return buildLoadResult(
      request.cuts,
      request.cuts.map((cut) => ({
        fileName: cut.fileName,
        fechaact: cut.fechaact,
        replacedRows: 0,
        insertedRows: cut.rows.length,
        storedRows: cut.rows.length,
        rejectedRows: cut.rejected.length,
        incomplete: cut.rejected.length > 0,
        incompleteMessage: null,
      }))
    );
  }

  async readReport(connection: DbConnection, kind: ReportKind): Promise<ReportRow[]> {
    this.reportRequests.push({ connection, kind });
    if (this.failure !== null) throw this.failure;
    return this.reportRows;
  }
}

/** Upload endpoints require a declared Content-Length (AC-26, shared reader); a browser always sends one. */
const DECLARED_UPLOAD_BYTES = "2048";

interface UploadSpec {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const GOOD_FILE: UploadSpec = { name: "IndicadoresLTE_20260901.csv", bytes: csvBytes(validDataLines(5)) };

interface FormSpec {
  readonly connection?: unknown;
  readonly files?: ReadonlyArray<UploadSpec>;
  readonly confirm?: string;
  readonly acceptShrink?: string;
  readonly rawFileEntries?: ReadonlyArray<string>;
}

function uploadRequest(path: string, spec: FormSpec = {}): Request {
  const form = new FormData();
  const connection = spec.connection === undefined ? CONNECTION_FIELDS : spec.connection;
  if (connection !== null) form.append("connection", typeof connection === "string" ? connection : JSON.stringify(connection));
  for (const file of spec.files ?? [GOOD_FILE]) {
    form.append("files", new File([file.bytes as BlobPart], file.name, { type: "text/csv" }));
  }
  for (const entry of spec.rawFileEntries ?? []) form.append("files", entry);
  if (spec.confirm !== undefined) form.append("confirm", spec.confirm);
  if (spec.acceptShrink !== undefined) form.append("acceptShrink", spec.acceptShrink);
  return new Request(`${BASE_URL}/${path}`, { method: "POST", headers: { "content-length": DECLARED_UPLOAD_BYTES }, body: form });
}

function jsonRequest(path: string, body: unknown): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "content-length": String(new TextEncoder().encode(text).length) },
    body: text,
  });
}

function setup() {
  const repository = new FakeRepository();
  const handlers = createIndicatorsHandlers({ repository, now: () => RUN_DAY });
  return { repository, handlers };
}

function shrinkingHistory(fechaact: string, existing: number): HistoryState {
  return { existingRowsByDate: { [fechaact]: existing }, shortfalls: [] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("indicators handlers", () => {
  describe("plan (AC-23)", () => {
    it("should answer 200 with the plan and ask the repository only to inspect the history", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.history = shrinkingHistory("2026-09-01", 3);

      // Act
      const response = await handlers.plan(uploadRequest("plan"));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.plan.cuts).toHaveLength(1);
      expect(payload.plan.cuts[0]).toMatchObject({
        fileName: GOOD_FILE.name,
        fechaact: "2026-09-01",
        validRows: 5,
        existingRows: 3,
        shrinks: false,
      });
      expect(payload.plan.canLoad).toBe(true);
      expect(repository.loads).toEqual([]);
    });

    it("should hand the repository the normalised connection and the dates of the valid cuts only", async () => {
      // Arrange
      const { repository, handlers } = setup();
      const files = [GOOD_FILE, { name: "IndicadoresLTE_20260801.csv", bytes: csvBytes(validDataLines(2)) }, { name: "malo.csv", bytes: csvBytes(validDataLines(1)) }];

      // Act
      await handlers.plan(uploadRequest("plan", { files }));

      // Assert
      expect(repository.inspected).toHaveLength(1);
      expect(repository.inspected[0].connection).toEqual({
        host: "db.example",
        port: 5433,
        db_name: "carto",
        user: "operator",
        password: PASSWORD,
      });
      expect(repository.inspected[0].fechaacts).toEqual(["2026-09-01", "2026-08-01"]);
    });

    it("should answer 200 with file errors and canLoad false when a name is invalid", async () => {
      // Arrange
      const { handlers } = setup();

      // Act
      const response = await handlers.plan(uploadRequest("plan", { files: [{ name: "malo.csv", bytes: csvBytes(validDataLines(2)) }] }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(payload.plan.canLoad).toBe(false);
      expect(payload.plan.fileErrors[0].fileName).toBe("malo.csv");
      expect(payload.plan.cuts).toEqual([]);
    });

    it("should reject both files in the plan when two files carry the same date", async () => {
      // Arrange
      const { handlers } = setup();
      const files = [GOOD_FILE, { name: "IndicadoresLTE_20260901.csv", bytes: csvBytes(validDataLines(1)) }];

      // Act
      const payload = await (await handlers.plan(uploadRequest("plan", { files }))).json();

      // Assert
      expect(payload.plan.cuts).toEqual([]);
      expect(payload.plan.fileErrors).toHaveLength(2);
      expect(payload.plan.canLoad).toBe(false);
    });

    it("should plan several files as several cuts", async () => {
      // Arrange
      const { handlers } = setup();
      const files = [GOOD_FILE, { name: "IndicadoresLTE_20260801.csv", bytes: csvBytes(validDataLines(2)) }];

      // Act
      const payload = await (await handlers.plan(uploadRequest("plan", { files }))).json();

      // Assert
      expect(payload.plan.cuts.map((cut: { fechaact: string }) => cut.fechaact)).toEqual(["2026-09-01", "2026-08-01"]);
    });

    it("should flag the incomplete cut and its rejected rows", async () => {
      // Arrange
      const { handlers } = setup();
      const bad = { name: GOOD_FILE.name, bytes: csvBytes([...validDataLines(4), "BAD;ROW;abc;Si"]) };

      // Act
      const payload = await (await handlers.plan(uploadRequest("plan", { files: [bad] }))).json();

      // Assert
      expect(payload.plan.hasIncompleteCut).toBe(true);
      expect(payload.plan.cuts[0].incompleteMessage).toBe("corte 2026-09-01 incompleto: 4 de 5 filas, 1 rechazadas");
      expect(payload.plan.cuts[0].rejectedRows[0]).toMatchObject({ file: GOOD_FILE.name, line: 6, text: "BAD;ROW;abc;Si" });
    });

    it("should decode the uploaded bytes as ISO-8859-1", async () => {
      // Arrange
      const { handlers } = setup();
      const accented = { name: GOOD_FILE.name, bytes: csvBytes(["PAYSANDÚ;ÑANDÚ;10;Si", "BAD;ROW;abc;Si"]) };

      // Act
      const payload = await (await handlers.plan(uploadRequest("plan", { files: [accented] }))).json();

      // Assert: the accented row is valid; only the bad row is listed
      expect(payload.plan.cuts[0].validRows).toBe(1);
      expect(payload.plan.cuts[0].rejectedRows).toHaveLength(1);
    });

    it("should report a file over the size limit as a file error instead of reading it", async () => {
      // Arrange
      const { handlers } = setup();
      const huge = { name: GOOD_FILE.name, bytes: new Uint8Array(10 * 1024 * 1024 + 1).fill(0x41) };

      // Act
      const payload = await (await handlers.plan(uploadRequest("plan", { files: [huge] }))).json();

      // Assert
      expect(payload.plan.fileErrors[0].message).toBe(`El archivo "${GOOD_FILE.name}" supera el tamaño máximo de 10485760 bytes.`);
    });
  });

  describe("validation (AC-22..25)", () => {
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
    });

    it.each(["plan", "load"] as const)("should answer 400 when the %s request has no files", async (endpoint) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers[endpoint](uploadRequest(endpoint, { files: [], confirm: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(payload.error).toBe("Seleccione al menos un archivo.");
      expect(repository.loads).toEqual([]);
    });

    it("should answer 400 when the files field holds text instead of a file", async () => {
      // Arrange
      const { handlers } = setup();

      // Act
      const response = await handlers.plan(uploadRequest("plan", { files: [], rawFileEntries: ["no soy un archivo"] }));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("El campo de archivos solo admite archivos.");
    });

    it("should answer 400 when more files than the limit are sent", async () => {
      // Arrange
      const { handlers } = setup();
      const files = Array.from({ length: 25 }, (_, index) => ({
        name: `IndicadoresLTE_2026${String((index % 12) + 1).padStart(2, "0")}01.csv`,
        bytes: csvBytes(validDataLines(1)),
      }));

      // Act
      const response = await handlers.plan(uploadRequest("plan", { files }));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("Se pueden procesar como máximo 24 archivos por vez.");
    });

    it.each([
      ["missing", null, "Los datos de conexión no son válidos."],
      ["not JSON", "{no es json", "Los datos de conexión no son válidos."],
      ["a JSON array", "[1,2]", "Los datos de conexión no son válidos."],
      ["a JSON string", '"texto"', "Los datos de conexión no son válidos."],
      ["without db_name", { ...CONNECTION_FIELDS, db_name: "  " }, "El nombre de la base de datos y el usuario son obligatorios."],
      ["without user", { ...CONNECTION_FIELDS, user: "" }, "El nombre de la base de datos y el usuario son obligatorios."],
      ["without password", { ...CONNECTION_FIELDS, password: "" }, "La contraseña es obligatoria."],
    ])("should answer 400 when the connection is %s", async (_label, connection, message) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.plan(uploadRequest("plan", { connection }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(payload.error).toBe(message);
      expect(repository.inspected).toEqual([]);
    });

    it("should default the host and port when the connection omits them", async () => {
      // Arrange
      const { repository, handlers } = setup();
      const connection = { db_name: "carto", user: "u", password: "p" };

      // Act
      await handlers.plan(uploadRequest("plan", { connection }));

      // Assert
      expect(repository.inspected[0].connection).toMatchObject({ host: "localhost", port: 5432 });
    });
  });

  describe("load (AC-24)", () => {
    it("should answer 400 and write nothing when the load is not confirmed", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.load(uploadRequest("load"));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(400);
      expect(payload).toEqual({ success: false, error: "Hay que confirmar la carga para escribir en el histórico." });
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

    it("should write the valid cuts and answer 200 with the result when confirmed", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      expect(payload.result.totalInserted).toBe(5);
      expect(repository.loads).toHaveLength(1);
      const { connection, request } = repository.loads[0];
      expect(connection.password).toBe(PASSWORD);
      expect(request.acceptShrink).toBe(false);
      expect((request.cuts as ParsedCut[]).map((cut) => [cut.fechaact, cut.rows.length])).toEqual([["2026-09-01", 5]]);
    });

    it("should answer 409 with the plan and write nothing when a file has an error", async () => {
      // Arrange
      const { repository, handlers } = setup();
      const files = [GOOD_FILE, { name: "malo.csv", bytes: csvBytes(validDataLines(1)) }];

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

    it("should answer 409 with the plan when a privilege is missing", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.history = {
        existingRowsByDate: {},
        shortfalls: [{ table: "historico.h_cobertura_lte_localidad", tableExists: true, missing: ["DELETE"] }],
      };

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(409);
      expect(payload.error).toContain("Faltan privilegios sobre historico.h_cobertura_lte_localidad: DELETE.");
      expect(payload.plan.privilegeShortfalls).toHaveLength(1);
      expect(repository.loads).toEqual([]);
    });

    it("should answer 409 without writing when a cut shrinks and the reduction is not accepted (AC-8)", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.history = shrinkingHistory("2026-09-01", 615);

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(409);
      expect(payload.error).toContain("aceptar explícitamente la reducción");
      expect(payload.plan.requiresAcceptShrink).toBe(true);
      expect(payload.plan.cuts[0]).toMatchObject({ shrinks: true, existingRows: 615 });
      expect(repository.loads).toEqual([]);
    });

    it("should write the cut and pass acceptShrink on when the reduction is accepted", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.history = shrinkingHistory("2026-09-01", 615);

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true", acceptShrink: "true" }));

      // Assert
      expect(response.status).toBe(200);
      expect(repository.loads[0].request.acceptShrink).toBe(true);
    });

    it("should answer 409 with the refusal plan when the repository refuses inside the transaction", async () => {
      // Arrange
      const { repository, handlers } = setup();
      const plan = buildPlan([], [{ fileName: "x.csv", message: "cambió" }], repository.history);
      repository.loadFailure = new LoadRefusedError("cambió", plan);

      // Act
      const response = await handlers.load(uploadRequest("load", { confirm: "true" }));
      const payload = await response.json();

      // Assert
      expect(response.status).toBe(409);
      expect(payload.error).toBe("cambió");
      expect(payload.plan.fileErrors).toEqual([{ fileName: "x.csv", message: "cambió" }]);
    });

    it("should load several files as several cuts in one call", async () => {
      // Arrange
      const { repository, handlers } = setup();
      const files = [GOOD_FILE, { name: "IndicadoresLTE_20260801.csv", bytes: csvBytes(validDataLines(2)) }];

      // Act
      await handlers.load(uploadRequest("load", { files, confirm: "true" }));

      // Assert
      expect(repository.loads).toHaveLength(1);
      expect(repository.loads[0].request.cuts.map((cut) => cut.fechaact)).toEqual(["2026-09-01", "2026-08-01"]);
    });
  });

  describe("errors scrub the password (AC-22)", () => {
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

    it("should scrub every occurrence and answer 500 from a failing load", async () => {
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
      const planResponse = await handlers.plan(uploadRequest("plan"));
      const reportResponse = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: "localidad" }));

      // Assert
      expect(planResponse.status).toBe(500);
      expect((await planResponse.json()).error).toBe("No se pudo preparar el plan de carga.");
      expect(reportResponse.status).toBe(500);
      expect((await reportResponse.json()).error).toBe("No se pudo generar el reporte.");
    });

    it("should never write the credentials to the console", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.failure = new Error(`boom ${PASSWORD}`);
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));

      // Act
      await handlers.plan(uploadRequest("plan"));
      await handlers.load(uploadRequest("load", { confirm: "true" }));
      await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: "novedad" }));

      // Assert
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD);
    });
  });

  describe("database timeouts", () => {
    const LOCK_MESSAGE = "Otra carga está en curso, intente de nuevo en unos segundos.";
    const TIMEOUT_MESSAGE = "La operación excedió el tiempo máximo.";

    function dbError(code: string): Error {
      return Object.assign(new Error(`canceling statement (${code}) password: ${PASSWORD}`), { code });
    }

    type Call = (handlers: ReturnType<typeof setup>["handlers"]) => Response | Promise<Response>;
    const CALLS: ReadonlyArray<readonly [string, "failure" | "loadFailure", Call]> = [
      ["plan", "failure", (handlers) => handlers.plan(uploadRequest("plan"))],
      ["load", "loadFailure", (handlers) => handlers.load(uploadRequest("load", { confirm: "true" }))],
      [
        "reports",
        "failure",
        (handlers) => handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: "localidad" })),
      ],
    ];
    const MAPPED = [
      ["55P03", 409, LOCK_MESSAGE],
      ["57014", 504, TIMEOUT_MESSAGE],
    ] as const;

    describe.each(CALLS)("%s", (_name, field, call) => {
      it.each(MAPPED)("should answer the mapped response for SQLSTATE %s without echoing the password", async (code, status, message) => {
        // Arrange
        const { repository, handlers } = setup();
        repository[field] = dbError(code);

        // Act
        const response = await call(handlers);
        const raw = await response.text();

        // Assert
        expect(response.status).toBe(status);
        expect(JSON.parse(raw)).toEqual({ success: false, error: message });
        expect(raw).not.toContain(PASSWORD);
      });

      it("should keep answering 500 for an unmapped SQLSTATE", async () => {
        // Arrange
        const { repository, handlers } = setup();
        repository[field] = dbError("23505");

        // Act
        const response = await call(handlers);
        const raw = await response.text();

        // Assert
        expect(response.status).toBe(500);
        expect(raw).not.toContain(PASSWORD);
        expect(JSON.parse(raw).error).toContain("password: ***");
      });
    });
  });

  describe("reports (AC-16..21, AC-25)", () => {
    const ROWS: ReportRow[] = [
      { departamento: "PAYSANDÚ", localidad: "ÑANDÚ", porcentajecobertura: "91.30", fecha_novedad: "01-09-2026" },
      { departamento: "ARTIGAS", localidad: "BELLA UNION", porcentajecobertura: "100.00", fecha_novedad: "01-09-2026" },
    ];

    it.each([
      [ReportKind.LOCALIDAD, "reporte_cobertura_lte_localidad__20261009.csv"],
      [ReportKind.MAYOR50, "reporte_cobertura_lte_localidad_mayor50__20261009.csv"],
      [ReportKind.NOVEDAD, "reporte_cobertura_lte_localidad_novedad__20261009.csv"],
    ])("should answer the %s report as an attachment named with the injected run day", async (kind, fileName) => {
      // Arrange
      const { repository, handlers } = setup();
      repository.reportRows = ROWS;

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind }));
      const body = new Uint8Array(await response.arrayBuffer());

      // Assert
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/csv; charset=iso-8859-1");
      expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${fileName}"`);
      expect(response.headers.get("Content-Length")).toBe(String(body.length));
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(repository.reportRequests).toEqual([{ connection: expect.objectContaining({ db_name: "carto" }), kind }]);
    });

    it("should send the localidad CSV as ISO-8859-1 bytes with LF endings and trimmed percentages", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.reportRows = ROWS;

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: "localidad" }));
      const body = new Uint8Array(await response.arrayBuffer());

      // Assert
      const expected = latin1Bytes(
        "departamento;localidad;porcentajecobertura;fecha_novedad\n" +
          "PAYSANDÚ;ÑANDÚ;91.3;01-09-2026\n" +
          "ARTIGAS;BELLA UNION;100;01-09-2026\n"
      );
      expect(Array.from(body)).toEqual(Array.from(expected));
      expect(Number(response.headers.get("Content-Length"))).toBe(expected.length);
    });

    it("should answer a 0-byte attachment when the report has no rows", async () => {
      // Arrange
      const { handlers } = setup();

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: "novedad" }));
      const body = await response.arrayBuffer();

      // Assert
      expect(response.status).toBe(200);
      expect(body.byteLength).toBe(0);
      expect(response.headers.get("Content-Length")).toBe("0");
      expect(response.headers.get("Content-Disposition")).toContain("novedad__20261009.csv");
    });

    it.each([
      ["a missing kind", { connection: CONNECTION_FIELDS }],
      ["an unknown kind", { connection: CONNECTION_FIELDS, kind: "todos" }],
      ["a numeric kind", { connection: CONNECTION_FIELDS, kind: 1 }],
      ["a kind with other case", { connection: CONNECTION_FIELDS, kind: "LOCALIDAD" }],
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
      ["a missing connection", { kind: "localidad" }, "El nombre de la base de datos y el usuario son obligatorios."],
      ["a missing password", { connection: { ...CONNECTION_FIELDS, password: "" }, kind: "localidad" }, "La contraseña es obligatoria."],
    ])("should answer 400 for %s", async (_label, body, message) => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      const response = await handlers.reports(jsonRequest("reports", body));

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe(message);
      expect(repository.reportRequests).toEqual([]);
    });

    it("should answer 500 with the password scrubbed when the query fails", async () => {
      // Arrange
      const { repository, handlers } = setup();
      repository.failure = new Error(`connection to server failed: ${PASSWORD}`);

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: "mayor50" }));
      const raw = await response.text();

      // Assert
      expect(response.status).toBe(500);
      expect(raw).not.toContain(PASSWORD);
    });

    it("should work without a load having run: it only reads", async () => {
      // Arrange
      const { repository, handlers } = setup();

      // Act
      await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: "localidad" }));

      // Assert
      expect(repository.loads).toEqual([]);
      expect(repository.inspected).toEqual([]);
    });

    it("should name the file with the real clock when no clock is injected", async () => {
      // Arrange
      const repository = new FakeRepository();
      const handlers = createIndicatorsHandlers({ repository });

      // Act
      const response = await handlers.reports(jsonRequest("reports", { connection: CONNECTION_FIELDS, kind: "localidad" }));

      // Assert
      expect(response.headers.get("Content-Disposition")).toMatch(
        /^attachment; filename="reporte_cobertura_lte_localidad__\d{8}\.csv"$/
      );
    });
  });

  describe("assembly", () => {
    it("should build the three handlers when no dependency is injected", () => {
      // Arrange & Act
      const handlers = createIndicatorsHandlers();

      // Assert
      expect(Object.keys(handlers).sort()).toEqual(["load", "plan", "reports"]);
      for (const handler of Object.values(handlers)) expect(typeof handler).toBe("function");
    });

    it("should expose the indicators and shp handler sets at module level", () => {
      // Arrange & Act
      const handlers = createCoverageLoadsHandlers({ repository: new FakeRepository() });

      // Assert
      expect(Object.keys(handlers)).toEqual(["indicators", "shp"]);
      expect(typeof handlers.indicators.plan).toBe("function");
      expect(Object.keys(handlers.shp).sort()).toEqual(
        ["cancel", "discard", "jobs", "log", "plan", "start", "status", "upload"]
      );
      for (const handler of Object.values(handlers.shp)) expect(typeof handler).toBe("function");
    });
  });
});

describe("readUploads", () => {
  it("should turn a file that cannot be read into a file error", async () => {
    // Arrange
    const file = new File(["x"], "IndicadoresLTE_20260901.csv");
    Object.defineProperty(file, "arrayBuffer", { value: () => Promise.reject(new Error("disk")) });
    const form = new FormData();
    form.append("files", file);

    // Act
    const result = await readUploads(form);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]).toEqual({
        kind: "ERROR",
        error: { fileName: "IndicadoresLTE_20260901.csv", message: 'No se pudo leer el archivo "IndicadoresLTE_20260901.csv".' },
      });
    }
  });
});
