import { randomUUID } from "node:crypto";
import { readFile, utimes } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { START_MARKER_FRESH_MS } from "@/modules/coverage-loads/shp/job/constants.ts";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { claimStartMarker, isStartMarkerFresh, releaseStartMarker } from "@/modules/coverage-loads/shp/job/startMarker.ts";
import { createTmpRoots, exists, makeJob } from "../helpers/jobTestEnv.ts";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const NOW = Date.parse("2026-05-01T12:00:00.000Z");

async function setMarkerAge(root: string, jobId: string, ageMs: number): Promise<void> {
  const when = new Date(NOW - ageMs);
  await utimes(jobPaths(root, jobId).startLock, when, when);
}

describe("claimStartMarker", () => {
  it("should create start.lock with the claim time and return true on the first claim", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root);

    const claimed = await claimStartMarker(root, jobId, NOW);

    expect(claimed).toBe(true);
    expect(await readFile(jobPaths(root, jobId).startLock, "utf8")).toBe(new Date(NOW).toISOString());
  });

  it("should return false and keep the first marker when a second claim follows", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root);
    await claimStartMarker(root, jobId, NOW);

    const second = await claimStartMarker(root, jobId, NOW + 5000);

    expect(second).toBe(false);
    expect(await readFile(jobPaths(root, jobId).startLock, "utf8")).toBe(new Date(NOW).toISOString());
  });

  it("should let exactly one of several concurrent claims win", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root);

    const results = await Promise.all(Array.from({ length: 8 }, () => claimStartMarker(root, jobId, NOW)));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("should allow a new claim after the marker was released", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root);
    await claimStartMarker(root, jobId, NOW);
    await releaseStartMarker(root, jobId);

    expect(await claimStartMarker(root, jobId, NOW)).toBe(true);
  });

  it("should reject (not report false) when the job folder does not exist", async () => {
    const root = await roots.create();

    await expect(claimStartMarker(root, randomUUID(), NOW)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("should reject an invalid job id", async () => {
    const root = await roots.create();

    await expect(claimStartMarker(root, "../evil", NOW)).rejects.toThrow();
  });
});

describe("releaseStartMarker", () => {
  it("should remove an existing marker", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root);
    await claimStartMarker(root, jobId, NOW);

    await releaseStartMarker(root, jobId);

    expect(await exists(jobPaths(root, jobId).startLock)).toBe(false);
  });

  it("should not throw when there is no marker or no job folder", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root);

    await expect(releaseStartMarker(root, jobId)).resolves.toBeUndefined();
    await expect(releaseStartMarker(root, randomUUID())).resolves.toBeUndefined();
  });
});

describe("isStartMarkerFresh", () => {
  it("should be false when there is no marker", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root);

    expect(await isStartMarkerFresh(root, jobId, NOW)).toBe(false);
  });

  it("should be false when the job folder does not exist", async () => {
    const root = await roots.create();

    expect(await isStartMarkerFresh(root, randomUUID(), NOW)).toBe(false);
  });

  it("should be true for a marker younger than the freshness window", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root);
    await claimStartMarker(root, jobId, NOW);
    await setMarkerAge(root, jobId, 1000);

    expect(await isStartMarkerFresh(root, jobId, NOW)).toBe(true);
  });

  it("should be true exactly at the freshness window and false one millisecond later", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root);
    await claimStartMarker(root, jobId, NOW);

    await setMarkerAge(root, jobId, START_MARKER_FRESH_MS);
    expect(await isStartMarkerFresh(root, jobId, NOW)).toBe(true);

    await setMarkerAge(root, jobId, START_MARKER_FRESH_MS + 1000);
    expect(await isStartMarkerFresh(root, jobId, NOW)).toBe(false);
  });

  it("should be false again once the marker is released", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root);
    await claimStartMarker(root, jobId, NOW);
    await setMarkerAge(root, jobId, 0);
    await releaseStartMarker(root, jobId);

    expect(await isStartMarkerFresh(root, jobId, NOW)).toBe(false);
  });
});
