import { describe, expect, it } from "vitest";
import {
  chipDetail,
  chipLabel,
  isLiveJobState,
  notificationBody,
  notificationTitle,
  stripProgressPrefix,
  titleWithProgress,
} from "@/modules/coverage-loads/shp/domain/shpAttention.ts";
import { createInitialStatus } from "@/modules/coverage-loads/shp/job/statusTransitions.ts";
import type { JobMode, JobState, JobStatus } from "@/modules/coverage-loads/shp/job/types.ts";

function status(state: JobState, mode: JobMode = "LOAD"): JobStatus {
  return createInitialStatus({
    jobId: "j",
    mode,
    table: "lte",
    prefix: "LTEUruguay",
    fechaact: "2026-01-31",
    fileName: "LTEUruguay_20260131.shp",
    sizeBytes: 1,
    receivedBytes: 1,
    now: 0,
    state,
  });
}

describe("shpAttention", () => {
  describe("titleWithProgress", () => {
    it("should prefix the percent once", () => {
      expect(titleWithProgress("GIS Tools", 5)).toBe("(5%) GIS Tools");
    });

    it("should never stack prefixes across repeated updates", () => {
      const once = titleWithProgress("GIS Tools", 1);
      const twice = titleWithProgress(once, 2);
      const thrice = titleWithProgress(twice, 100);

      expect(thrice).toBe("(100%) GIS Tools");
    });

    it("should restore the original title when the prefix is stripped, and leave a clean title alone", () => {
      expect(stripProgressPrefix("(42%) GIS Tools")).toBe("GIS Tools");
      expect(stripProgressPrefix("GIS Tools")).toBe("GIS Tools");
      expect(stripProgressPrefix("(x%) GIS Tools")).toBe("(x%) GIS Tools");
    });
  });

  describe("chip and notification texts", () => {
    it("should say Cancelando when the job is cancelling and name the table otherwise", () => {
      expect(chipLabel(status("CANCELLING"))).toBe("Cancelando carga SHP: 0%");
      expect(chipLabel(status("RUNNING"))).toBe("Carga SHP lte: 0%");
      expect(chipDetail(status("CANCELLING"))).toBe("Cancelando");
    });

    it("should distinguish a test run in the notification and name the file and table in the body", () => {
      expect(notificationTitle(status("SUCCEEDED", "TEST"))).toBe("Prueba de carga SHP: completada");
      expect(notificationTitle(status("FAILED"))).toBe("Carga SHP: con error");
      expect(notificationBody(status("SUCCEEDED"))).toBe("LTEUruguay_20260131.shp, tabla public.lte");
    });
  });

  describe("isLiveJobState", () => {
    it.each([
      ["RUNNING", true],
      ["CANCELLING", true],
      ["READY", false],
      ["SUCCEEDED", false],
      ["FAILED", false],
      ["CANCELLED", false],
      ["UPLOADING", false],
    ] as const)("should answer %s -> %s", (state, expected) => {
      expect(isLiveJobState(state)).toBe(expected);
    });
  });
});
