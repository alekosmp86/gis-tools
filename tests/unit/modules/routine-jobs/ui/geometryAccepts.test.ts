import { describe, expect, it } from "vitest";
import { GEOMETRY_STATE } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { PadronGeometryChange } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import {
  acceptKeySetOf,
  acceptOfGeometryChange,
  GEOMETRY_DECISION_LABEL,
  GeometryDecisionState,
  geometryDecisionStateOf,
  isDecidableGeometry,
  reviewableGeometryChangesOf,
  sameAccepts,
} from "@/modules/routine-jobs/ui/geometryAccepts";

const KEY_200 = { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "200" };
const KEY_501 = { typePadron: "RURAL", provinceId: 1, localityId: null, number: "501" };

const changeOf = (overrides: Partial<PadronGeometryChange> = {}): PadronGeometryChange => ({
  typePadron: "URBANO",
  provinceId: 1,
  localityId: 10,
  number: "200",
  department: "MONTEVIDEO",
  locality: "CENTRO",
  oldId: 7,
  state: GEOMETRY_STATE.PENDING,
  oldAreaM2: 10000,
  newAreaM2: 10700,
  areaChangePct: 6.5,
  centroidLat: -34.9,
  centroidLon: -56.2,
  ...overrides,
});

const NONE: ReadonlySet<string> = new Set<string>();
const ACCEPTED_200: ReadonlySet<string> = acceptKeySetOf([KEY_200]);

describe("geometry decision labels (AP-100)", () => {
  it("should label each decision state with its Spanish text", () => {
    expect(GEOMETRY_DECISION_LABEL).toEqual({
      ACCEPTED: "Aceptada",
      PENDING: "Pendiente",
      REJECTED: "Rechazada",
      APPLIED: "Aplicada (bajo el umbral)",
    });
  });
});

describe("acceptOfGeometryChange", () => {
  it("should return the new key of a URBANO change with its locality", () => {
    expect(acceptOfGeometryChange(changeOf())).toEqual(KEY_200);
  });

  it("should return the new key of a RURAL change with a null locality", () => {
    expect(acceptOfGeometryChange(changeOf({ typePadron: "RURAL", localityId: null, number: "501" }))).toEqual(KEY_501);
  });

  it.each([
    ["no province", { provinceId: null }],
    ["no number", { number: null }],
    ["a blank number", { number: "  " }],
    ["no padron type", { typePadron: null }],
  ])("should return null for a change with %s, because no key can be accepted", (_label, overrides) => {
    expect(acceptOfGeometryChange(changeOf(overrides))).toBeNull();
  });
});

describe("geometryDecisionStateOf", () => {
  it("should return ACCEPTED when the current selection accepts the key of a pending change", () => {
    expect(geometryDecisionStateOf(changeOf(), ACCEPTED_200, NONE)).toBe(GeometryDecisionState.ACCEPTED);
  });

  it("should return ACCEPTED when the key is in the current acceptances, even though the shown run applied the change", () => {
    expect(geometryDecisionStateOf(changeOf({ state: GEOMETRY_STATE.APPLIED }), ACCEPTED_200, NONE)).toBe(GeometryDecisionState.ACCEPTED);
  });

  it("should return PENDING for a pending change nobody accepted", () => {
    expect(geometryDecisionStateOf(changeOf(), NONE, NONE)).toBe(GeometryDecisionState.PENDING);
  });

  it("should return REJECTED for a change the shown run applied because it was accepted, once the acceptance is removed", () => {
    const applied = changeOf({ state: GEOMETRY_STATE.APPLIED });

    expect(geometryDecisionStateOf(applied, NONE, ACCEPTED_200)).toBe(GeometryDecisionState.REJECTED);
  });

  it("should return APPLIED for a change applied by the threshold, with nothing accepted or submitted for it", () => {
    expect(geometryDecisionStateOf(changeOf({ state: GEOMETRY_STATE.APPLIED }), NONE, NONE)).toBe(GeometryDecisionState.APPLIED);
  });

  it("should return PENDING, not APPLIED, for a pending change with no usable key", () => {
    expect(geometryDecisionStateOf(changeOf({ provinceId: null }), NONE, NONE)).toBe(GeometryDecisionState.PENDING);
  });

  it("should return APPLIED for an applied change with no usable key, since nothing can be accepted or rejected", () => {
    expect(geometryDecisionStateOf(changeOf({ provinceId: null, state: GEOMETRY_STATE.APPLIED }), ACCEPTED_200, ACCEPTED_200)).toBe(
      GeometryDecisionState.APPLIED,
    );
  });
});

describe("isDecidableGeometry", () => {
  it("should be decidable when the change is pending and has a key", () => {
    expect(isDecidableGeometry(GeometryDecisionState.PENDING, changeOf())).toBe(true);
  });

  it("should be decidable when the shown run applied it because it was accepted", () => {
    expect(isDecidableGeometry(GeometryDecisionState.REJECTED, changeOf({ state: GEOMETRY_STATE.APPLIED }))).toBe(true);
  });

  it("should not be decidable when the threshold applied it, since there is nothing to decide", () => {
    expect(isDecidableGeometry(GeometryDecisionState.APPLIED, changeOf({ state: GEOMETRY_STATE.APPLIED }))).toBe(false);
  });

  it("should not be decidable when the pending change has no key to send", () => {
    expect(isDecidableGeometry(GeometryDecisionState.PENDING, changeOf({ provinceId: null }))).toBe(false);
  });
});

describe("sameAccepts", () => {
  it("should be true for the same accepted keys listed in another order", () => {
    expect(sameAccepts([KEY_200, KEY_501], [KEY_501, KEY_200])).toBe(true);
  });

  it("should be true for two empty lists", () => {
    expect(sameAccepts([], [])).toBe(true);
  });

  it("should be false when one list holds an extra accepted key", () => {
    expect(sameAccepts([KEY_200, KEY_501], [KEY_200])).toBe(false);
  });

  it("should be false when the same count holds a different number", () => {
    expect(sameAccepts([KEY_200], [{ ...KEY_200, number: "201" }])).toBe(false);
  });
});

describe("reviewableGeometryChangesOf", () => {
  it("should keep pending rows and drop the rows the threshold applied alone", () => {
    const pending = changeOf({ number: "200" });
    const applied = changeOf({ number: "300", state: GEOMETRY_STATE.APPLIED });

    expect(reviewableGeometryChangesOf([pending, applied], NONE, NONE)).toEqual([pending]);
  });

  it("should keep an applied row the user accepted, so the acceptance can still be undone", () => {
    const acceptedApplied = changeOf({ state: GEOMETRY_STATE.APPLIED });

    expect(reviewableGeometryChangesOf([acceptedApplied], ACCEPTED_200, ACCEPTED_200)).toEqual([acceptedApplied]);
  });

  it("should keep an applied row whose acceptance was removed since the shown run", () => {
    const rejected = changeOf({ state: GEOMETRY_STATE.APPLIED });

    expect(reviewableGeometryChangesOf([rejected], NONE, ACCEPTED_200)).toEqual([rejected]);
  });
});
