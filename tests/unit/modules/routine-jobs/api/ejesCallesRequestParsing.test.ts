import { describe, expect, it } from "vitest";
import { parseEjesCallesStartRequest } from "@/modules/routine-jobs/api/ejesCallesRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
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

const SUMMARY_COUNT_KEYS = [
  "newSections",
  "unchanged",
  "attr",
  "geom",
  "both",
  "removed",
  "splits",
  "replacements",
  "merges",
  "plainRemovals",
  "keptByDiscardedCandidate",
  "renumbered",
  "renumberSkipped",
  "splitPointsAuto",
  "splitPointsReview",
  "splitPointsNoGeometry",
  "geoTwinLosersRemovable",
  "geoTwinLosersOmitted",
  "twinPicksApplied",
  "manualSplitsApplied",
  "twinsDefaulted",
  "renumberedByGeometry",
  "renumberDroppedCandidates",
];

const FINGERPRINT = { rows: 12, digest: "9f8e7d6c5b4a3210fedcba9876543210" };

describe("parseEjesCallesStartRequest", () => {
  it("should return the params of a dry run with config and ten tables", () => {
    const params = parse(startBody());

    expect(params.dryRun).toBe(true);
    expect(params.config).toMatchObject({ host: "db.local", port: "5432", db_name: "gis", user: "gis_user" });
    expect(Object.keys(params.tables)).toHaveLength(10);
    expect(params.tables["ejes-origen"]).toEqual({ schema: "bdj_carto", table: "ide_ejesviacirculacion" });
    expect(params.tables["ejes-address"]).toEqual({ schema: "carto", table: "address" });
  });

  describe("real run (EJL-1, EJL-20)", () => {
    const counts = (): Record<string, number> => Object.fromEntries(SUMMARY_COUNT_KEYS.map((key, index) => [key, index]));
    const summaryOf = (overrides: Body = {}): Body => ({ counts: counts(), fingerprint: { ...FINGERPRINT }, ...overrides });
    const realBody = (overrides: Body = {}): Body => ({
      ...startBody({ dryRun: false }),
      summary: summaryOf(),
      accepted: {},
      ...overrides,
    });
    const withoutPassword = (): Body => ({
      connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "" },
    });


    it("should accept dryRun false with password, summary and an empty accepted object", () => {
      const params = parse(realBody());

      expect(params.dryRun).toBe(false);
      expect(params.summary?.counts).toEqual(counts());
      expect(params.summary?.fingerprint).toEqual(FINGERPRINT);
    });

    it("should keep only the summary counts as numbers and drop any other key", () => {
      const params = parse(realBody({ summary: summaryOf({ counts: { ...counts(), extra: 99 } }) }));

      expect(Object.keys(params.summary?.counts ?? {}).sort()).toEqual([...SUMMARY_COUNT_KEYS].sort());
    });

    it("should accept accepted lists that are present and empty", () => {
      const params = parse(realBody({ accepted: { splits: [], merges: [], twinRemovals: [], plainRemovals: [] } }));

      expect(params.dryRun).toBe(false);
      expect(params.accepted).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false, renamedStreets: [] });
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
      expect(() => parse(realBody({ summary: { fingerprint: { ...FINGERPRINT } } }))).toThrow(RequestInvalidError);
    });

    it.each(SUMMARY_COUNT_KEYS)("should refuse a summary whose %s count is missing", (key) => {
      const partial = counts();
      delete partial[key];

      expect(() => parse(realBody({ summary: summaryOf({ counts: partial }) }))).toThrow(RequestInvalidError);
    });

    it.each([
      ["a string", "3"],
      ["null", null],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
    ])("should refuse a summary count that is %s", (_label, value) => {
      expect(() => parse(realBody({ summary: summaryOf({ counts: { ...counts(), geom: value } }) }))).toThrow(RequestInvalidError);
    });

    it("should accept a summary count of zero", () => {
      const zeros = Object.fromEntries(SUMMARY_COUNT_KEYS.map((key) => [key, 0]));

      expect(parse(realBody({ summary: summaryOf({ counts: zeros }) })).summary?.counts).toEqual(zeros);
    });

    it("should refuse a summary without the renumberSkipped count, the Revisar counts of EJL-1", () => {
      const partial = counts();
      delete partial.renumberSkipped;

      expect(() => parse(realBody({ summary: { counts: partial, fingerprint: { ...FINGERPRINT } } }))).toThrow(RequestInvalidError);
    });

    it("should refuse a summary without the fingerprint (EJL-20)", () => {
      const body = realBody({ summary: { counts: counts() } });

      expect(() => parse(body)).toThrow(RequestInvalidError);
      expect(messageOf(body)).toMatch(/fingerprint|huella/);
    });

    it.each([
      ["null", null],
      ["a string", "9f8e"],
      ["a list", []],
    ])("should refuse a fingerprint that is %s (EJL-20)", (_label, value) => {
      expect(() => parse(realBody({ summary: summaryOf({ fingerprint: value }) }))).toThrow(RequestInvalidError);
    });

    it("should refuse a fingerprint without its row count (EJL-20)", () => {
      expect(() => parse(realBody({ summary: summaryOf({ fingerprint: { digest: FINGERPRINT.digest } }) }))).toThrow(RequestInvalidError);
    });

    it("should refuse a fingerprint whose row count is not a finite number (EJL-20)", () => {
      expect(() => parse(realBody({ summary: summaryOf({ fingerprint: { rows: "12", digest: FINGERPRINT.digest } }) }))).toThrow(
        RequestInvalidError
      );
      expect(() => parse(realBody({ summary: summaryOf({ fingerprint: { rows: null, digest: FINGERPRINT.digest } }) }))).toThrow(
        RequestInvalidError
      );
    });

    it.each([
      ["missing", undefined],
      ["an empty string", ""],
      ["a number", 42],
      ["null", null],
    ])("should refuse a fingerprint digest that is %s (EJL-20)", (_label, value) => {
      const fingerprint = value === undefined ? { rows: FINGERPRINT.rows } : { rows: FINGERPRINT.rows, digest: value };

      expect(() => parse(realBody({ summary: summaryOf({ fingerprint }) }))).toThrow(RequestInvalidError);
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

    it("should accept a split with its oldRef and choices in accepted.splits", () => {
      const params = parse(realBody({ accepted: { splits: [{ oldRef: "1", choices: [{ pointId: "4", newRef: "2" }] }] } }));

      expect(params.accepted?.splits).toEqual([{ oldRef: "1", choices: [{ pointId: "4", newRef: "2" }] }]);
    });

    it("should refuse the old split shape with newRefs with a 400 that names the key", () => {
      expect(messageOf(realBody({ accepted: { splits: [{ oldRef: "1", newRefs: ["2"] }] } }))).toMatch(/clave no admitida: newRefs/);
    });

    it("should refuse the removals key as an unknown key, since plain removals are plainRemovals", () => {
      expect(messageOf(realBody({ accepted: { removals: [{ ref: "1" }] } }))).toMatch(/clave no admitida: removals/);
    });

    it("should accept a non-empty merges and plainRemovals list when every entry is shaped", () => {
      const params = parse(realBody({ accepted: { merges: [{ newRef: "4" }], plainRemovals: [{ ref: "7" }] } }));

      expect(params.accepted).toEqual({ splits: [], merges: ["4"], twinRemovals: [], plainRemovals: ["7"], twinPicks: [], manualSplits: [], autoPlainRemovals: false, renamedStreets: [] });
    });

    it("should refuse an accepted list that is not a list", () => {
      expect(() => parse(realBody({ accepted: { splits: "all" } }))).toThrow(RequestInvalidError);
    });


    it("should never leak the password in a real-run error message", () => {
      const messages = [
        messageOf(realBody({ accepted: { splits: [1] } })),
        messageOf(realBody({ summary: null })),
        messageOf(realBody({ summary: { counts: counts() } })),
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

  describe("dry run with optional accepted twinPicks (ET-28)", () => {
    const PICK = { ref: "0012", department: "FLORES", locality: "TRINIDAD" };

    it("should read a dry run without accepted as no picks, with the other accepted lists empty", () => {
      const params = parse(startBody());

      expect(params.accepted).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false, renamedStreets: [] });
      expect(params.summary).toBeUndefined();
    });

    it("should read a dry run with accepted null as no picks", () => {
      expect(parse(startBody({ accepted: null })).accepted?.twinPicks).toEqual([]);
    });

    it("should read the picks of a dry run's accepted, canonical and trimmed, for the analysis to see", () => {
      const params = parse(startBody({ accepted: { twinPicks: [{ ...PICK, department: " FLORES " }] } }));

      expect(params.accepted).toEqual({
        splits: [],
        plainRemovals: [],
        merges: [],
        twinRemovals: [],
        twinPicks: [{ ref: "12", department: "FLORES", locality: "TRINIDAD" }],
        manualSplits: [],
        autoPlainRemovals: false,
        renamedStreets: [],
      });
    });

    it("should refuse a dry run whose accepted carries a key other than twinPicks, with a 400 that names it", () => {
      const body = startBody({ accepted: { plainRemovals: [{ ref: "7" }] } });

      expect(() => parse(body)).toThrow(RequestInvalidError);
      expect(messageOf(body)).toMatch(/clave no admitida: plainRemovals/);
    });

    it("should refuse a dry run whose picks repeat a reftramo, with the same message as a real run", () => {
      const body = startBody({ accepted: { twinPicks: [PICK, { ...PICK, locality: "SAN JOSE" }] } });

      expect(messageOf(body)).toBe("El tramo 12 tiene más de una copia elegida.");
    });

    it("should refuse a dry run whose accepted is not an object with a 400", () => {
      expect(() => parse(startBody({ accepted: "x" }))).toThrow(RequestInvalidError);
    });
  });
});
