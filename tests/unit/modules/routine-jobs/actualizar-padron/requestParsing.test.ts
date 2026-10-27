import { describe, it, expect } from "vitest";
import { parseActualizarStartRequest } from "@/modules/routine-jobs/api/actualizarRequestParsing";
import { parseColumnsRequest, RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import {
  LOCALITY_REQUIRED_COLUMNS,
  PADRON_REQUIRED_COLUMNS,
  PROVINCE_REQUIRED_COLUMNS,
  STAGING_REQUIRED_COLUMNS,
  WORK_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import {
  RURAL_REQUIRED_COLUMNS,
  TARGET_REQUIRED_COLUMNS,
  URBANO_REQUIRED_COLUMNS,
} from "@/modules/routine-jobs/jobs/cargar-padrones/constants";

const PASSWORD = "Ac7ual!zar-pw";
const SAME_TABLE = "same_table";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

const connectionBody = (): Body => ({
  host: "db.local",
  port: "5432",
  db_name: "gis",
  user: "gis_user",
  password: PASSWORD,
});

const startBody = (): Body => ({
  connection: connectionBody(),
  stagingSchema: "stg",
  stagingTable: "catastro_paispadron_stg",
  workSchema: "cat",
  workTable: "padron_trabajo",
  padronTable: "catastro_paispadron",
  provinceTable: "province",
  localityTable: "cadastral_locality",
  options: { clearMode: "delete" },
  dryRun: true,
  confirm: false,
});

const realRunBody = (): Body => ({ ...startBody(), dryRun: false, confirm: true });

const columnsBody = (role: unknown, extra: Body = {}): Body => ({
  connection: connectionBody(),
  schema: "cat",
  table: "padron_trabajo",
  role,
  ...extra,
});

function messageOf(body: Body): string {
  try {
    parseActualizarStartRequest(body);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

function expectRejected(body: Body, mention: string): void {
  expect(() => parseActualizarStartRequest(body)).toThrow(RequestInvalidError);
  expect(messageOf(body)).toContain(mention);
  expect(messageOf(body)).not.toContain(PASSWORD);
}

const TEXT_FIELDS = [
  "stagingSchema",
  "stagingTable",
  "workSchema",
  "workTable",
  "padronTable",
  "provinceTable",
  "localityTable",
] as const;

const textFieldCases = TEXT_FIELDS.flatMap((field) => [
  { field, variant: "is missing", patch: (body: Body) => delete body[field] },
  { field, variant: "is an empty string", patch: (body: Body) => (body[field] = "") },
  { field, variant: "is whitespace only", patch: (body: Body) => (body[field] = "   ") },
  { field, variant: "is not a string", patch: (body: Body) => (body[field] = 42) },
]);

const connectionCases: Array<{ name: string; mention: string; patch: (body: Body) => void }> = [
  { name: "connection is missing", mention: "connection", patch: (body) => delete body.connection },
  { name: "connection is not an object", mention: "connection", patch: (body) => (body.connection = "db.local") },
  { name: "connection is null", mention: "connection", patch: (body) => (body.connection = null) },
  { name: "host is missing", mention: "host", patch: (body) => delete body.connection.host },
  { name: "host is blank", mention: "host", patch: (body) => (body.connection.host = " ") },
  { name: "port is missing", mention: "puerto", patch: (body) => delete body.connection.port },
  { name: "port is not numeric", mention: "puerto", patch: (body) => (body.connection.port = "abc") },
  { name: "port is 0", mention: "puerto", patch: (body) => (body.connection.port = 0) },
  { name: "port is 65536", mention: "puerto", patch: (body) => (body.connection.port = 65536) },
  { name: "db_name is missing", mention: "db_name", patch: (body) => delete body.connection.db_name },
  { name: "user is missing", mention: "user", patch: (body) => delete body.connection.user },
  { name: "password is missing", mention: "password", patch: (body) => delete body.connection.password },
  { name: "password is not a string", mention: "password", patch: (body) => (body.connection.password = 12345) },
];

const optionsCases: Array<{ name: string; mention: string; patch: (body: Body) => void }> = [
  { name: "options is missing", mention: "options", patch: (body) => delete body.options },
  { name: "options is an array", mention: "options", patch: (body) => (body.options = []) },
  { name: "options is null", mention: "options", patch: (body) => (body.options = null) },
  { name: "clearMode is missing", mention: "clearMode", patch: (body) => (body.options = {}) },
  { name: "clearMode is an empty string", mention: "clearMode", patch: (body) => (body.options.clearMode = "") },
  { name: "clearMode is unknown", mention: "clearMode", patch: (body) => (body.options.clearMode = "drop") },
  { name: "clearMode is upper case", mention: "clearMode", patch: (body) => (body.options.clearMode = "DELETE") },
];

describe("parseActualizarStartRequest", () => {
  describe("valid bodies", () => {
    it("should return the params of a dry run without confirm", () => {
      const params = parseActualizarStartRequest(startBody());

      expect(params).toMatchObject({
        stagingSchema: "stg",
        stagingTable: "catastro_paispadron_stg",
        workSchema: "cat",
        workTable: "padron_trabajo",
        padronTable: "catastro_paispadron",
        provinceTable: "province",
        localityTable: "cadastral_locality",
        options: { clearMode: "delete" },
        dryRun: true,
        confirm: false,
      });
    });

    it("should return the params of a real run with confirm true", () => {
      const params = parseActualizarStartRequest(realRunBody());

      expect(params).toMatchObject({ dryRun: false, confirm: true });
    });

    it("should map the connection into the run config with the password", () => {
      const params = parseActualizarStartRequest(startBody());

      expect(params.config).toMatchObject({
        host: "db.local",
        port: "5432",
        db_name: "gis",
        user: "gis_user",
        password: PASSWORD,
      });
    });

    it("should accept the port as a number and hand it on as a string", () => {
      const body = startBody();
      body.connection.port = 5432;

      const params = parseActualizarStartRequest(body);

      expect(params.config.port).toBe("5432");
    });

    it("should accept an empty password string for local databases", () => {
      const body = startBody();
      body.connection.password = "";

      const params = parseActualizarStartRequest(body);

      expect(params.config.password).toBe("");
    });

    it("should accept clearMode truncate", () => {
      const body = startBody();
      body.options.clearMode = "truncate";

      expect(parseActualizarStartRequest(body).options).toEqual({ clearMode: "truncate" });
    });

    it("should carry only clearMode into the options and ignore legacy option keys", () => {
      const body = startBody();
      body.options = { clearMode: "delete", repair: true, resetSequences: true };

      expect(parseActualizarStartRequest(body).options).toEqual({ clearMode: "delete" });
    });

    it("should accept a dry run with confirm true", () => {
      const body = startBody();
      body.confirm = true;

      expect(parseActualizarStartRequest(body)).toMatchObject({ dryRun: true, confirm: true });
    });

    it("should accept the staging table and the work table in different schemas with the same table name", () => {
      const body = startBody();
      body.stagingSchema = "stg";
      body.stagingTable = "padron_trabajo";
      body.workSchema = "cat";
      body.workTable = "padron_trabajo";

      expect(parseActualizarStartRequest(body)).toMatchObject({
        stagingSchema: "stg",
        stagingTable: "padron_trabajo",
        workTable: "padron_trabajo",
      });
    });
  });

  describe("required text fields", () => {
    it.each(textFieldCases)("should answer 400 naming the field when $field $variant", ({ field, patch }) => {
      const body = startBody();
      patch(body);

      expectRejected(body, field);
    });
  });

  describe("connection", () => {
    it.each(connectionCases)("should answer 400 naming the offending field when $name", ({ mention, patch }) => {
      const body = startBody();
      patch(body);

      expectRejected(body, mention);
    });
  });

  describe("options", () => {
    it.each(optionsCases)("should answer 400 naming the offending field when $name", ({ mention, patch }) => {
      const body = startBody();
      patch(body);

      expectRejected(body, mention);
    });
  });

  describe("booleans and confirm", () => {
    it("should answer 400 naming dryRun when dryRun is missing", () => {
      const body = startBody();
      delete body.dryRun;

      expectRejected(body, "dryRun");
    });

    it("should answer 400 naming dryRun when dryRun is the string true", () => {
      const body = startBody();
      body.dryRun = "true";

      expectRejected(body, "dryRun");
    });

    it("should answer 400 naming confirm when confirm is missing", () => {
      const body = startBody();
      delete body.confirm;

      expectRejected(body, "confirm");
    });

    it("should answer 400 naming confirm when confirm is the string true", () => {
      const body = startBody();
      body.confirm = "true";

      expectRejected(body, "confirm");
    });

    it("should answer 400 with the confirmation message when a real run has confirm false", () => {
      const body = realRunBody();
      body.confirm = false;

      expect(() => parseActualizarStartRequest(body)).toThrow(RequestInvalidError);
      expect(messageOf(body)).toMatch(/confirm/i);
      expect(messageOf(body)).not.toContain(PASSWORD);
    });

    it("should answer 400 when a real run omits confirm entirely", () => {
      const body = realRunBody();
      delete body.confirm;

      expect(() => parseActualizarStartRequest(body)).toThrow(RequestInvalidError);
    });
  });

  describe("distinct tables (AP-3)", () => {
    const sameTableCases: Array<{ name: string; patch: (body: Body) => void }> = [
      {
        name: "staging and work are the same schema.table",
        patch: (body) => {
          body.stagingSchema = "cat";
          body.stagingTable = SAME_TABLE;
          body.workSchema = "cat";
          body.workTable = SAME_TABLE;
        },
      },
      {
        name: "staging and padron are the same schema.table",
        patch: (body) => {
          body.stagingSchema = "cat";
          body.stagingTable = SAME_TABLE;
          body.padronTable = SAME_TABLE;
          body.workSchema = "cat";
        },
      },
      {
        name: "work and province are the same table",
        patch: (body) => {
          body.workTable = SAME_TABLE;
          body.provinceTable = SAME_TABLE;
        },
      },
      {
        name: "padron and locality are the same table",
        patch: (body) => {
          body.padronTable = SAME_TABLE;
          body.localityTable = SAME_TABLE;
        },
      },
      {
        name: "province and locality are the same table",
        patch: (body) => {
          body.provinceTable = SAME_TABLE;
          body.localityTable = SAME_TABLE;
        },
      },
    ];

    it.each(sameTableCases)("should answer 400 naming the repeated table when $name", ({ patch }) => {
      const body = startBody();
      patch(body);

      expectRejected(body, SAME_TABLE);
    });

    it("should answer 400 before any run when the repeated table is the work table itself", () => {
      const body = startBody();
      body.stagingSchema = "cat";
      body.stagingTable = "padron_trabajo";

      expect(() => parseActualizarStartRequest(body)).toThrow(RequestInvalidError);
    });
  });
});

describe("parseColumnsRequest for the actualizar-padron roles", () => {
  it.each([
    ["actualizar-staging", STAGING_REQUIRED_COLUMNS],
    ["actualizar-temp", WORK_REQUIRED_COLUMNS],
    ["actualizar-padron", PADRON_REQUIRED_COLUMNS],
    ["actualizar-provincia", PROVINCE_REQUIRED_COLUMNS],
    ["actualizar-localidad", LOCALITY_REQUIRED_COLUMNS],
  ])("should take the required columns of role %s from the job constants", (role, expected) => {
    const request = parseColumnsRequest(columnsBody(role));

    expect(request.role).toBe(role);
    expect(request.required).toEqual([...expected]);
  });

  it("should ignore a required list sent in the request for an actualizar role", () => {
    const request = parseColumnsRequest(columnsBody("actualizar-temp", { required: ["number"] }));

    expect(request.required).toEqual([...WORK_REQUIRED_COLUMNS]);
  });

  it.each([
    ["rural", RURAL_REQUIRED_COLUMNS],
    ["urbano", URBANO_REQUIRED_COLUMNS],
    ["target", TARGET_REQUIRED_COLUMNS],
  ])("should keep the cargar role %s unchanged", (role, expected) => {
    const request = parseColumnsRequest(columnsBody(role));

    expect(request.required).toEqual([...expected]);
  });

  it.each([
    ["an unknown actualizar role", "actualizar-otro"],
    ["a bare word that is not a role", "padron"],
    ["an empty string", ""],
    ["the job id", "actualizar-padron-job"],
    ["a number", 1],
    ["null", null],
  ])("should answer 400 with a role message when the role is %s", (_name, role) => {
    expect(() => parseColumnsRequest(columnsBody(role))).toThrow(RequestInvalidError);
    expect(() => parseColumnsRequest(columnsBody(role))).toThrow(/role/);
  });
});
