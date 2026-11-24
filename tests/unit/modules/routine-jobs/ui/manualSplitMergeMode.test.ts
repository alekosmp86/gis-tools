import type { LineString, Point, Position } from "geojson";
import { describe, expect, it } from "vitest";
import { MAP_MANUAL_POINT_REVIEW_TYPE, MAP_MANUAL_POINT_TYPES } from "@/core/constants/mapConstants";
import type { EjesMapCandidate, EjesMapFeature } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EJES_MANUAL_SPLIT_TEXT } from "@/modules/routine-jobs/ui/ejes-calles/ejesAcceptTexts";
import { nearestPiecesOf } from "@/modules/routine-jobs/ui/ejes-calles/manualSplit/pointAssignment";
import { manualSplitMapOf, pointSummaryOf } from "@/modules/routine-jobs/ui/ejes-calles/manualSplit/manualSplitView";

const EARTH_METRES_PER_DEGREE = (Math.PI / 180) * 6371008.8;

/** A WGS84 position `east` and `north` metres from the origin (0, 0): at the equator the metres and the degrees line up. */
const at = (east: number, north: number): Position => [east / EARTH_METRES_PER_DEGREE, north / EARTH_METRES_PER_DEGREE];

const line = (from: [number, number], to: [number, number]): LineString => ({
  type: "LineString",
  coordinates: [at(from[0], from[1]), at(to[0], to[1])],
});

const point = (east: number, north: number): Point => ({ type: "Point", coordinates: at(east, north) });

const feature = (role: EjesMapFeature["role"], geometry: EjesMapFeature["geometry"], label = ""): EjesMapFeature => ({
  itemIndex: 0,
  role,
  label,
  geometry,
});

const candidate = (ref: string, distance: number): EjesMapCandidate => ({
  oldRef: "6000",
  ref,
  idcalle: null,
  name: null,
  localities: null,
  length: 50,
  nearLength: 50,
  coveredLength: 0,
  coveredPercent: 0,
  distance,
});

const PIECE_A = "6001";
const PIECE_B = "6002";

/** An old section 100 m long, cut into two candidate pieces A (0..50 m) and B (50..100 m), with three access points. */
const fixture = (accessPoints: Point[]) => {
  const features: EjesMapFeature[] = [
    feature("old", line([0, 0], [100, 0]), "6000"),
    feature("new", line([0, 0], [50, 0]), PIECE_A),
    feature("new", line([50, 0], [100, 0]), PIECE_B),
    ...accessPoints.map((geometry) => feature("access", geometry)),
  ];
  const candidates = [candidate(PIECE_A, 10), candidate(PIECE_B, 20)];
  return { features, candidates };
};

/** P1 is near piece A, P2 near piece B, P3 sits exactly between both pieces (an ambiguous point). */
const NEAR_A = point(20, 2);
const NEAR_B = point(80, 2);
const BETWEEN = point(50, 1);

const pointTypesOf = (collection: { features: Array<{ geometry: { type: string }; properties: Record<string, unknown> | null }> }): unknown[] =>
  collection.features.filter((entry) => entry.geometry.type === "Point").map((entry) => entry.properties?.["_discrepancyType"]);

describe("nearestPiecesOf (manual split merge mode)", () => {
  it("should give each point the index of its nearest piece, whatever the distance", () => {
    const pieces = [line([0, 0], [50, 0]), line([50, 0], [100, 0])];

    expect(nearestPiecesOf([at(20, 2), at(80, 2), at(20, 300)], pieces)).toEqual([0, 1, 0]);
  });
});

describe("pointSummaryOf (manual split merge mode)", () => {
  it("should count every point as assigned and none as review in merge mode, even an ambiguous one", () => {
    const { features, candidates } = fixture([NEAR_A, NEAR_B, BETWEEN]);

    expect(pointSummaryOf(features, candidates, [PIECE_A, PIECE_B], true)).toEqual({ assigned: 3, review: 0 });
  });

  it("should keep the default rules: an ambiguous point between two chosen pieces counts as review", () => {
    const { features, candidates } = fixture([NEAR_A, NEAR_B, BETWEEN]);

    expect(pointSummaryOf(features, candidates, [PIECE_A, PIECE_B])).toEqual({ assigned: 2, review: 1 });
  });

  it("should match the default mode when merge mode is not asked for", () => {
    const { features, candidates } = fixture([NEAR_A, NEAR_B, BETWEEN]);

    expect(pointSummaryOf(features, candidates, [PIECE_A, PIECE_B], false)).toEqual(pointSummaryOf(features, candidates, [PIECE_A, PIECE_B]));
  });

  it("should give no summary while nothing is chosen, in either mode", () => {
    const { features, candidates } = fixture([NEAR_A, NEAR_B]);

    expect(pointSummaryOf(features, candidates, [])).toBeNull();
    expect(pointSummaryOf(features, candidates, [], true)).toBeNull();
  });
});

describe("manualSplitMapOf point colours (manual split merge mode)", () => {
  it("should colour each point with the type of its nearest chosen piece in merge mode", () => {
    const { features, candidates } = fixture([NEAR_A, NEAR_B]);

    const map = manualSplitMapOf(features, candidates, [PIECE_A, PIECE_B], [], [], true);

    expect(pointTypesOf(map)).toEqual([MAP_MANUAL_POINT_TYPES[0], MAP_MANUAL_POINT_TYPES[1]]);
  });

  it("should send every point to the only chosen piece in merge mode, with no review type", () => {
    const { features, candidates } = fixture([NEAR_A, NEAR_B, BETWEEN]);

    const map = manualSplitMapOf(features, candidates, [PIECE_B], [], [], true);

    expect(pointTypesOf(map)).toEqual([MAP_MANUAL_POINT_TYPES[1], MAP_MANUAL_POINT_TYPES[1], MAP_MANUAL_POINT_TYPES[1]]);
  });

  it("should never draw a point as a review point in merge mode, whatever the chosen pieces", () => {
    const { features, candidates } = fixture([NEAR_A, NEAR_B, BETWEEN]);

    const map = manualSplitMapOf(features, candidates, [PIECE_A, PIECE_B], [], [], true);

    expect(pointTypesOf(map)).not.toContain(MAP_MANUAL_POINT_REVIEW_TYPE);
  });

  it("should keep the default colours when merge mode is off: the point far from the only chosen piece goes to review", () => {
    const { features, candidates } = fixture([NEAR_A, NEAR_B]);

    const map = manualSplitMapOf(features, candidates, [PIECE_B]);

    expect(pointTypesOf(map)).toEqual([MAP_MANUAL_POINT_REVIEW_TYPE, MAP_MANUAL_POINT_TYPES[1]]);
  });
});

describe("manual split summary texts (orientativo)", () => {
  it("should name the default summary as orientative, with the assigned and review counts", () => {
    const text = EJES_MANUAL_SPLIT_TEXT.POINTS_SUMMARY(2, 1);

    expect(text).toContain("(orientativo)");
    expect(text).toContain("2 a los tramos elegidos, 1 a revisión");
  });

  it("should name the merge-mode summary as orientative, with the assigned count and no review count", () => {
    const text = EJES_MANUAL_SPLIT_TEXT.POINTS_SUMMARY_MERGE(3);

    expect(text).toContain("(orientativo)");
    expect(text).toContain("3 a los tramos elegidos");
    expect(text).not.toContain("revisión");
  });
});
