import { describe, it, expect } from "vitest";
import { JobState, createJobStore } from "@/modules/routine-jobs/jobs/shared/jobStore";

const NOW = 1_700_000_000_000;
const KEY_A = "db.local:5432|gis|carto|cadastral_locality";
const KEY_B = "db.local:5432|gis|carto|cadastral_locality_2";
const KEY_C = "db.local:5432|gis|carto|cadastral_locality_3";
const KEY_D = "db.local:5432|gis|otra|cadastral_locality";

interface TestResult {
  outcomeUnknown: boolean;
}

const resultFixture = (): TestResult => ({ outcomeUnknown: false });

describe("shared job store with multiple lock keys (MJ-6, MJ-13)", () => {
  describe("tryStart with a list of lock keys", () => {
    it("should refuse a start whose keys overlap a RUNNING job on any one key", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart([KEY_A, KEY_B]);

      expect(store.tryStart([KEY_C, KEY_B])).toBeNull();
    });

    it("should refuse a start whose only shared key is the last key of the running job", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart([KEY_A, KEY_B]);

      expect(store.tryStart([KEY_B])).toBeNull();
    });

    it("should refuse a single-key start on a key held by a running multi-key job", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart([KEY_A, KEY_B]);

      expect(store.tryStart(KEY_A)).toBeNull();
    });

    it("should grant a start whose keys are all disjoint from a RUNNING job", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart([KEY_A, KEY_B]);

      expect(store.tryStart([KEY_C, KEY_D])).not.toBeNull();
    });

    it("should record the keys joined with ' + ' as the table key of a multi-key job", () => {
      const store = createJobStore<TestResult>(() => NOW);

      const job = store.tryStart([KEY_A, KEY_B]);

      expect(job?.tableKey).toBe(`${KEY_A} + ${KEY_B}`);
    });

    it("should keep a single string key unchanged as the table key", () => {
      const store = createJobStore<TestResult>(() => NOW);

      const job = store.tryStart(KEY_A);

      expect(job?.tableKey).toBe(KEY_A);
    });

    it("should refuse a second start of the same list while the first is RUNNING", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart([KEY_A, KEY_B]);

      expect(store.tryStart([KEY_A, KEY_B])).toBeNull();
    });
  });

  describe("single string key behaviour", () => {
    it("should still refuse a second single-key start of the same key while RUNNING", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart(KEY_A);

      expect(store.tryStart(KEY_A)).toBeNull();
    });

    it("should still grant a single key that differs from every RUNNING key", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart([KEY_A, KEY_B]);

      expect(store.tryStart(KEY_D)).not.toBeNull();
    });
  });

  describe("keys freed on completion", () => {
    it("should free every key of a multi-key job when it finishes", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const job = store.tryStart([KEY_A, KEY_B]);

      store.finish(job?.jobId ?? "", resultFixture());

      expect(store.tryStart([KEY_A])).not.toBeNull();
      expect(store.tryStart([KEY_B])).not.toBeNull();
    });

    it("should free every key of a multi-key job when it fails", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const job = store.tryStart([KEY_A, KEY_B]);

      store.fail(job?.jobId ?? "", "fallo");

      expect(store.tryStart([KEY_B, KEY_C])).not.toBeNull();
    });

    it("should free every key when the job finishes with outcomeUnknown true", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const job = store.tryStart([KEY_A, KEY_B]);

      store.finish(job?.jobId ?? "", { outcomeUnknown: true });

      expect(store.get(job?.jobId ?? "")).toMatchObject({ state: JobState.DONE, outcomeUnknown: true });
      expect(store.tryStart([KEY_A, KEY_B])).not.toBeNull();
    });

    it("should keep the other keys of a multi-key job locked while only one job finished", () => {
      const store = createJobStore<TestResult>(() => NOW);
      const first = store.tryStart([KEY_A, KEY_B]);
      store.tryStart([KEY_C]);

      store.finish(first?.jobId ?? "", resultFixture());

      expect(store.tryStart([KEY_C])).toBeNull();
      expect(store.tryStart([KEY_A])).not.toBeNull();
    });

    it("should not grant the keys of a multi-key job to a start before it finishes", () => {
      const store = createJobStore<TestResult>(() => NOW);
      store.tryStart([KEY_A, KEY_B]);

      expect(store.tryStart([KEY_B, KEY_C])).toBeNull();
    });
  });
});
