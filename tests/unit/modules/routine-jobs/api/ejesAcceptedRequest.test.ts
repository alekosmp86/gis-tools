import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEjesCallesStartRequest } from "@/modules/routine-jobs/api/ejesCallesRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { ACCEPTED_KEYS_LIMIT, REAL_RUN_UNAVAILABLE_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ejesTablesBody } from "../ejes-calles/ejesFixtures";

type Body = Record<string, unknown>;

const PASSWORD = "Ej-es!pw";
const COUNT_KEYS = [
  "newSections",
  "unchanged",
  "attr",
  "geom",
  "both",
  "removed",
  "splits",
  "merges",
  "plainRemovals",
  "renumbered",
  "renumberSkipped",
];
const FINGERPRINT = { rows: 12, digest: "9f8e7d6c5b4a3210fedcba9876543210" };

const realBody = (accepted: unknown): Body => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  tables: ejesTablesBody(),
  dryRun: false,
  summary: { counts: Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])), fingerprint: { ...FINGERPRINT } },
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

const distinctRefs = (count: number, offset = 1): Array<{ ref: string }> =>
  Array.from({ length: count }, (_, index) => ({ ref: String(offset + index) }));

describe("parseEjesCallesStartRequest accepted rows (EJS-16, EJ-13, Q3)", () => {
  beforeEach(() => {
    vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should accept an empty accepted object as valid, with no plain removals and no merges", () => {
    const params = parse(realBody({}));

    expect(params.accepted).toEqual({ plainRemovals: [], merges: [] });
  });

  it("should deduplicate repeated plain removal refs and merge refs, keeping the first order", () => {
    const params = parse(
      realBody({
        plainRemovals: [{ ref: "7" }, { ref: "3" }, { ref: "7" }],
        merges: [{ newRef: "9" }, { newRef: "9" }],
      })
    );

    expect(params.accepted).toEqual({ plainRemovals: ["7", "3"], merges: ["9"] });
  });

  it("should accept exactly ACCEPTED_KEYS_LIMIT distinct keys in one list (boundary)", () => {
    const params = parse(realBody({ plainRemovals: distinctRefs(ACCEPTED_KEYS_LIMIT) }));

    expect(params.accepted?.plainRemovals).toHaveLength(ACCEPTED_KEYS_LIMIT);
  });

  it("should refuse ACCEPTED_KEYS_LIMIT plus one keys with a 400, never truncating the list", () => {
    const body = realBody({ merges: distinctRefs(ACCEPTED_KEYS_LIMIT + 1).map((entry) => ({ newRef: entry.ref })) });

    expect(() => parse(body)).toThrow(RequestInvalidError);
    expect(messageOf(body)).toContain(String(ACCEPTED_KEYS_LIMIT));
  });

  it("should canonicalise leading zeros in the refs, so '0012' is sent as 12", () => {
    const params = parse(realBody({ plainRemovals: [{ ref: "0012" }], merges: [{ newRef: "007" }] }));

    expect(params.accepted).toEqual({ plainRemovals: ["12"], merges: ["7"] });
  });

  it("should accept a negative integer ref as its canonical text", () => {
    const params = parse(realBody({ plainRemovals: [{ ref: "-5" }] }));

    expect(params.accepted?.plainRemovals).toEqual(["-5"]);
  });

  it.each([
    ["a non-integer text", "abc"],
    ["a decimal", "1.5"],
    ["an empty string", ""],
    ["a text with a space", " 3"],
    ["a number instead of a text", 3],
    ["null", null],
  ])("should refuse a plain removal ref that is %s with a 400", (_label, ref) => {
    const body = realBody({ plainRemovals: [{ ref }] });

    expect(() => parse(body)).toThrow(RequestInvalidError);
    expect(messageOf(body)).toContain("accepted.plainRemovals.ref");
  });

  it.each([
    ["a non-integer text", "x1"],
    ["a decimal", "2.0"],
  ])("should refuse a merge newRef that is %s with a 400", (_label, newRef) => {
    expect(() => parse(realBody({ merges: [{ newRef }] }))).toThrow(RequestInvalidError);
  });

  it("should refuse a plain removal entry without its ref with a 400", () => {
    expect(() => parse(realBody({ plainRemovals: [{}] }))).toThrow(RequestInvalidError);
  });

  it("should refuse a merge entry without its newRef with a 400, not a ref", () => {
    const body = realBody({ merges: [{ ref: "4" }] });

    expect(() => parse(body)).toThrow(RequestInvalidError);
    expect(messageOf(body)).toContain("accepted.merges.newRef");
  });

  it("should refuse a list entry that is not an object with a 400", () => {
    expect(() => parse(realBody({ plainRemovals: ["7"] }))).toThrow(RequestInvalidError);
  });

  it("should refuse an accepted list that is not an array with a 400", () => {
    expect(() => parse(realBody({ merges: "4" }))).toThrow(RequestInvalidError);
  });

  it("should refuse an unknown key in accepted with a 400 that names the key", () => {
    const body = realBody({ plainRemovals: [], unexpected: [] });

    expect(() => parse(body)).toThrow(RequestInvalidError);
    expect(messageOf(body)).toContain("unexpected");
  });

  it("should keep the unavailable message for a non-empty splits list, not a shape message", () => {
    expect(messageOf(realBody({ splits: [{ oldRef: "1", newRefs: ["2", "3"] }] }))).toBe(REAL_RUN_UNAVAILABLE_MESSAGE);
  });

  it("should accept an empty splits list next to shaped merges", () => {
    const params = parse(realBody({ splits: [], merges: [{ newRef: "5" }] }));

    expect(params.accepted).toEqual({ plainRemovals: [], merges: ["5"] });
  });

  it("should refuse the whole request, not one entry, when one entry of a list is malformed", () => {
    expect(() => parse(realBody({ plainRemovals: [{ ref: "1" }, { ref: "x" }] }))).toThrow(RequestInvalidError);
  });

  it("should refuse a real run with the switch off before reading accepted, even when accepted is malformed", () => {
    vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "false");

    expect(messageOf(realBody({ merges: "broken", removals: [] }))).toBe(REAL_RUN_UNAVAILABLE_MESSAGE);
  });
});
