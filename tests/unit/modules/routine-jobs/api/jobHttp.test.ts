import { describe, expect, it, vi } from "vitest";
import { executeJob } from "@/modules/routine-jobs/api/jobHttp";
import type { JobProgress, JobResult } from "@/modules/routine-jobs/jobs/shared/jobStore";

const JOB_ID = "job-1";
const REDACTION = "***";
const PASSWORD = "ab12cd";
const PLAN_ID = "3ab12cd9e8f7d6c5b4a39281706f5e4d";
const OTHER_PLAN_ID = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

interface SecretResult extends JobResult {
  planId: string;
  message: string;
  nested: { note: string; ids: string[] };
}

const sinkOf = () => ({
  progress: vi.fn<(jobId: string, progress: JobProgress) => void>(),
  finish: vi.fn<(jobId: string, result: SecretResult) => void>(),
  fail: vi.fn<(jobId: string, error: string) => void>(),
});

const resultOf = (overrides: Partial<SecretResult> = {}): SecretResult => ({
  outcomeUnknown: false,
  planId: PLAN_ID,
  message: `La clave ${PASSWORD} no debe salir.`,
  nested: { note: `Repetida: ${PASSWORD}`, ids: [OTHER_PLAN_ID, `id-${PASSWORD}`] },
  ...overrides,
});

describe("jobHttp", () => {
  describe("executeJob", () => {
    it("should keep result.planId intact when the password is a substring of it", async () => {
      const sink = sinkOf();

      await executeJob<SecretResult>(sink, JOB_ID, PASSWORD, async () => resultOf());

      expect(PLAN_ID).toContain(PASSWORD);
      expect(sink.finish).toHaveBeenCalledTimes(1);
      expect(sink.finish.mock.calls[0]?.[1].planId).toBe(PLAN_ID);
    });

    it("should still scrub the password from another result field that contains it", async () => {
      const sink = sinkOf();

      await executeJob<SecretResult>(sink, JOB_ID, PASSWORD, async () => resultOf());

      expect(sink.finish).toHaveBeenCalledWith(JOB_ID, {
        outcomeUnknown: false,
        planId: PLAN_ID,
        message: `La clave ${REDACTION} no debe salir.`,
        nested: { note: `Repetida: ${REDACTION}`, ids: [OTHER_PLAN_ID, `id-${REDACTION}`] },
      });
      expect(sink.fail).not.toHaveBeenCalled();
    });

    it("should keep the result unchanged when the password is empty", async () => {
      const sink = sinkOf();
      const result = resultOf();

      await executeJob<SecretResult>(sink, JOB_ID, "", async () => result);

      expect(sink.finish).toHaveBeenCalledWith(JOB_ID, result);
    });
  });
});
