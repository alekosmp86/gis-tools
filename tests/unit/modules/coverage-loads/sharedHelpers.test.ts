import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SafeDbConfig, SavedDbProfile } from "@/core/types/db";
import {
  connectionKey,
  connectionProfileName,
  findConnectionProfile,
  toConnectionConfig,
  toConnectionProfiles,
} from "@/modules/coverage-loads/shared/connectionProfiles";
import { failure, HTTP_STATUS, jsonResponse, toErrorResponse } from "@/modules/coverage-loads/shared/httpResponses";
import {
  parseJsonRecord,
  readConnection,
  readConnectionFields,
  readConnectionFromForm,
  readJsonBody,
  readText,
} from "@/modules/coverage-loads/shared/requestReaders";
import { runInTransaction, type TransactionSettings } from "@/modules/coverage-loads/shared/runInTransaction";
import { downloadBlob } from "@/modules/coverage-loads/shared/ui/downloadBlob";
import { createPgClient, type PgClientLike } from "@/modules/coverage-loads/shared/pgClient";

describe("requestReaders (AC-22, AC-29)", () => {
  describe("readText", () => {
    it("should trim strings and turn anything else into an empty string", () => {
      // Arrange, Act & Assert
      expect(readText("  a ")).toBe("a");
      expect(readText(5)).toBe("");
      expect(readText(null)).toBe("");
      expect(readText(undefined)).toBe("");
    });
  });

  describe("parseJsonRecord", () => {
    it("should parse an object and refuse everything else", () => {
      // Arrange, Act & Assert
      expect(parseJsonRecord('{"a":1}')).toEqual({ a: 1 });
      expect(parseJsonRecord("[1]")).toBeNull();
      expect(parseJsonRecord("null")).toBeNull();
      expect(parseJsonRecord("3")).toBeNull();
      expect(parseJsonRecord("{broken")).toBeNull();
    });
  });

  describe("readJsonBody", () => {
    it("should read a JSON object body and return null for an invalid or non-object body", async () => {
      // Arrange
      const make = (body: string) => new Request("http://x/", { method: "POST", body });

      // Act & Assert
      expect(await readJsonBody(make('{"kind":"x"}'))).toEqual({ kind: "x" });
      expect(await readJsonBody(make("[]"))).toBeNull();
      expect(await readJsonBody(make("nope"))).toBeNull();
    });
  });

  describe("readConnectionFields", () => {
    it("should trim text fields, keep the password exactly as typed and convert the port to a number", () => {
      // Arrange
      const raw = { host: " db ", port: "5433", db_name: " carto ", user: " me ", password: "  pw  " };

      // Act
      const result = readConnectionFields(raw);

      // Assert
      expect(result).toEqual({ ok: true, value: { host: "db", port: 5433, db_name: "carto", user: "me", password: "  pw  " } });
    });

    it.each([
      ["a blank host", { host: "  ", port: "5432" }],
      ["a missing host", { port: "5432" }],
    ])("should default the host for %s", (_label, extra) => {
      // Arrange
      const raw = { ...extra, db_name: "d", user: "u", password: "p" };

      // Act
      const result = readConnectionFields(raw);

      // Assert
      expect(result.ok && result.value.host).toBe("localhost");
    });

    it.each(["abc", "0", "", undefined, null])("should default the port when it is %j", (port) => {
      // Arrange
      const raw = { db_name: "d", user: "u", password: "p", port };

      // Act
      const result = readConnectionFields(raw);

      // Assert
      expect(result.ok && result.value.port).toBe(5432);
    });

    it.each([
      ["null", null],
      ["an array", []],
      ["a string", "x"],
      ["undefined", undefined],
    ])("should fail with the required-fields message for %s", (_label, raw) => {
      // Arrange, Act & Assert
      expect(readConnectionFields(raw)).toEqual({ ok: false, error: "El nombre de la base de datos y el usuario son obligatorios." });
    });

    it("should fail when the password is not a string or is empty", () => {
      // Arrange
      const base = { db_name: "d", user: "u" };

      // Act & Assert
      expect(readConnectionFields({ ...base, password: 5 })).toEqual({ ok: false, error: "La contraseña es obligatoria." });
      expect(readConnectionFields({ ...base, password: "" })).toEqual({ ok: false, error: "La contraseña es obligatoria." });
    });
  });

  describe("readConnection / readConnectionFromForm", () => {
    it("should read the connection from a JSON body", () => {
      // Arrange & Act
      const result = readConnection({ connection: { db_name: "d", user: "u", password: "p" } });

      // Assert
      expect(result.ok).toBe(true);
    });

    it("should read the connection from a multipart JSON field and reject a file or text that is not an object", () => {
      // Arrange
      const good = new FormData();
      good.append("connection", JSON.stringify({ db_name: "d", user: "u", password: "p" }));
      const asFile = new FormData();
      asFile.append("connection", new File(["{}"], "c.json"));
      const bad = new FormData();
      bad.append("connection", "[]");

      // Act & Assert
      expect(readConnectionFromForm(good, "connection").ok).toBe(true);
      expect(readConnectionFromForm(asFile, "connection")).toEqual({ ok: false, error: "Los datos de conexión no son válidos." });
      expect(readConnectionFromForm(bad, "connection")).toEqual({ ok: false, error: "Los datos de conexión no son válidos." });
      expect(readConnectionFromForm(new FormData(), "connection").ok).toBe(false);
    });
  });
});

describe("httpResponses (AC-22)", () => {
  it("should build a JSON response with the given status, 200 by default", async () => {
    // Arrange & Act
    const ok = jsonResponse({ a: 1 });
    const conflict = jsonResponse({ a: 1 }, HTTP_STATUS.CONFLICT);

    // Assert
    expect(ok.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect(await ok.json()).toEqual({ a: 1 });
  });

  it("should build a failure body with the message and any extra fields", async () => {
    // Arrange & Act
    const response = failure("mal", HTTP_STATUS.BAD_REQUEST, { plan: { x: 1 } });

    // Assert
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "mal", plan: { x: 1 } });
  });

  describe("toErrorResponse", () => {
    it("should scrub every occurrence of the secret and answer 500 by default", async () => {
      // Arrange & Act
      const response = toErrorResponse(new Error("a secret b secret"), "secret", "fallback");

      // Assert
      expect(response.status).toBe(500);
      expect((await response.json()).error).toBe("a *** b ***");
    });

    it("should leave the message alone when the secret is empty", async () => {
      // Arrange & Act
      const response = toErrorResponse(new Error("sin cambios"), "", "fallback");

      // Assert
      expect((await response.json()).error).toBe("sin cambios");
    });

    it("should use the fallback message for a non-Error and honour a given status", async () => {
      // Arrange & Act
      const response = toErrorResponse("raw", "secret", "fallback", HTTP_STATUS.BAD_REQUEST);

      // Assert
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("fallback");
    });

    const LOCK_MESSAGE = "Otra carga está en curso, intente de nuevo en unos segundos.";
    const TIMEOUT_MESSAGE = "La operación excedió el tiempo máximo.";

    function dbError(code: unknown, message = "canceling statement"): Error {
      return Object.assign(new Error(message), { code });
    }

    it("should map the lock_timeout SQLSTATE 55P03 to 409 with the Spanish lock message", async () => {
      // Arrange & Act
      const response = toErrorResponse(dbError("55P03", "canceling statement due to lock timeout"), "secret", "fallback");

      // Assert
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ success: false, error: LOCK_MESSAGE });
    });

    it("should map the statement_timeout SQLSTATE 57014 to 504 with the Spanish timeout message", async () => {
      // Arrange & Act
      const response = toErrorResponse(dbError("57014"), "secret", "fallback");

      // Assert
      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ success: false, error: TIMEOUT_MESSAGE });
    });

    it("should ignore the status argument when the error is a mapped timeout", async () => {
      // Arrange & Act
      const response = toErrorResponse(dbError("55P03"), "secret", "fallback", HTTP_STATUS.BAD_REQUEST);

      // Assert
      expect(response.status).toBe(409);
    });

    it("should not echo the password carried by the original message of a mapped error", async () => {
      // Arrange & Act
      const response = toErrorResponse(dbError("55P03", "lock timeout for user x password: hunter2"), "hunter2", "fallback");
      const raw = await response.text();

      // Assert
      expect(raw).not.toContain("hunter2");
      expect(JSON.parse(raw).error).toBe(LOCK_MESSAGE);
    });

    it("should still scrub the secret from a mapped message", async () => {
      // Arrange & Act
      const response = toErrorResponse(dbError("57014"), "tiempo", "fallback");

      // Assert
      expect((await response.json()).error).toBe("La operación excedió el *** máximo.");
    });

    it.each([
      ["an unmapped SQLSTATE", dbError("23505", "duplicate secret")],
      ["a numeric code", dbError(55)],
      ["an empty code", dbError("")],
      ["no code", new Error("duplicate secret")],
    ])("should keep answering 500 with the original scrubbed message for %s", async (_label, error) => {
      // Arrange & Act
      const response = toErrorResponse(error, "secret", "fallback");

      // Assert
      expect(response.status).toBe(500);
      expect((await response.json()).error).toBe(error.message.replace("secret", "***"));
    });

    it.each([
      ["a string", "55P03"],
      ["null", null],
      ["undefined", undefined],
    ])("should answer 500 with the fallback when %s is thrown", async (_label, error) => {
      // Arrange & Act
      const response = toErrorResponse(error, "secret", "fallback");

      // Assert
      expect(response.status).toBe(500);
      expect((await response.json()).error).toBe("fallback");
    });

    it("should map a plain object that carries the code, not only Error instances", async () => {
      // Arrange & Act
      const response = toErrorResponse({ code: "57014" }, "secret", "fallback");

      // Assert
      expect(response.status).toBe(504);
    });
  });
});

describe("connectionProfiles (AC-28, AC-29)", () => {
  const CONFIG: SafeDbConfig = {
    host: "db.local",
    port: "5432",
    db_name: "carto",
    user: "reader",
    schema_name: "bdj_carto",
    table_name: "ide_direccion",
  };

  function profile(id: string, updatedAt: number, overrides: Partial<SafeDbConfig> = {}): SavedDbProfile {
    return { id, name: `profile ${id}`, config: { ...CONFIG, ...overrides }, updatedAt };
  }

  it("should key a connection by host, port, database and user only, trimmed", () => {
    // Arrange, Act & Assert
    expect(connectionKey({ ...CONFIG, host: " db.local " })).toBe("db.local|5432|carto|reader");
    const otherSchema: SafeDbConfig = { ...CONFIG, schema_name: "x" };
    expect(connectionKey(otherSchema)).toBe(connectionKey(CONFIG));
  });

  it("should tolerate missing connection fields when keying and naming", () => {
    // Arrange
    const sparse = { db_name: "carto" } as unknown as SafeDbConfig;

    // Act & Assert
    expect(connectionKey(sparse)).toBe("||carto|");
    expect(connectionProfileName(sparse)).toBe("carto");
    expect(connectionProfileName({} as SafeDbConfig)).toBe("");
  });

  it("should name a profile after the database, address and user", () => {
    // Arrange, Act & Assert
    expect(connectionProfileName(CONFIG)).toBe("carto @ db.local:5432 (reader)");
    expect(connectionProfileName({ ...CONFIG, host: "", port: "", user: "" })).toBe("carto");
  });

  it("should blank the schema and table of a connection config", () => {
    // Arrange, Act & Assert
    expect(toConnectionConfig(CONFIG)).toMatchObject({ schema_name: "", table_name: "" });
  });

  it("should keep one profile per distinct connection, newest first, and skip those without a database", () => {
    // Arrange
    const profiles = [
      profile("old", 1),
      profile("new", 3, { table_name: "otra" }),
      profile("other", 2, { db_name: "dev" }),
      profile("nodb", 4, { db_name: " " }),
    ];

    // Act
    const result = toConnectionProfiles(profiles);

    // Assert
    expect(result.map((item) => item.id)).toEqual(["new", "other"]);
    expect(result[0].config.table_name).toBe("");
    expect(result[0].name).toBe("carto @ db.local:5432 (reader)");
  });

  it("should skip a profile whose database name is missing altogether", () => {
    // Arrange
    const broken = { id: "x", name: "x", updatedAt: 1, config: { host: "h" } } as unknown as SavedDbProfile;

    // Act & Assert
    expect(toConnectionProfiles([broken])).toEqual([]);
  });

  it("should find the profile of a connection regardless of schema and table", () => {
    // Arrange
    const profiles = toConnectionProfiles([profile("a", 1)]);

    // Act & Assert
    const otherTable: SafeDbConfig = { ...CONFIG, table_name: "zzz" };
    expect(findConnectionProfile(profiles, otherTable)?.id).toBe("a");
    expect(findConnectionProfile(profiles, { ...CONFIG, user: "other" })).toBeUndefined();
  });
});

describe("runInTransaction (AC-10)", () => {
  const SETTINGS: TransactionSettings = { begin: "BEGIN X", settings: ["SET LOCAL a = 1"] };

  function fakeClient(failOn?: string) {
    const statements: string[] = [];
    let ended = 0;
    const client: PgClientLike = {
      async connect() {},
      async query(text) {
        statements.push(text);
        if (failOn && text === failOn) throw new Error(`boom on ${text}`);
        return { rows: [] };
      },
      async end() {
        ended += 1;
      },
      on() {
        return client;
      },
    };
    return { client, statements, ended: () => ended };
  }

  it("should begin, apply the settings, run the work, commit and close", async () => {
    // Arrange
    const { client, statements, ended } = fakeClient();

    // Act
    const result = await runInTransaction(client, SETTINGS, true, async () => "listo");

    // Assert
    expect(result).toBe("listo");
    expect(statements).toEqual(["BEGIN X", "SET LOCAL a = 1", "COMMIT"]);
    expect(ended()).toBe(1);
  });

  it("should roll back instead of committing when asked not to commit", async () => {
    // Arrange
    const { client, statements } = fakeClient();

    // Act
    await runInTransaction(client, SETTINGS, false, async () => 1);

    // Assert
    expect(statements).toEqual(["BEGIN X", "SET LOCAL a = 1", "ROLLBACK"]);
  });

  it("should roll back and rethrow when the work fails", async () => {
    // Arrange
    const { client, statements, ended } = fakeClient();

    // Act
    const attempt = runInTransaction(client, SETTINGS, true, async () => {
      throw new Error("falló");
    });

    // Assert
    await expect(attempt).rejects.toThrow("falló");
    expect(statements).toEqual(["BEGIN X", "SET LOCAL a = 1", "ROLLBACK"]);
    expect(ended()).toBe(1);
  });

  it("should roll back and rethrow when the commit itself fails, and still close", async () => {
    // Arrange
    const { client, statements, ended } = fakeClient("COMMIT");

    // Act
    const attempt = runInTransaction(client, SETTINGS, true, async () => 1);

    // Assert
    await expect(attempt).rejects.toThrow("boom on COMMIT");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(ended()).toBe(1);
  });

  it("should not roll back when BEGIN itself fails, and still close", async () => {
    // Arrange
    const { client, statements, ended } = fakeClient("BEGIN X");

    // Act
    const attempt = runInTransaction(client, SETTINGS, true, async () => 1);

    // Assert
    await expect(attempt).rejects.toThrow("boom on BEGIN X");
    expect(statements).toEqual(["BEGIN X"]);
    expect(ended()).toBe(1);
  });

  it("should surface the original error even when the rollback and the close also fail", async () => {
    // Arrange
    const client: PgClientLike = {
      async connect() {},
      async query(text) {
        if (text === "ROLLBACK") throw new Error("rollback roto");
        return { rows: [] };
      },
      async end() {
        throw new Error("end roto");
      },
      on() {
        return client;
      },
    };

    // Act
    const attempt = runInTransaction(client, SETTINGS, true, async () => {
      throw new Error("original");
    });

    // Assert
    await expect(attempt).rejects.toThrow("original");
  });

  it("should install an error listener so a dropped connection is not an uncaught exception", async () => {
    // Arrange
    const listeners: Array<{ event: string; listener: (error: Error) => void }> = [];
    const client: PgClientLike = {
      async connect() {},
      async query() {
        return { rows: [] };
      },
      async end() {},
      on(event, listener) {
        listeners.push({ event, listener });
        return client;
      },
    };

    // Act
    await runInTransaction(client, SETTINGS, true, async () => 1);

    // Assert
    expect(listeners.map((entry) => entry.event)).toEqual(["error"]);
    expect(() => listeners[0].listener(new Error("connection terminated"))).not.toThrow();
  });

  it("should not touch the database when connecting fails", async () => {
    // Arrange
    const queries: string[] = [];
    const client: PgClientLike = {
      async connect() {
        throw new Error("ECONNREFUSED");
      },
      async query(text) {
        queries.push(text);
        return { rows: [] };
      },
      async end() {},
      on() {
        return client;
      },
    };

    // Act
    const attempt = runInTransaction(client, SETTINGS, true, async () => 1);

    // Assert
    await expect(attempt).rejects.toThrow("ECONNREFUSED");
    expect(queries).toEqual([]);
  });
});

describe("downloadBlob", () => {
  const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const appendChild = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    anchor.click.mockReset();
    anchor.remove.mockReset();
    appendChild.mockReset();
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor), body: { appendChild } });
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("should click a temporary link to the blob with the given file name and remove it", () => {
    // Arrange
    const blob = new Blob(["x"]);

    // Act
    downloadBlob(blob, "reporte.csv");

    // Assert
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe("blob:fake");
    expect(anchor.download).toBe("reporte.csv");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
  });

  it("should release the object URL only after the revoke delay", () => {
    // Arrange
    downloadBlob(new Blob(["x"]), "reporte.csv");

    // Act & Assert
    vi.advanceTimersByTime(999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });
});

describe("createPgClient", () => {
  it("should build a driver client from the connection without opening a connection", () => {
    // Arrange
    const connection = { host: "db.example", port: 5432, db_name: "carto", user: "operator", password: "pw" };

    // Act
    const client = createPgClient(connection);

    // Assert
    expect(typeof client.connect).toBe("function");
    expect(typeof client.query).toBe("function");
    expect(typeof client.end).toBe("function");
    expect(typeof client.on).toBe("function");
  });
});
