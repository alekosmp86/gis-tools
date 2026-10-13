import { describe, expect, it, vi } from "vitest";
import { DEAD_JOB_HEARTBEAT_MS, PID_REUSE_HEARTBEAT_BOUND_MS } from "@/modules/coverage-loads/shp/job/constants.ts";
import { isJobDead, isPidAlive } from "@/modules/coverage-loads/shp/job/liveness.ts";
import { createInitialStatus } from "@/modules/coverage-loads/shp/job/statusTransitions.ts";
import { JOB_MODE, JOB_STATE } from "@/modules/coverage-loads/shp/job/types.ts";
import type { JobState, JobStatus } from "@/modules/coverage-loads/shp/job/types.ts";

const NOW = Date.parse("2026-03-01T12:00:00.000Z");
const THRESHOLD = 10_000;

function statusWith(state: JobState, heartbeatAgoMs: number | null, pid: number | null = 4242): JobStatus {
  const status = createInitialStatus({
    jobId: "11111111-1111-4111-8111-111111111111",
    mode: JOB_MODE.LOAD,
    table: "lte",
    prefix: "LTEUruguay",
    fechaact: "2026-01-31",
    fileName: "LTEUruguay_20260131.shp",
    sizeBytes: 1,
    receivedBytes: 1,
    now: NOW - 999_999_999,
    state,
  });
  status.pid = pid;
  status.heartbeatAt = heartbeatAgoMs === null ? null : new Date(NOW - heartbeatAgoMs).toISOString();
  return status;
}

const dead = () => false;
const alive = () => true;

describe("isPidAlive", () => {
  it("should report the current process as alive", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("should report a dead pid (ESRCH) as not alive", () => {
    const spy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });
    try {
      expect(isPidAlive(99999)).toBe(false);
      expect(spy).toHaveBeenCalledWith(99999, 0);
    } finally {
      spy.mockRestore();
    }
  });

  it("should report a pid owned by someone else (EPERM) as alive", () => {
    const spy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    });
    try {
      expect(isPidAlive(1)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("isJobDead", () => {
  it.each([JOB_STATE.UPLOADING, JOB_STATE.READY, JOB_STATE.SUCCEEDED, JOB_STATE.FAILED, JOB_STATE.CANCELLED])(
    "should never consider a %s job dead",
    (state) => {
      expect(isJobDead(statusWith(state, 10 * DEAD_JOB_HEARTBEAT_MS), NOW, { isPidAlive: dead })).toBe(false);
    }
  );

  it.each([JOB_STATE.RUNNING, JOB_STATE.CANCELLING])("should consider a %s job with dead pid and stale heartbeat dead", (state) => {
    expect(isJobDead(statusWith(state, THRESHOLD + 1), NOW, { isPidAlive: dead, heartbeatThresholdMs: THRESHOLD })).toBe(true);
  });

  it("should not consider a job dead when the pid is alive even with a stale heartbeat", () => {
    expect(isJobDead(statusWith(JOB_STATE.RUNNING, 10 * THRESHOLD), NOW, { isPidAlive: alive, heartbeatThresholdMs: THRESHOLD })).toBe(false);
  });

  it("should not consider a job dead when the pid is gone but the heartbeat is fresh", () => {
    expect(isJobDead(statusWith(JOB_STATE.RUNNING, 1), NOW, { isPidAlive: dead, heartbeatThresholdMs: THRESHOLD })).toBe(false);
  });

  it("should not consider a job dead exactly at the threshold (strictly older required)", () => {
    expect(isJobDead(statusWith(JOB_STATE.RUNNING, THRESHOLD), NOW, { isPidAlive: dead, heartbeatThresholdMs: THRESHOLD })).toBe(false);
  });

  it("should consider a job dead one millisecond past the threshold", () => {
    expect(isJobDead(statusWith(JOB_STATE.RUNNING, THRESHOLD + 1), NOW, { isPidAlive: dead, heartbeatThresholdMs: THRESHOLD })).toBe(true);
  });

  it("should use the default 60 s threshold when none is injected", () => {
    expect(isJobDead(statusWith(JOB_STATE.RUNNING, DEAD_JOB_HEARTBEAT_MS), NOW, { isPidAlive: dead })).toBe(false);
    expect(isJobDead(statusWith(JOB_STATE.RUNNING, DEAD_JOB_HEARTBEAT_MS + 1), NOW, { isPidAlive: dead })).toBe(true);
  });

  it("should not even probe the pid when it is null and fall back to updatedAt when there is no heartbeat", () => {
    const probe = vi.fn(() => true);
    const status = statusWith(JOB_STATE.RUNNING, null, null);

    expect(isJobDead(status, NOW, { isPidAlive: probe, heartbeatThresholdMs: THRESHOLD })).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });

  it("should treat an unparsable heartbeat as dead when the pid is gone", () => {
    const status = statusWith(JOB_STATE.RUNNING, 0);
    status.heartbeatAt = "not-a-date";

    expect(isJobDead(status, NOW, { isPidAlive: dead, heartbeatThresholdMs: THRESHOLD })).toBe(true);
  });

  describe("pid reuse", () => {
    it("should use 10x the dead-job heartbeat as the reuse bound", () => {
      expect(PID_REUSE_HEARTBEAT_BOUND_MS).toBe(10 * DEAD_JOB_HEARTBEAT_MS);
    });

    it.each([JOB_STATE.RUNNING, JOB_STATE.CANCELLING])(
      "should consider a %s job dead when its pid answers but the heartbeat is older than the reuse bound",
      (state) => {
        expect(isJobDead(statusWith(state, PID_REUSE_HEARTBEAT_BOUND_MS + 1), NOW, { isPidAlive: alive })).toBe(true);
      }
    );

    it("should not consider a job dead when its pid answers and the heartbeat is exactly at the reuse bound", () => {
      expect(isJobDead(statusWith(JOB_STATE.RUNNING, PID_REUSE_HEARTBEAT_BOUND_MS), NOW, { isPidAlive: alive })).toBe(false);
    });

    it("should not consider a job dead when its pid answers and the heartbeat is only past the dead threshold", () => {
      expect(isJobDead(statusWith(JOB_STATE.RUNNING, DEAD_JOB_HEARTBEAT_MS + 1), NOW, { isPidAlive: alive })).toBe(false);
    });

    it("should not consider a job dead when its pid answers and the heartbeat is unparsable", () => {
      const status = statusWith(JOB_STATE.RUNNING, 0);
      status.heartbeatAt = "not-a-date";

      expect(isJobDead(status, NOW, { isPidAlive: alive })).toBe(false);
    });
  });
});
