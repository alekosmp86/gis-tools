import { describe, expect, it, vi } from "vitest";
import { readEjesCallesSplitPoints } from "@/modules/routine-jobs/api/ejesSplitPoints";
import { parseEjesSplitPointsRequest } from "@/modules/routine-jobs/api/ejesSplitPointsRequestParsing";
import { getEjesReviewStore, withReviewRetention } from "@/modules/routine-jobs/api/ejesReviewStore";
import { RequestInvalidError } from "@/modules/routine-jobs/api/requestParsing";
import { EJES_SPLIT_POINTS_ROLES, SPLIT_POINTS_PAGE_LIMIT, SPLIT_REVIEW_GONE_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesResult, EjesReviewStore, EjesStoredReviewPoint } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { readEjesSplitPoints } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesSplitPoints";
import type { JobStore } from "@/modules/routine-jobs/jobs/shared/jobStore";
import type { RunDeps } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import { ejesTablesBody } from "../ejes-calles/ejesFixtures";

const PASSWORD = "Split-Points-pw!9";

const bodyWith = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
  tables: ejesTablesBody(),
  jobId: "job-1",
  oldRef: "6001",
  ...overrides,
});

const parse = (overrides: Record<string, unknown> = {}) => parseEjesSplitPointsRequest(bodyWith(overrides));

const STORED_POINT: EjesStoredReviewPoint = {
  oldRef: "6001",
  pointId: "11",
  reason: "ambiguous",
  suggestedRef: "6002",
  candidates: [{ newRef: "6002", distance: 0 }],
};

describe("parseEjesSplitPointsRequest (EJS-6, EJ-13)", () => {
  it("should keep only the four tables the review reads, whatever else the body carries", () => {
    const params = parse();

    expect(Object.keys(params.tables).sort()).toEqual([...EJES_SPLIT_POINTS_ROLES].sort());
  });

  it("should carry the job id and the old reftramo in canonical text", () => {
    const params = parse({ oldRef: "0012" });

    expect(params.jobId).toBe("job-1");
    expect(params.oldRef).toBe("12");
  });

  it("should accept a negative integer old reftramo as its canonical text", () => {
    expect(parse({ oldRef: "-5" }).oldRef).toBe("-5");
  });

  it("should accept the largest int4 old reftramo and refuse the one above it (boundary)", () => {
    expect(parse({ oldRef: "2147483647" }).oldRef).toBe("2147483647");
    expect(() => parse({ oldRef: "2147483648" })).toThrow(RequestInvalidError);
  });

  it.each([
    ["a non-integer text", "abc"],
    ["a decimal", "1.5"],
    ["an empty string", ""],
  ])("should refuse an old reftramo that is %s with a 400", (_label, oldRef) => {
    expect(() => parse({ oldRef })).toThrow(RequestInvalidError);
  });

  it("should refuse a request without the job id with a 400", () => {
    const body = bodyWith();
    delete body.jobId;

    expect(() => parseEjesSplitPointsRequest(body)).toThrow(RequestInvalidError);
  });

  it("should default the window to offset 0 and the page limit", () => {
    const params = parse();

    expect(params.offset).toBe(0);
    expect(params.limit).toBe(SPLIT_POINTS_PAGE_LIMIT);
  });

  it.each([
    ["a negative offset", { offset: -1 }],
    ["a fractional offset", { offset: 1.5 }],
    ["a limit of zero", { limit: 0 }],
    ["a limit above the page limit", { limit: SPLIT_POINTS_PAGE_LIMIT + 1 }],
    ["a text limit", { limit: "10" }],
  ])("should refuse %s with a 400", (_label, window) => {
    expect(() => parse(window)).toThrow(RequestInvalidError);
  });

  it("should accept the page limit exactly (boundary)", () => {
    expect(parse({ limit: SPLIT_POINTS_PAGE_LIMIT }).limit).toBe(SPLIT_POINTS_PAGE_LIMIT);
  });
});

describe("readEjesSplitPoints for a dry run that is no longer kept (EJS-6)", () => {
  it("should return null for an unknown job id, without opening a session", async () => {
    const openSession = vi.fn();
    const reviews: EjesReviewStore = { retain: vi.fn(), read: () => undefined };
    const deps = { openSession, now: () => 0 } as unknown as RunDeps;

    const page = await readEjesSplitPoints(parse(), deps, reviews);

    expect(page).toBeNull();
    expect(openSession).not.toHaveBeenCalled();
  });

  it("should return an empty page without a database read when the split has no stored point", async () => {
    const openSession = vi.fn();
    const reviews: EjesReviewStore = { retain: vi.fn(), read: () => [STORED_POINT] };
    const deps = { openSession, now: () => 0 } as unknown as RunDeps;

    const page = await readEjesSplitPoints({ ...parse({ oldRef: "9999" }) }, deps, reviews);

    expect(page?.total).toBe(0);
    expect(page?.points).toEqual([]);
    expect(openSession).not.toHaveBeenCalled();
  });
});

describe("readEjesCallesSplitPoints handler (EJS-6)", () => {
  it("should answer 400 with the gone message when the dry run of the job id is no longer kept", async () => {
    const request = new Request("http://localhost/api/m/ejes-calles/split-points", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyWith({ jobId: "job-never-kept-endpoint" })),
    });
    const deps = { openSession: async () => Promise.reject(new Error("must not open")), now: () => 0 } as unknown as RunDeps;

    const response = await readEjesCallesSplitPoints(request, deps);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(SPLIT_REVIEW_GONE_MESSAGE);
  });

  it("should answer 400 and never echo the password when the request is malformed", async () => {
    const body = bodyWith();
    delete body.oldRef;
    const request = new Request("http://localhost/api/m/ejes-calles/split-points", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const response = await readEjesCallesSplitPoints(request, { openSession: async () => Promise.reject(new Error("x")), now: () => 0 } as unknown as RunDeps);

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(PASSWORD);
  });
});

describe("withReviewRetention: review points leave the job result (EJS-6)", () => {
  const fakeJobs = (): { jobs: JobStore<EjesResult>; finish: ReturnType<typeof vi.fn> } => {
    const finish = vi.fn();
    const jobs = { finish, get: vi.fn(), tryStart: vi.fn(), progress: vi.fn(), fail: vi.fn(), sweep: vi.fn() } as unknown as JobStore<EjesResult>;
    return { jobs, finish };
  };

  it("should keep the review points of a dry run and publish the result without them", () => {
    const { jobs, finish } = fakeJobs();
    const reviews: EjesReviewStore = { retain: vi.fn(), read: vi.fn() };

    withReviewRetention(jobs, reviews).finish("job-dry", { dryRun: true, reviewPoints: [STORED_POINT], splits: [] } as unknown as EjesResult);

    expect(reviews.retain).toHaveBeenCalledWith("job-dry", [STORED_POINT]);
    expect(finish.mock.calls[0][1]).not.toHaveProperty("reviewPoints");
  });

  it("should not keep the review points of a real run, and still publish the result without them", () => {
    const { jobs, finish } = fakeJobs();
    const reviews: EjesReviewStore = { retain: vi.fn(), read: vi.fn() };

    withReviewRetention(jobs, reviews).finish("job-real", { dryRun: false, reviewPoints: [STORED_POINT] } as unknown as EjesResult);

    expect(reviews.retain).not.toHaveBeenCalled();
    expect(finish.mock.calls[0][1]).not.toHaveProperty("reviewPoints");
  });

  it("should keep nothing for a dry run without review points", () => {
    const { jobs } = fakeJobs();
    const reviews: EjesReviewStore = { retain: vi.fn(), read: vi.fn() };

    withReviewRetention(jobs, reviews).finish("job-empty", { dryRun: true } as unknown as EjesResult);

    expect(reviews.retain).not.toHaveBeenCalled();
  });
});

describe("getEjesReviewStore: the points of a job the job store no longer holds are dropped (EJS-6)", () => {
  it("should return the same store to every caller of the process", () => {
    expect(getEjesReviewStore()).toBe(getEjesReviewStore());
  });

  it("should drop the points of a job the job store does not hold on the next read", () => {
    const store = getEjesReviewStore();
    store.retain("job-missing-from-store", [STORED_POINT]);

    expect(store.read("job-missing-from-store")).toBeUndefined();
  });
});
