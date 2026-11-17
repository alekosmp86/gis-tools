import { describe, expect, it } from "vitest";
import { GEO_TWIN_ROLE } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import {
  acceptanceAfter,
  acceptedRequestOf,
  acceptKeysOf,
  EjesAcceptList,
  type EjesAcceptance,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesAccept";
import { isGeoTwinRemovable } from "@/modules/routine-jobs/ui/ejes-calles/compact/ejesGeoTwinColumns";

const ANALYSIS = "host|5432|gis|user|tables-a";

const acceptedWith = (overrides: Partial<EjesAcceptance> = {}): EjesAcceptance => ({
  analysisKey: ANALYSIS,
  splits: [],
  plainRemovals: [],
  merges: [],
  twinRemovals: [],
  pointChoices: [],
  ...overrides,
});

describe("isGeoTwinRemovable (ET-24, ET-26)", () => {
  it.each([
    ["a loser in carto", { role: GEO_TWIN_ROLE.LOSER, inCarto: true }, true],
    ["a loser not in carto", { role: GEO_TWIN_ROLE.LOSER, inCarto: false }, false],
    ["a winner in carto", { role: GEO_TWIN_ROLE.WINNER, inCarto: true }, false],
    ["a keeper in carto", { role: GEO_TWIN_ROLE.KEEPER, inCarto: true }, false],
    ["a keeper not in carto", { role: GEO_TWIN_ROLE.KEEPER, inCarto: false }, false],
  ])("should be removable only for %s when it is a loser in carto", (_label, row, removable) => {
    expect(isGeoTwinRemovable(row)).toBe(removable);
  });
});

describe("accept keys of the geometric twin removals (ET-24)", () => {
  it("should add an accepted twin removal to twinRemovals only, leaving the other lists as they were", () => {
    const next = acceptanceAfter(acceptedWith({ plainRemovals: ["5001"] }), ANALYSIS, {
      list: EjesAcceptList.TWIN_REMOVALS,
      keys: ["7002"],
      accepted: true,
    });

    expect(next.twinRemovals).toEqual(["7002"]);
    expect(next.plainRemovals).toEqual(["5001"]);
    expect(next.splits).toEqual([]);
    expect(next.merges).toEqual([]);
  });

  it("should remove a rejected twin removal and keep the other accepted twin removals", () => {
    const next = acceptanceAfter(acceptedWith({ twinRemovals: ["7002", "7004"] }), ANALYSIS, {
      list: EjesAcceptList.TWIN_REMOVALS,
      keys: ["7002"],
      accepted: false,
    });

    expect(next.twinRemovals).toEqual(["7004"]);
  });

  it("should give the twin removals of the same analysis and none of another analysis", () => {
    const acceptance = acceptedWith({ twinRemovals: ["7002"] });

    expect(acceptKeysOf(acceptance, ANALYSIS).twinRemovals).toEqual(["7002"]);
    expect(acceptKeysOf(acceptance, "host|5432|gis|user|tables-b").twinRemovals).toEqual([]);
    expect(acceptKeysOf(null, ANALYSIS).twinRemovals).toEqual([]);
  });

  it("should send each accepted twin removal as its own ref in the request, next to the other lists", () => {
    const request = acceptedRequestOf({ splits: [], plainRemovals: ["5001"], merges: [], twinRemovals: ["7002", "7004"] });

    expect(request.twinRemovals).toEqual([{ ref: "7002" }, { ref: "7004" }]);
    expect(request.plainRemovals).toEqual([{ ref: "5001" }]);
  });

  it("should send no twin removal when none is accepted", () => {
    expect(acceptedRequestOf({ splits: [], plainRemovals: [], merges: [], twinRemovals: [] }).twinRemovals).toEqual([]);
  });
});
