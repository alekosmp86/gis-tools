import { describe, expect, it } from "vitest";
import { parseEjesCallesStartRequest } from "@/modules/routine-jobs/api/ejesCallesRequestParsing";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { ACCEPTED_KEYS_LIMIT } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
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
  it("should accept an empty accepted object as valid, with no plain removals and no merges", () => {
    const params = parse(realBody({}));

    expect(params.accepted).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false, renamedStreets: [] });
  });

  it("should deduplicate repeated plain removal refs and merge refs, keeping the first order", () => {
    const params = parse(
      realBody({
        plainRemovals: [{ ref: "7" }, { ref: "3" }, { ref: "7" }],
        merges: [{ newRef: "9" }, { newRef: "9" }],
      })
    );

    expect(params.accepted).toEqual({ splits: [], plainRemovals: ["7", "3"], merges: ["9"], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false, renamedStreets: [] });
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

    expect(params.accepted).toEqual({ splits: [], plainRemovals: ["12"], merges: ["7"], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false, renamedStreets: [] });
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

  it("should accept a split with its oldRef and the user's choices, and send it with its choices", () => {
    const params = parse(realBody({ splits: [{ oldRef: "0012", choices: [{ pointId: "41", newRef: "6002" }] }] }));

    expect(params.accepted?.splits).toEqual([{ oldRef: "12", choices: [{ pointId: "41", newRef: "6002" }] }]);
  });

  it("should accept a split with no choices as an empty choices list", () => {
    const params = parse(realBody({ splits: [{ oldRef: "6001" }] }));

    expect(params.accepted?.splits).toEqual([{ oldRef: "6001", choices: [] }]);
  });

  it("should refuse the old split shape with newRefs with a 400 that names the unknown key", () => {
    const body = realBody({ splits: [{ oldRef: "1", newRefs: ["2", "3"] }] });

    expect(() => parse(body)).toThrow(RequestInvalidError);
    expect(messageOf(body)).toContain("newRefs");
  });

  it("should refuse an unknown key inside a split entry with a 400", () => {
    expect(() => parse(realBody({ splits: [{ oldRef: "1", choices: [], extra: 1 }] }))).toThrow(RequestInvalidError);
  });

  it("should refuse an unknown key inside a choice with a 400", () => {
    expect(() => parse(realBody({ splits: [{ oldRef: "1", choices: [{ pointId: "4", newRef: "5", extra: 1 }] }] }))).toThrow(RequestInvalidError);
  });

  it("should refuse a point chosen twice for two different pieces of one split with a 400", () => {
    const body = realBody({
      splits: [
        { oldRef: "1", choices: [{ pointId: "4", newRef: "5" }] },
        { oldRef: "1", choices: [{ pointId: "4", newRef: "6" }] },
      ],
    });

    expect(() => parse(body)).toThrow(RequestInvalidError);
  });

  it("should refuse a splits list that is not an array with a 400", () => {
    expect(() => parse(realBody({ splits: "1" }))).toThrow(RequestInvalidError);
  });

  it("should accept an empty splits list next to shaped merges", () => {
    const params = parse(realBody({ splits: [], merges: [{ newRef: "5" }] }));

    expect(params.accepted).toEqual({ splits: [], plainRemovals: [], merges: ["5"], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false, renamedStreets: [] });
  });

  it("should refuse the whole request, not one entry, when one entry of a list is malformed", () => {
    expect(() => parse(realBody({ plainRemovals: [{ ref: "1" }, { ref: "x" }] }))).toThrow(RequestInvalidError);
  });


  describe("twin picks (ET-28)", () => {
    const pick = (ref: string, department = "FLORES", locality = "TRINIDAD") => ({ ref, department, locality });

    it("should accept a valid pick with its canonical ref and its department and locality trimmed", () => {
      const params = parse(realBody({ twinPicks: [{ ref: "0012", department: " FLORES ", locality: "TRINIDAD " }] }));

      expect(params.accepted?.twinPicks).toEqual([{ ref: "12", department: "FLORES", locality: "TRINIDAD" }]);
    });

    it("should read an absent twinPicks as an empty list", () => {
      expect(parse(realBody({ plainRemovals: [] })).accepted?.twinPicks).toEqual([]);
    });

    it("should refuse two picks of one reftramo with a 400 that names it, never merging them", () => {
      const body = realBody({ twinPicks: [pick("0012", "FLORES", "TRINIDAD"), pick("12", "FLORES", "SAN JOSE")] });

      expect(() => parse(body)).toThrow(RequestInvalidError);
      expect(messageOf(body)).toBe("El tramo 12 tiene más de una copia elegida.");
    });

    it.each([
      ["an empty department", { department: "" }, "accepted.twinPicks.department"],
      ["a whitespace-only locality", { locality: "   " }, "accepted.twinPicks.locality"],
      ["a missing department", { department: undefined }, "accepted.twinPicks.department"],
      ["a non-integer ref", { ref: "abc" }, "accepted.twinPicks.ref"],
      ["an empty ref", { ref: "" }, "accepted.twinPicks.ref"],
    ])("should refuse a pick with %s with a 400 that names the field", (_label, patch, field) => {
      const body = realBody({ twinPicks: [{ ...pick("7"), ...patch }] });

      expect(() => parse(body)).toThrow(RequestInvalidError);
      expect(messageOf(body)).toContain(field);
    });

    it("should refuse a pick with an unknown key with a 400 that names the key", () => {
      const body = realBody({ twinPicks: [{ ...pick("7"), extra: 1 }] });

      expect(() => parse(body)).toThrow(RequestInvalidError);
      expect(messageOf(body)).toContain("extra");
    });

    it("should refuse a pick that is not an object with a 400", () => {
      expect(() => parse(realBody({ twinPicks: ["7"] }))).toThrow(RequestInvalidError);
    });

    it("should refuse a twinPicks value that is not a list with a 400", () => {
      expect(() => parse(realBody({ twinPicks: "7" }))).toThrow(RequestInvalidError);
    });

    it("should accept exactly ACCEPTED_KEYS_LIMIT picks (boundary)", () => {
      const params = parse(realBody({ twinPicks: distinctRefs(ACCEPTED_KEYS_LIMIT).map((entry) => pick(entry.ref)) }));

      expect(params.accepted?.twinPicks).toHaveLength(ACCEPTED_KEYS_LIMIT);
    });

    it("should refuse ACCEPTED_KEYS_LIMIT plus one picks with a 400 that names the field, never truncating", () => {
      const body = realBody({ twinPicks: distinctRefs(ACCEPTED_KEYS_LIMIT + 1).map((entry) => pick(entry.ref)) });

      expect(() => parse(body)).toThrow(RequestInvalidError);
      expect(messageOf(body)).toContain("accepted.twinPicks");
      expect(messageOf(body)).toContain(String(ACCEPTED_KEYS_LIMIT));
    });
  });

  describe("renamed streets (EJL-31)", () => {
    it("should read no renamed streets when the key is absent", () => {
      const params = parse(realBody({ merges: [] }));

      expect(params.accepted?.renamedStreets).toEqual([]);
    });

    it("should read no renamed streets when the list is empty", () => {
      expect(parse(realBody({ renamedStreets: [] })).accepted?.renamedStreets).toEqual([]);
    });
  });
});
