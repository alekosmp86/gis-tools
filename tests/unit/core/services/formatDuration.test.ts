import { describe, expect, it } from "vitest";
import { formatDuration } from "@/core/services/formatDuration";

describe("formatDuration", () => {
  describe("zero, negative and NaN durations", () => {
    it("should return '0 ms' when the duration is zero", () => {
      expect(formatDuration(0)).toBe("0 ms");
    });

    it.each([-1, -0.5, -60000])("should return '0 ms' when the duration %s is negative", (ms) => {
      expect(formatDuration(ms)).toBe("0 ms");
    });

    it("should return '0 ms' when the duration is NaN", () => {
      expect(formatDuration(Number.NaN)).toBe("0 ms");
    });
  });

  describe("durations below one second", () => {
    it("should return '1 ms' when the duration is 1 ms", () => {
      expect(formatDuration(1)).toBe("1 ms");
    });

    it("should return '999 ms' when the duration is the largest whole ms below one second", () => {
      expect(formatDuration(999)).toBe("999 ms");
    });

    it("should round fractional ms below one second to whole ms", () => {
      expect(formatDuration(0.4)).toBe("0 ms");
      expect(formatDuration(0.6)).toBe("1 ms");
    });
  });

  describe("seconds below one minute", () => {
    it("should return '1,0 s' when the duration is exactly 1000 ms", () => {
      expect(formatDuration(1000)).toBe("1,0 s");
    });

    it("should return seconds with one decimal and a comma when the duration is 12345 ms", () => {
      expect(formatDuration(12345)).toBe("12,3 s");
    });

    it("should round to the nearest tenth down when the hundredths are below five", () => {
      expect(formatDuration(1049)).toBe("1,0 s");
    });

    it("should round to the nearest tenth up when the hundredths are exactly five", () => {
      expect(formatDuration(1050)).toBe("1,1 s");
    });

    it("should return '59,9 s' when the duration is 59949 ms", () => {
      expect(formatDuration(59949)).toBe("59,9 s");
    });

    it("should roll over to minutes when the tenth rounds up to 60,0 s at 59950 ms", () => {
      expect(formatDuration(59950)).toBe("1 min 00 s");
    });

    it("should roll over to minutes instead of showing 60,0 s when the duration is 59960 ms", () => {
      expect(formatDuration(59960)).toBe("1 min 00 s");
    });
  });

  describe("one minute and above", () => {
    it("should return '1 min 00 s' when the duration is exactly 60000 ms", () => {
      expect(formatDuration(60000)).toBe("1 min 00 s");
    });

    it("should zero-pad the seconds when the duration is 61000 ms", () => {
      expect(formatDuration(61000)).toBe("1 min 01 s");
    });

    it("should return '2 min 05 s' when the duration is 125000 ms", () => {
      expect(formatDuration(125000)).toBe("2 min 05 s");
    });

    it("should return '1 min 59 s' when the duration is 119400 ms", () => {
      expect(formatDuration(119400)).toBe("1 min 59 s");
    });

    it("should roll over to the next minute when the seconds round up to 60 at 119500 ms", () => {
      expect(formatDuration(119500)).toBe("2 min 00 s");
    });

    it("should keep counting minutes past one hour when the duration is 3600000 ms", () => {
      expect(formatDuration(3600000)).toBe("60 min 00 s");
    });
  });
});
