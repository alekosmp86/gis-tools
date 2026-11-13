import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEjesCallesStartRequest } from "@/modules/routine-jobs/api/ejesCallesRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { REAL_RUN_UNAVAILABLE_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ejesTablesBody } from "../ejes-calles/ejesFixtures";

const PASSWORD = "Ej-es!pw";

type Body = Record<string, unknown>;

const startBody = (overrides: Body = {}): Body => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  tables: ejesTablesBody(),
  dryRun: true,
  ...overrides,
});

const parse = (body: Body) => parseEjesCallesStartRequest(body as Parameters<typeof parseEjesCallesStartRequest>[0]);

function messageOf(body: Body): string {
  try {
    parse(body);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("parseEjesCallesStartRequest", () => {
  it("should return the params of a dry run with config and nine tables", () => {
    const params = parse(startBody());

    expect(params.dryRun).toBe(true);
    expect(params.config).toMatchObject({ host: "db.local", port: "5432", db_name: "gis", user: "gis_user" });
    expect(Object.keys(params.tables)).toHaveLength(9);
    expect(params.tables["ejes-origen"]).toEqual({ schema: "bdj_carto", table: "ide_ejesviacirculacion" });
  });

  describe("real run (EJL-1)", () => {
    const COUNT_KEYS = ["newSections", "unchanged", "attr", "geom", "both", "removed", "splits", "merges", "plainRemovals", "renumbered"];
    const counts = (): Record<string, number> => Object.fromEntries(COUNT_KEYS.map((key, index) => [key, index]));
    const realBody = (overrides: Body = {}): Body => ({
      ...startBody({ dryRun: false }),
      summary: { counts: counts() },
      accepted: {},
      ...overrides,
    });
    const withoutPassword = (): Body => ({
      connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "" },
    });

    beforeEach(() => {
      vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "true");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    describe("switch off (EJL-16)", () => {
      beforeEach(() => {
        vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "false");
      });

      it("should refuse dryRun false with a 400 and the unavailable message", () => {
        expect(() => parse(realBody())).toThrow(RequestInvalidError);
        expect(messageOf(realBody())).toBe(REAL_RUN_UNAVAILABLE_MESSAGE);
      });

      it("should refuse before the password and summary checks", () => {
        const body = realBody(withoutPassword());
        delete body.summary;

        expect(messageOf(body)).toBe(REAL_RUN_UNAVAILABLE_MESSAGE);
      });

      it("should refuse when the env var is unset", () => {
        vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", undefined);

        expect(messageOf(realBody())).toBe(REAL_RUN_UNAVAILABLE_MESSAGE);
      });

      it("should still accept a dry run", () => {
        expect(parse(startBody()).dryRun).toBe(true);
      });
    });

    it("should accept dryRun false with password, summary and an empty accepted object", () => {
      const params = parse(realBody());

      expect(params.dryRun).toBe(false);
      expect(params.summary?.counts).toEqual(counts());
    });

    it("should keep only the 10 summary counts as numbers and drop any other key", () => {
      const params = parse(realBody({ summary: { counts: { ...counts(), extra: 99 } } }));

      expect(Object.keys(params.summary?.counts ?? {}).sort()).toEqual([...COUNT_KEYS].sort());
    });

    it("should accept accepted lists that are present and empty", () => {
      const params = parse(realBody({ accepted: { splits: [], merges: [], removals: [], plainRemovals: [] } }));

      expect(params.dryRun).toBe(false);
    });

    it("should refuse dryRun false without the password, with a Spanish message", () => {
      const body = realBody(withoutPassword());

      expect(() => parse(body)).toThrow(RequestInvalidError);
      expect(messageOf(body)).toMatch(/contraseña/);
    });

    it("should refuse dryRun false without the summary", () => {
      const body = realBody();
      delete body.summary;

      expect(() => parse(body)).toThrow(RequestInvalidError);
      expect(messageOf(body)).toMatch(/resumen/);
    });

    it("should refuse dryRun false with a null summary", () => {
      expect(() => parse(realBody({ summary: null }))).toThrow(RequestInvalidError);
    });

    it("should refuse a summary without counts", () => {
      expect(() => parse(realBody({ summary: {} }))).toThrow(RequestInvalidError);
    });

    it.each(COUNT_KEYS)("should refuse a summary whose %s count is missing", (key) => {
      const partial = counts();
      delete partial[key];

      expect(() => parse(realBody({ summary: { counts: partial } }))).toThrow(RequestInvalidError);
    });

    it.each([
      ["a string", "3"],
      ["null", null],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
    ])("should refuse a summary count that is %s", (_label, value) => {
      expect(() => parse(realBody({ summary: { counts: { ...counts(), geom: value } } }))).toThrow(RequestInvalidError);
    });

    it("should accept a summary count of zero", () => {
      const zeros = Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));

      expect(parse(realBody({ summary: { counts: zeros } })).summary?.counts).toEqual(zeros);
    });

    it("should refuse dryRun false without the accepted object", () => {
      const body = realBody();
      delete body.accepted;

      expect(() => parse(body)).toThrow(RequestInvalidError);
      expect(messageOf(body)).toMatch(/accepted/);
    });

    it.each([
      ["null", null],
      ["a string", "x"],
      ["a list", []],
    ])("should refuse an accepted that is %s", (_label, value) => {
      expect(() => parse(realBody({ accepted: value }))).toThrow(RequestInvalidError);
    });

    it.each(["splits", "merges", "removals", "plainRemovals"])(
      "should keep the unavailable message when accepted.%s is not empty",
      (key) => {
        expect(messageOf(realBody({ accepted: { [key]: [{ ref: "1" }] } }))).toBe(REAL_RUN_UNAVAILABLE_MESSAGE);
      }
    );

    it("should refuse an accepted list that is not a list", () => {
      expect(() => parse(realBody({ accepted: { splits: "all" } }))).toThrow(RequestInvalidError);
    });

    it("should keep the exact EJ-3 text for REAL_RUN_UNAVAILABLE_MESSAGE", () => {
      expect(REAL_RUN_UNAVAILABLE_MESSAGE).toBe("La carga real de ejes de calles todavía no está disponible.");
    });

    it("should never leak the password in a real-run error message", () => {
      const messages = [
        messageOf(realBody({ accepted: { splits: [1] } })),
        messageOf(realBody({ summary: null })),
        messageOf(startBody({ dryRun: false })),
      ];

      for (const message of messages) expect(message).not.toContain(PASSWORD);
    });

    it("should not require summary or accepted on a dry run", () => {
      expect(parse(startBody()).summary).toBeUndefined();
    });
  });

  it.each([
    ["missing", undefined],
    ["a string", "true"],
    ["null", null],
    ["a number", 1],
  ])("should reject a dryRun that is %s", (_label, value) => {
    const body = startBody();
    if (value === undefined) delete body.dryRun;
    else body.dryRun = value;

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });

  it("EJ-5: should reject two roles that are the same table", () => {
    const tables = ejesTablesBody();
    tables["ejes-vias"] = { ...tables["ejes-tramos"] };

    expect(() => parse(startBody({ tables }))).toThrow(RequestInvalidError);
    expect(messageOf(startBody({ tables }))).toMatch(/distinta/);
  });

  it("should reject a body without the tables record", () => {
    const body = startBody();
    delete body.tables;

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });

  it("should reject a missing role entry", () => {
    const tables: Body = { ...ejesTablesBody() };
    delete tables["ejes-accesos"];

    expect(() => parse(startBody({ tables }))).toThrow(RequestInvalidError);
  });

  it("should reject a blank table name", () => {
    const tables = ejesTablesBody();
    tables["ejes-origen"] = { schema: "bdj_carto", table: "  " };

    expect(() => parse(startBody({ tables }))).toThrow(RequestInvalidError);
  });

  it("should reject a missing connection", () => {
    const body = startBody();
    delete body.connection;

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });

  it("should reject a connection with an empty host", () => {
    const body = startBody({ connection: { host: "", port: "5432", db_name: "gis", user: "u", password: PASSWORD } });

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });
});
