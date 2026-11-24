import type { LineString, Position } from "geojson";
import { describe, expect, it } from "vitest";
import { REPLACEMENT_MIN_OLD_LENGTH_M, REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { pointAssignmentsOf } from "@/modules/routine-jobs/ui/ejes-calles/manualSplit/pointAssignment";

const EARTH_METRES_PER_DEGREE = (Math.PI / 180) * 6371008.8;

/** A WGS84 position `east` and `north` metres from the origin (0, 0): at the equator the metres and the degrees line up. */
const at = (east: number, north: number): Position => [east / EARTH_METRES_PER_DEGREE, north / EARTH_METRES_PER_DEGREE];

/** A straight line from `from` to `to`, both in metres from the origin. */
const line = (from: [number, number], to: [number, number]): LineString => ({
  type: "LineString",
  coordinates: [at(from[0], from[1]), at(to[0], to[1])],
});

describe("pointAssignmentsOf (EJS-5, EJS-8, EJS-17, EJS-21)", () => {
  it("should send every point to review when there is no piece", () => {
    expect(pointAssignmentsOf([at(5, 1), at(6, 1)], line([0, 0], [100, 0]), [])).toEqual([null, null]);
  });

  it("should send each point to the nearest piece", () => {
    const pieces = [line([0, 0], [50, 0]), line([50, 0], [100, 0])];

    expect(pointAssignmentsOf([at(20, 2), at(80, 2)], line([0, 0], [100, 0]), pieces)).toEqual([0, 1]);
  });

  it("should send a point to review when the second nearest piece is less than the ambiguity gap farther", () => {
    const pieces = [line([0, 0], [50, 0]), line([0, 10], [50, 10])];
    const old = line([0, 5], [50, 5]);

    expect(pointAssignmentsOf([at(25, 4)], old, pieces)).toEqual([null]);
  });

  it("should keep a point automatic when the second nearest piece is more than the ambiguity gap farther", () => {
    const pieces = [line([0, 0], [50, 0]), line([0, 10], [50, 10])];
    const old = line([0, 5], [50, 5]);

    expect(pointAssignmentsOf([at(25, 2)], old, pieces)).toEqual([0]);
  });

  it("should keep a point automatic when its piece is at most the extra distance farther than the old section", () => {
    const old = line([0, 0], [100, 0]);
    const piece = line([0, REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M - 1], [100, REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M - 1]);

    expect(pointAssignmentsOf([at(50, 0)], old, [piece, line([0, 500], [100, 500])])).toEqual([0]);
  });

  it("should send a point to review when its piece is more than the extra distance farther than the old section", () => {
    const old = line([0, 0], [100, 0]);
    const piece = line([0, REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M + 1], [100, REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M + 1]);

    expect(pointAssignmentsOf([at(50, 0)], old, [piece, line([0, 500], [100, 500])])).toEqual([null]);
  });

  it("should send every point to review for a one-piece replacement of an old section shorter than the minimum", () => {
    const old = line([0, 0], [REPLACEMENT_MIN_OLD_LENGTH_M / 2, 0]);

    expect(pointAssignmentsOf([at(0, 0)], old, [line([0, 0], [REPLACEMENT_MIN_OLD_LENGTH_M / 2, 0])])).toEqual([null]);
  });

  it("should send every point to review for a one-piece replacement more than three times the old section", () => {
    const old = line([0, 0], [10, 0]);

    expect(pointAssignmentsOf([at(5, 1)], old, [line([0, 0], [40, 0])])).toEqual([null]);
  });

  it("should keep the points of a one-piece replacement at most three times the old section automatic", () => {
    const old = line([0, 0], [10, 0]);

    expect(pointAssignmentsOf([at(5, 1)], old, [line([0, 0], [25, 0])])).toEqual([0]);
  });
});
