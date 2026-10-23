import { afterEach, describe, expect, it, vi } from "vitest";
import { createStepClock } from "@/core/services/server/shpReplace/shpReplaceSteps";

interface ManualClock {
  now: () => number;
  advance: (ms: number) => void;
}

function manualClock(start = 0): ManualClock {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe("createStepClock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("start and finish", () => {
    it("should return one timing with the label and the elapsed ms when a single step is started and finished", () => {
      const clock = manualClock(100);
      const steps = createStepClock(clock.now);

      steps.start("Convirtiendo geometrías");
      clock.advance(250);

      expect(steps.finish()).toEqual([{ label: "Convirtiendo geometrías", ms: 250 }]);
    });

    it("should close the previous step with its own elapsed ms when the next step starts", () => {
      const clock = manualClock();
      const steps = createStepClock(clock.now);

      steps.start("A");
      clock.advance(40);
      steps.start("B");
      clock.advance(60);

      expect(steps.finish()).toEqual([
        { label: "A", ms: 40 },
        { label: "B", ms: 60 },
      ]);
    });

    it("should return the timings in start order when many steps are started", () => {
      const clock = manualClock();
      const steps = createStepClock(clock.now);
      const labels = ["uno", "dos", "tres", "cuatro", "cinco"];

      for (const label of labels) {
        steps.start(label);
        clock.advance(5);
      }

      expect(steps.finish().map((timing) => timing.label)).toEqual(labels);
    });

    it("should round a fractional elapsed duration to the nearest integer ms when the step closes", () => {
      const clock = manualClock();
      const steps = createStepClock(clock.now);

      steps.start("arriba");
      clock.advance(12.6);
      steps.start("abajo");
      clock.advance(12.4);

      expect(steps.finish()).toEqual([
        { label: "arriba", ms: 13 },
        { label: "abajo", ms: 12 },
      ]);
    });

    it("should record 0 ms when the clock reports an earlier instant than the step start", () => {
      const clock = manualClock(500);
      const steps = createStepClock(clock.now);

      steps.start("retroceso");
      clock.advance(-30);

      expect(steps.finish()).toEqual([{ label: "retroceso", ms: 0 }]);
    });

    it("should record 0 ms for a step that starts and closes at the same instant", () => {
      const clock = manualClock(42);
      const steps = createStepClock(clock.now);

      steps.start("instante");

      expect(steps.finish()).toEqual([{ label: "instante", ms: 0 }]);
    });
  });

  describe("finish", () => {
    it("should return an empty list when finish is called with no step started", () => {
      const steps = createStepClock(manualClock().now);

      expect(steps.finish()).toEqual([]);
    });

    it("should return the same list without closing the step again when finish is called twice", () => {
      const clock = manualClock();
      const steps = createStepClock(clock.now);
      steps.start("A");
      clock.advance(10);

      const first = steps.finish();
      clock.advance(500);
      const second = steps.finish();

      expect(first).toEqual([{ label: "A", ms: 10 }]);
      expect(second).toEqual(first);
    });
  });

  describe("start after finish", () => {
    it("should begin a fresh list holding only the new steps when start is called after finish", () => {
      const clock = manualClock();
      const steps = createStepClock(clock.now);
      steps.start("A");
      clock.advance(10);
      steps.finish();

      steps.start("C");
      clock.advance(5);

      expect(steps.finish()).toEqual([{ label: "C", ms: 5 }]);
    });
  });

  describe("default clock", () => {
    it("should measure the elapsed ms with performance.now when no clock is given", () => {
      vi.spyOn(performance, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1234.6);
      const steps = createStepClock();

      steps.start("A");

      expect(steps.finish()).toEqual([{ label: "A", ms: 235 }]);
    });
  });
});
