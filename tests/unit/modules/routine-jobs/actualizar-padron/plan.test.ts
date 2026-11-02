import { describe, expect, it } from "vitest";
import {
  isPlanId,
  isPlanRecord,
  PLAN_TTL_MS,
  paramsFingerprintOf,
  usablePlanOf,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plan";
import type { AcceptedGeometry, ActualizarPadronParams, ActualizarPlanRecord, PairChoice } from "@/modules/routine-jobs/jobs/actualizar-padron/types";

const PLAN_ID = "0123456789abcdef0123456789abcdef";
const NOW_MS = Date.parse("2026-11-02T12:00:00.000Z");
const FINGERPRINT = "a".repeat(64);
const SPANISH_UNKNOWN = "El plan del análisis no existe: vuelva a analizar.";
const SPANISH_EXPIRED = "El plan del análisis caducó: vuelva a analizar.";
const SPANISH_PARAMS = "El plan del análisis corresponde a otros parámetros: vuelva a analizar.";

const CHOICE_A: PairChoice = { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "200", oldId: 7 };
const CHOICE_B: PairChoice = { typePadron: "RURAL", provinceId: 2, localityId: null, number: "300", oldId: null };

const paramsOf = (): ActualizarPadronParams => ({
  config: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "first-pw", schema_name: "", table_name: "" },
  stagingSchema: "stg",
  stagingTable: "padron_staging",
  cartoSchema: "carto",
  targetTable: "padron",
  provinceTable: "province",
  localityTable: "loc",
  typeTable: "tipo",
  addressMasterTable: "addresses_master",
  options: {
    localityType: "Localidad",
    tolerance: 1,
    geometryAreaThreshold: 0.05,
    updateGeometries: true,
    linkAddressMaster: true,
    pairChoices: [CHOICE_A, CHOICE_B],
  },
  dryRun: true,
  confirm: false,
});

const recordOf = (overrides: Partial<ActualizarPlanRecord> = {}): ActualizarPlanRecord => ({
  planId: PLAN_ID,
  paramsFingerprint: FINGERPRINT,
  createdAt: new Date(NOW_MS - 1000).toISOString(),
  expiresAt: new Date(NOW_MS + PLAN_TTL_MS).toISOString(),
  dataFingerprint: { targetRows: 5, targetMaxId: 5, stagingCandidates: 4, digest: "d41d8cd98f00b204e9800998ecf8427e" },
  expected: { inserted: 1, updates: 1, pairs: 0 },
  pendingGeometryChanges: [],
  ...overrides,
});

describe("paramsFingerprintOf (AP-89)", () => {
  it("should return a 64 character lowercase hex SHA-256 for the request parameters", () => {
    expect(paramsFingerprintOf(paramsOf())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should return the same fingerprint when only the password changes", () => {
    const changed = paramsOf();
    changed.config.password = "second-pw";

    expect(paramsFingerprintOf(changed)).toBe(paramsFingerprintOf(paramsOf()));
  });

  it("should return the same fingerprint when only the write flags change", () => {
    const changed = { ...paramsOf(), dryRun: false, confirm: true };

    expect(paramsFingerprintOf(changed)).toBe(paramsFingerprintOf(paramsOf()));
  });

  it("should return the same fingerprint when the pair choices come in another order", () => {
    const reversed = paramsOf();
    reversed.options.pairChoices = [CHOICE_B, CHOICE_A];

    expect(paramsFingerprintOf(reversed)).toBe(paramsFingerprintOf(paramsOf()));
  });

  it("should return the same fingerprint when the host differs only in case or surrounding spaces", () => {
    const spaced = paramsOf();
    spaced.config.host = "  DB.LOCAL ";

    expect(paramsFingerprintOf(spaced)).toBe(paramsFingerprintOf(paramsOf()));
  });

  it.each([
    ["host", (p: ActualizarPadronParams) => (p.config.host = "other.local")],
    ["port", (p: ActualizarPadronParams) => (p.config.port = "5433")],
    ["database name", (p: ActualizarPadronParams) => (p.config.db_name = "otra")],
    ["user", (p: ActualizarPadronParams) => (p.config.user = "otro_user")],
    ["staging schema", (p: ActualizarPadronParams) => (p.stagingSchema = "stg2")],
    ["staging table", (p: ActualizarPadronParams) => (p.stagingTable = "otra_staging")],
    ["carto schema", (p: ActualizarPadronParams) => (p.cartoSchema = "carto2")],
    ["target table", (p: ActualizarPadronParams) => (p.targetTable = "padron2")],
    ["province table", (p: ActualizarPadronParams) => (p.provinceTable = "province2")],
    ["locality table", (p: ActualizarPadronParams) => (p.localityTable = "loc2")],
    ["type table", (p: ActualizarPadronParams) => (p.typeTable = "tipo2")],
    ["address master table", (p: ActualizarPadronParams) => (p.addressMasterTable = "addresses2")],
    ["locality type", (p: ActualizarPadronParams) => (p.options.localityType = "Paraje")],
    ["tolerance", (p: ActualizarPadronParams) => (p.options.tolerance = 2)],
    ["geometry area threshold", (p: ActualizarPadronParams) => (p.options.geometryAreaThreshold = 0.1)],
    ["updateGeometries", (p: ActualizarPadronParams) => (p.options.updateGeometries = false)],
    ["linkAddressMaster", (p: ActualizarPadronParams) => (p.options.linkAddressMaster = false)],
    ["pair choices content", (p: ActualizarPadronParams) => (p.options.pairChoices = [CHOICE_A])],
    ["pair choice oldId", (p: ActualizarPadronParams) => (p.options.pairChoices = [{ ...CHOICE_A, oldId: 8 }, CHOICE_B])],
  ])("should return a different fingerprint when the %s changes", (_name, mutate) => {
    const changed = paramsOf();
    mutate(changed);

    expect(paramsFingerprintOf(changed)).not.toBe(paramsFingerprintOf(paramsOf()));
  });

  it("should return a stable fingerprint with no pair choices that differs from the one with choices", () => {
    const none = paramsOf();
    none.options.pairChoices = [];
    const noneAgain = paramsOf();
    noneAgain.options.pairChoices = [];

    expect(paramsFingerprintOf(none)).toBe(paramsFingerprintOf(noneAgain));
    expect(paramsFingerprintOf(none)).not.toBe(paramsFingerprintOf(paramsOf()));
  });
});

describe("paramsFingerprintOf and the accepted geometries (AP-100)", () => {
  const ACCEPT_ONE: AcceptedGeometry = { typePadron: "URBANO", provinceId: 1, localityId: 10, number: "200" };
  const ACCEPT_TWO: AcceptedGeometry = { typePadron: "RURAL", provinceId: 2, localityId: null, number: "300" };

  const withAccepts = (acceptedGeometries: AcceptedGeometry[] | undefined): ActualizarPadronParams => {
    const params = paramsOf();
    params.options = { ...params.options, acceptedGeometries };
    return params;
  };

  it("should return a different fingerprint when one accepted geometry is added to the request", () => {
    expect(paramsFingerprintOf(withAccepts([ACCEPT_ONE]))).not.toBe(paramsFingerprintOf(withAccepts([])));
  });

  it("should return the same fingerprint when the accepted geometries come in another order", () => {
    expect(paramsFingerprintOf(withAccepts([ACCEPT_ONE, ACCEPT_TWO]))).toBe(
      paramsFingerprintOf(withAccepts([ACCEPT_TWO, ACCEPT_ONE])),
    );
  });

  it("should return the same fingerprint when the accepted geometries are absent or an empty list", () => {
    expect(paramsFingerprintOf(withAccepts(undefined))).toBe(paramsFingerprintOf(withAccepts([])));
  });

  it("should return a different fingerprint when an accepted number changes", () => {
    const changed = { ...ACCEPT_ONE, number: "201" };

    expect(paramsFingerprintOf(withAccepts([changed]))).not.toBe(paramsFingerprintOf(withAccepts([ACCEPT_ONE])));
  });

  it("should return a different fingerprint when an accepted locality changes, since the locality is part of the key", () => {
    const changed = { ...ACCEPT_ONE, localityId: 11 };

    expect(paramsFingerprintOf(withAccepts([changed]))).not.toBe(paramsFingerprintOf(withAccepts([ACCEPT_ONE])));
  });
});

describe("usablePlanOf (AP-90)", () => {
  it("should return the record when it matches the parameters and has not expired", () => {
    const record = recordOf();

    expect(usablePlanOf(record, FINGERPRINT, NOW_MS)).toBe(record);
  });

  it("should refuse with the unknown-plan message when no record exists", () => {
    expect(() => usablePlanOf(undefined, FINGERPRINT, NOW_MS)).toThrow(SPANISH_UNKNOWN);
  });

  it("should refuse with the expired message when the clock reaches expiresAt exactly", () => {
    const record = recordOf({ expiresAt: new Date(NOW_MS).toISOString() });

    expect(() => usablePlanOf(record, FINGERPRINT, NOW_MS)).toThrow(SPANISH_EXPIRED);
  });

  it("should accept the record one millisecond before expiresAt", () => {
    const record = recordOf({ expiresAt: new Date(NOW_MS + 1).toISOString() });

    expect(usablePlanOf(record, FINGERPRINT, NOW_MS)).toBe(record);
  });

  it("should refuse with the parameters message when the fingerprint differs", () => {
    expect(() => usablePlanOf(recordOf(), "b".repeat(64), NOW_MS)).toThrow(SPANISH_PARAMS);
  });

  it("should check the expiry before the parameters, so an expired plan reports expiry", () => {
    const record = recordOf({ expiresAt: new Date(NOW_MS - 1).toISOString() });

    expect(() => usablePlanOf(record, "b".repeat(64), NOW_MS)).toThrow(SPANISH_EXPIRED);
  });
});

describe("isPlanId and isPlanRecord (AP-89)", () => {
  it.each([
    { name: "32 lowercase hex characters", value: PLAN_ID, expected: true },
    { name: "uppercase hex", value: PLAN_ID.toUpperCase(), expected: false },
    { name: "31 characters", value: PLAN_ID.slice(1), expected: false },
    { name: "33 characters", value: `${PLAN_ID}0`, expected: false },
    { name: "a path traversal", value: "../../etc/passwd", expected: false },
    { name: "an empty string", value: "", expected: false },
    { name: "a number", value: 42, expected: false },
    { name: "undefined", value: undefined, expected: false },
  ])("should return $expected for a plan id of $name", ({ value, expected }) => {
    expect(isPlanId(value)).toBe(expected);
  });

  it("should accept a record with the full plan shape", () => {
    expect(isPlanRecord(recordOf())).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "not a record"],
    ["a record without the digest", { ...recordOf(), dataFingerprint: { targetRows: 5, targetMaxId: 5, stagingCandidates: 4 } }],
    ["a record whose expected counts are text", { ...recordOf(), expected: { inserted: "1", updates: 1, pairs: 0 } }],
    ["a record whose plan id is malformed", { ...recordOf(), planId: "short" }],
    ["a record without an expiry", { ...recordOf(), expiresAt: undefined }],
  ])("should reject %s as a plan record", (_name, value) => {
    expect(isPlanRecord(value)).toBe(false);
  });
});
