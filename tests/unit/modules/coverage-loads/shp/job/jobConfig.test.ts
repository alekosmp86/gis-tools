import { describe, expect, it } from "vitest";
import { parseJobConfig } from "@/modules/coverage-loads/shp/job/jobConfig.ts";
import { CANARY_CONNECTION, CANARY_DB, CANARY_HOST, CANARY_PASSWORD, CANARY_USER } from "../helpers/jobTestEnv.ts";

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { jobId: JOB_ID, mode: "LOAD", pipeline: "fake", fake: { stageMs: 10 }, connection: { ...CANARY_CONNECTION }, ...overrides };
}

function parse(value: unknown) {
  return parseJobConfig(JSON.stringify(value));
}

function expectRejected(value: unknown, field: string): void {
  const result = parse(value);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.message).toBe(`Configuración inválida: ${field}.`);
  for (const canary of [CANARY_PASSWORD, CANARY_HOST, CANARY_USER, CANARY_DB]) expect(result.message).not.toContain(canary);
}

describe("parseJobConfig valid input", () => {
  it("should accept a complete fake config", () => {
    const result = parse(valid());

    expect(result).toEqual({
      ok: true,
      config: { jobId: JOB_ID, mode: "LOAD", pipeline: "fake", fake: { stageMs: 10 }, connection: CANARY_CONNECTION },
    });
  });

  it("should accept TEST mode and a real pipeline without a fake section", () => {
    const result = parse(valid({ mode: "TEST", pipeline: "real", fake: undefined }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toMatchObject({ mode: "TEST", pipeline: "real" });
  });

  it("should accept an empty password but not other empty connection fields", () => {
    expect(parse(valid({ connection: { ...CANARY_CONNECTION, password: "" } })).ok).toBe(true);
    expectRejected(valid({ connection: { ...CANARY_CONNECTION, host: "" } }), "connection");
  });

  it("should keep optional rootDir, secretsToScrub and all four timing overrides", () => {
    const timing = { heartbeatMs: 20, cancelPollMs: 25, hardKillGraceMs: 300, progressThrottleMs: 5 };
    const result = parse(valid({ rootDir: "/tmp/x", secretsToScrub: ["s1", "s2"], timing }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toMatchObject({ rootDir: "/tmp/x", secretsToScrub: ["s1", "s2"], timing });
  });

  it("should accept partial timing and per-stage stageMs, failAtStage, holdStage and ignoreCancel", () => {
    const fake = { stageMs: { READING: 5 }, failAtStage: "STAGING", holdStage: "REPAIRING", ignoreCancel: true };
    const result = parse(valid({ timing: { heartbeatMs: 10 }, fake }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.timing).toEqual({ heartbeatMs: 10 });
      expect(result.config.fake).toEqual(fake);
    }
  });
});

describe("parseJobConfig rejections", () => {
  it.each([
    ["JSON mal formado", "{not json"],
    ["JSON mal formado", ""],
  ])("should reject malformed text with %s without echoing it", (_m, text) => {
    const result = parseJobConfig(text);
    expect(result).toEqual({ ok: false, message: "Configuración inválida: JSON mal formado." });
  });

  it("should not echo malformed text containing a secret", () => {
    const result = parseJobConfig(`{"password":"${CANARY_PASSWORD}"`);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain(CANARY_PASSWORD);
  });

  it.each([["null"], ["[]"], ['"str"'], ["5"]])("should reject non-object JSON %s", (text) => {
    expect(parseJobConfig(text)).toEqual({ ok: false, message: "Configuración inválida: se esperaba un objeto." });
  });

  it.each([["../evil"], [""], [5], [null], ["123E4567-E89B-42D3-A456-426614174000"]])("should reject a bad jobId %j", (jobId) => {
    expectRejected(valid({ jobId }), "jobId");
  });

  it.each([["load"], ["DELETE"], [null], [1]])("should reject a bad mode %j", (mode) => {
    expectRejected(valid({ mode }), "mode");
  });

  it.each([["FAKE"], ["other"], [undefined], [true]])("should reject a bad pipeline %j", (pipeline) => {
    expectRejected(valid({ pipeline }), "pipeline");
  });

  it("should reject pipeline fake without a fake section", () => {
    expectRejected(valid({ fake: undefined }), "fake");
  });

  it.each([
    ["not an object", 5],
    ["missing stageMs", {}],
    ["negative stageMs", { stageMs: -1 }],
    ["zero stageMs", { stageMs: 0 }],
    ["string stageMs", { stageMs: "10" }],
    ["bad per-stage value", { stageMs: { READING: "x" } }],
    ["unknown failAtStage", { stageMs: 1, failAtStage: "NOPE" }],
    ["unknown holdStage", { stageMs: 1, holdStage: 3 }],
    ["non-boolean ignoreCancel", { stageMs: 1, ignoreCancel: "yes" }],
  ])("should reject an invalid fake section: %s", (_name, fake) => {
    expectRejected(valid({ fake }), "fake");
  });

  it.each([
    ["missing connection", undefined],
    ["non-object connection", "x"],
    ["array connection", []],
    ["missing host", { ...CANARY_CONNECTION, host: undefined }],
    ["missing db_name", { ...CANARY_CONNECTION, db_name: undefined }],
    ["missing user", { ...CANARY_CONNECTION, user: undefined }],
    ["missing password", { ...CANARY_CONNECTION, password: undefined }],
    ["numeric password", { ...CANARY_CONNECTION, password: 12345 }],
    ["numeric host", { ...CANARY_CONNECTION, host: 5 }],
    ["string port", { ...CANARY_CONNECTION, port: "5432" }],
    ["zero port", { ...CANARY_CONNECTION, port: 0 }],
    ["port too large", { ...CANARY_CONNECTION, port: 65536 }],
    ["fractional port", { ...CANARY_CONNECTION, port: 54.5 }],
  ])("should reject an invalid connection: %s and never echo values", (_name, connection) => {
    expectRejected(valid({ connection }), "connection");
  });

  it("should accept the extreme valid ports 1 and 65535", () => {
    expect(parse(valid({ connection: { ...CANARY_CONNECTION, port: 1 } })).ok).toBe(true);
    expect(parse(valid({ connection: { ...CANARY_CONNECTION, port: 65535 } })).ok).toBe(true);
  });

  it.each([
    ["not an object", 5],
    ["negative", { heartbeatMs: -1 }],
    ["zero", { cancelPollMs: 0 }],
    ["string", { hardKillGraceMs: "100" }],
    ["NaN as null", { progressThrottleMs: null }],
  ])("should reject invalid timing: %s", (_name, timing) => {
    expectRejected(valid({ timing }), "timing");
  });

  it.each([
    ["empty rootDir", { rootDir: "" }, "rootDir"],
    ["non-string rootDir", { rootDir: 5 }, "rootDir"],
    ["non-array secretsToScrub", { secretsToScrub: "a" }, "secretsToScrub"],
    ["non-string entries in secretsToScrub", { secretsToScrub: ["a", 1] }, "secretsToScrub"],
  ])("should reject %s", (_name, extra, field) => {
    expectRejected(valid(extra), field);
  });

  it("should never include any connection canary in any rejection message", () => {
    const attempts = [
      valid({ jobId: CANARY_PASSWORD }),
      valid({ mode: CANARY_HOST }),
      valid({ pipeline: CANARY_USER }),
      valid({ connection: { ...CANARY_CONNECTION, port: CANARY_PASSWORD } }),
      valid({ secretsToScrub: [CANARY_PASSWORD, 1] }),
      valid({ timing: { heartbeatMs: CANARY_PASSWORD } }),
    ];

    for (const attempt of attempts) {
      const result = parse(attempt);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        for (const canary of [CANARY_PASSWORD, CANARY_HOST, CANARY_USER, CANARY_DB]) expect(result.message).not.toContain(canary);
      }
    }
  });
});
