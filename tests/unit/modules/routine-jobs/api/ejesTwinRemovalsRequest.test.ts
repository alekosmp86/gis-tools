import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEjesCallesStartRequest } from "@/modules/routine-jobs/api/ejesCallesRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { ACCEPTED_KEYS_LIMIT, EJES_SUMMARY_COUNT_KEYS } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ejesTablesBody } from "../ejes-calles/ejesFixtures";

type Body = Record<string, unknown>;

const PASSWORD = "Ej-es!pw";
const FINGERPRINT = { rows: 12, digest: "9f8e7d6c5b4a3210fedcba9876543210" };

const realBody = (accepted: unknown): Body => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  tables: ejesTablesBody(),
  dryRun: false,
  summary: { counts: Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key) => [key, 0])), fingerprint: { ...FINGERPRINT } },
  accepted,
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

const distinctRefs = (count: number): Array<{ ref: string }> => Array.from({ length: count }, (_, index) => ({ ref: String(index + 1) }));

describe("parseEjesCallesStartRequest accepted.twinRemovals (ET-24, EJS-16)", () => {
  beforeEach(() => {
    vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should read no twin removals when the key is absent", () => {
    const params = parse(realBody({ splits: [], plainRemovals: [], merges: [] }));

    expect(params.accepted?.twinRemovals).toEqual([]);
  });

  it("should read the twin removal refs in canonical text, deduplicated and in their first order", () => {
    const params = parse(realBody({ twinRemovals: [{ ref: "0012" }, { ref: "7" }, { ref: "0012" }] }));

    expect(params.accepted).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: ["12", "7"] });
  });

  it("should accept exactly ACCEPTED_KEYS_LIMIT twin removals (boundary)", () => {
    const params = parse(realBody({ twinRemovals: distinctRefs(ACCEPTED_KEYS_LIMIT) }));

    expect(params.accepted?.twinRemovals).toHaveLength(ACCEPTED_KEYS_LIMIT);
  });

  it("should refuse ACCEPTED_KEYS_LIMIT plus one twin removals with a 400 that names the list, never truncating it", () => {
    const body = realBody({ twinRemovals: distinctRefs(ACCEPTED_KEYS_LIMIT + 1) });

    expect(() => parse(body)).toThrow(RequestInvalidError);
    expect(messageOf(body)).toContain("accepted.twinRemovals");
  });

  it.each([
    ["a non-integer text", "abc"],
    ["a decimal", "1.5"],
    ["an empty string", ""],
    ["a number instead of a text", 3],
    ["null", null],
  ])("should refuse a twin removal ref that is %s with a 400", (_label, ref) => {
    const body = realBody({ twinRemovals: [{ ref }] });

    expect(() => parse(body)).toThrow(RequestInvalidError);
    expect(messageOf(body)).toContain("accepted.twinRemovals.ref");
  });

  it("should refuse a twin removal entry that is not an object with a 400", () => {
    expect(() => parse(realBody({ twinRemovals: ["7"] }))).toThrow(RequestInvalidError);
  });

  it("should refuse a twin removal list that is not an array with a 400", () => {
    expect(() => parse(realBody({ twinRemovals: "7" }))).toThrow(RequestInvalidError);
  });

  it("should refuse an unknown key next to the twin removals with a 400 that names the key", () => {
    const body = realBody({ twinRemovals: [{ ref: "7" }], twinRemoval: [{ ref: "7" }] });

    expect(() => parse(body)).toThrow(RequestInvalidError);
    expect(messageOf(body)).toContain("twinRemoval");
  });
});
