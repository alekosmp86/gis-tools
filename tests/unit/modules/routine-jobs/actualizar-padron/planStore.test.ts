import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_TTL_MS } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plan";
import type { PlanSnapshot } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import {
  readPlanRecord,
  removePlanRecord,
  savePlanRecord,
} from "@/modules/routine-jobs/jobs/actualizar-padron/services/planStore";

/* The plan folder lives under os.tmpdir(): the default export is redirected to a fresh temp root per test. */
const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const PARAMS_FINGERPRINT = "c".repeat(64);
const NOW_MS = Date.now();
const PLAN_ID_PATTERN = /^[0-9a-f]{32}$/;
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

const SNAPSHOT: PlanSnapshot = {
  dataFingerprint: { targetRows: 5, targetMaxId: 5, stagingCandidates: 4, digest: "0123abcd" },
  expected: { inserted: 1, updates: 2, pairs: 0 },
};

const plansDirectory = (): string => path.join(tempRoot.directory, "gis-tools-routine-jobs", "plans");
const planFileOf = (planId: string): string => path.join(plansDirectory(), `${planId}.json`);

beforeEach(async () => {
  tempRoot.directory = await mkdtemp(path.join(tmpdir(), "gis-plan-store-"));
});

afterEach(async () => {
  await rm(tempRoot.directory, { recursive: true, force: true });
});

describe("planStore save and read (AP-89)", () => {
  it("should save a plan under a 32 hex id and read back the same fingerprint and expected counts", async () => {
    const planId = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);

    const record = await readPlanRecord(planId);

    expect(planId).toMatch(PLAN_ID_PATTERN);
    expect(record).toMatchObject({
      planId,
      paramsFingerprint: PARAMS_FINGERPRINT,
      dataFingerprint: SNAPSHOT.dataFingerprint,
      expected: SNAPSHOT.expected,
      createdAt: new Date(NOW_MS).toISOString(),
      expiresAt: new Date(NOW_MS + PLAN_TTL_MS).toISOString(),
    });
  });

  it("should write only the plan fields to the file, so no password or connection value is stored", async () => {
    const planId = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);

    const stored = JSON.parse(await readFile(planFileOf(planId), "utf8")) as Record<string, unknown>;

    expect(Object.keys(stored).sort()).toEqual(
      ["createdAt", "dataFingerprint", "expected", "expiresAt", "paramsFingerprint", "pendingGeometryChanges", "planId"].sort()
    );
  });

  it("should give two saved analyses two different ids", async () => {
    const first = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);
    const second = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);

    expect(first).not.toBe(second);
    expect(await readdir(plansDirectory())).toHaveLength(2);
  });

  it.each([
    { name: "an unknown well-formed id", planId: "f".repeat(32) },
    { name: "a path traversal", planId: "../../secret" },
    { name: "an uppercase id", planId: "A".repeat(32) },
    { name: "an empty string", planId: "" },
  ])("should return undefined for $name", async ({ planId }) => {
    expect(await readPlanRecord(planId)).toBeUndefined();
  });

  it("should return undefined for a plan file whose content is not JSON", async () => {
    const planId = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);
    await writeFile(planFileOf(planId), "{ truncated", "utf8");

    expect(await readPlanRecord(planId)).toBeUndefined();
  });

  it("should return undefined for a plan file that is valid JSON but not a plan record", async () => {
    const planId = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);
    await writeFile(planFileOf(planId), JSON.stringify({ planId, expected: "none" }), "utf8");

    expect(await readPlanRecord(planId)).toBeUndefined();
  });

  it("should return undefined for an empty plan file", async () => {
    const planId = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);
    await writeFile(planFileOf(planId), "", "utf8");

    expect(await readPlanRecord(planId)).toBeUndefined();
  });
});

describe("planStore remove (AP-89, single use)", () => {
  it("should remove the plan file so the id is unknown afterwards", async () => {
    const planId = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);

    await removePlanRecord(planId);

    expect(await readPlanRecord(planId)).toBeUndefined();
    expect(await readdir(plansDirectory())).toEqual([]);
  });

  it("should not fail when the plan is already gone or the id is malformed", async () => {
    await expect(removePlanRecord("f".repeat(32))).resolves.toBeUndefined();
    await expect(removePlanRecord("../../secret")).resolves.toBeUndefined();
  });

  it("should leave the other plans in place when one plan is removed", async () => {
    const kept = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);
    const removed = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);

    await removePlanRecord(removed);

    expect(await readPlanRecord(kept)).toBeDefined();
    expect(await readPlanRecord(removed)).toBeUndefined();
  });
});

describe("planStore expiry (AP-89, three day retention)", () => {
  it("should remove plan files older than the TTL when a new plan is saved", async () => {
    const stale = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);
    const staleTime = new Date(NOW_MS - FOUR_DAYS_MS);
    await utimes(planFileOf(stale), staleTime, staleTime);

    const fresh = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);

    expect(await readdir(plansDirectory())).toEqual([`${fresh}.json`]);
  });

  it("should keep a plan file that is younger than the TTL when a new plan is saved", async () => {
    const young = await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);
    const youngTime = new Date(NOW_MS - (PLAN_TTL_MS - 60_000));
    await utimes(planFileOf(young), youngTime, youngTime);

    await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);

    expect(await readPlanRecord(young)).toBeDefined();
  });

  it("should ignore a stale file that is not a plan file when saving", async () => {
    await mkdir(plansDirectory(), { recursive: true });
    const notes = path.join(plansDirectory(), "notes.txt");
    await writeFile(notes, "no es un plan", "utf8");
    const staleTime = new Date(NOW_MS - FOUR_DAYS_MS);
    await utimes(notes, staleTime, staleTime);

    await savePlanRecord(PARAMS_FINGERPRINT, SNAPSHOT, [], NOW_MS);

    expect(await readdir(plansDirectory())).toContain("notes.txt");
  });
});
