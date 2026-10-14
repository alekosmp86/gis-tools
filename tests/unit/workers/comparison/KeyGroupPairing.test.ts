import { describe, it, expect } from "vitest";
import {
  fingerprintRoundedGeometry,
  MAX_PAIRING_CANDIDATES,
  pairKeyGroup,
  type KeyGroupPairingOptions,
  type PairingRow,
} from "@/core/workers/comparison/KeyGroupPairing";
import { PairingMethod } from "@/core/types/comparison";

const point = (x: number, y: number) => ({ type: "Point", coordinates: [x, y] });

function row(
  index: number,
  signature: string,
  geometry: unknown = null,
  values: unknown[] = []
): PairingRow {
  return { index, geometry, signature, values };
}

function options(maxCandidates = MAX_PAIRING_CANDIDATES): KeyGroupPairingOptions {
  return { areEquivalent: (dbValue, fileValue) => dbValue === fileValue, maxCandidates };
}

function pairsOf(result: ReturnType<typeof pairKeyGroup>) {
  return result.pairs.map((pair) => [pair.dbIndex, pair.fileIndex, pair.method]);
}

function reorder<T>(items: T[], order: number[]): T[] {
  return order.map((position) => items[position]);
}

describe("KeyGroupPairing", () => {
  describe("fingerprintRoundedGeometry", () => {
    it("should return the same fingerprint for geometries equal within the comparison precision", () => {
      // Act
      const first = fingerprintRoundedGeometry(point(1.00001, 2));
      const second = fingerprintRoundedGeometry(point(1.00002, 2));

      // Assert
      expect(first).toBe(second);
    });

    it("should return different fingerprints for geometries further apart than the precision", () => {
      // Act / Assert
      expect(fingerprintRoundedGeometry(point(1, 2))).not.toBe(
        fingerprintRoundedGeometry(point(1.001, 2))
      );
    });

    it("should return a shared no-geometry token for null and undefined", () => {
      // Act / Assert
      expect(fingerprintRoundedGeometry(null)).toBe(fingerprintRoundedGeometry(undefined));
      expect(fingerprintRoundedGeometry(null)).not.toBe(fingerprintRoundedGeometry(point(0, 0)));
    });
  });

  describe("twin collapse", () => {
    it("should keep the first twin as representative and report extra DB twins", () => {
      // Arrange
      const dbRows = [row(0, "a"), row(1, "a"), row(2, "a")];

      // Act
      const result = pairKeyGroup(dbRows, [], options());

      // Assert
      expect(result.dbTwinExtras).toEqual([1, 2]);
      expect(result.unpairedDb).toEqual([0]);
      expect(result.pairs).toEqual([]);
    });

    it("should report extra file twins separately from DB twins", () => {
      // Arrange
      const dbRows = [row(0, "a"), row(1, "a")];
      const fileRows = [row(0, "a"), row(1, "a"), row(2, "a")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([[0, 0, PairingMethod.EXACT]]);
      expect(result.dbTwinExtras).toEqual([1]);
      expect(result.fileTwinExtras).toEqual([1, 2]);
      expect(result.unpairedDb).toEqual([]);
      expect(result.unpairedFile).toEqual([]);
    });

    it("should pick the lowest index as representative regardless of input order", () => {
      // Arrange
      const dbRows = [row(2, "a"), row(0, "a"), row(1, "a")];

      // Act
      const result = pairKeyGroup(dbRows, [row(5, "a")], options());

      // Assert
      expect(pairsOf(result)).toEqual([[0, 5, PairingMethod.EXACT]]);
      expect(result.dbTwinExtras).toEqual([1, 2]);
    });
  });

  describe("Stage A: equal-signature pairing", () => {
    it("should pair equal-signature representatives across sides without a distance", () => {
      // Arrange
      const dbRows = [row(0, "a"), row(1, "b")];
      const fileRows = [row(0, "b"), row(1, "a")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 1, PairingMethod.EXACT],
        [1, 0, PairingMethod.EXACT],
      ]);
      expect(result.pairs.every((pair) => pair.distance === undefined)).toBe(true);
    });

    it("should pair equal signatures even when the rows are far apart in geometry", () => {
      // Arrange
      const dbRows = [row(0, "a", point(0, 0))];
      const fileRows = [row(0, "a", point(1000, 1000))];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([[0, 0, PairingMethod.EXACT]]);
    });

    it("should leave non-matching representatives for the later stages", () => {
      // Arrange
      const dbRows = [row(0, "a"), row(1, "b")];
      const fileRows = [row(0, "a"), row(1, "z")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 0, PairingMethod.EXACT],
        [1, 1, PairingMethod.ELIMINATION],
      ]);
    });
  });

  describe("Stage B: greedy global geometry pairing", () => {
    it("should prefer the globally closest edge over the naive nearest neighbour of the first row", () => {
      // Arrange: A(0) is nearest to X(0.6), but B(1) is nearer to X (0.4), so B must win X.
      const dbRows = [row(0, "A", point(0, 0)), row(1, "B", point(1, 0))];
      const fileRows = [row(0, "X", point(0.6, 0)), row(1, "Y", point(3, 0))];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 1, PairingMethod.GEOMETRY],
        [1, 0, PairingMethod.GEOMETRY],
      ]);
    });

    it("should record the geometric distance on geometry pairs", () => {
      // Arrange
      const dbRows = [row(0, "A", point(0, 0))];
      const fileRows = [row(0, "X", point(3, 4))];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(result.pairs).toEqual([
        { dbIndex: 0, fileIndex: 0, method: PairingMethod.GEOMETRY, distance: 5 },
      ]);
    });

    it("should pair regardless of how far apart the rows are (no distance threshold)", () => {
      // Arrange
      const dbRows = [row(0, "A", point(0, 0))];
      const fileRows = [row(0, "X", point(1_000_000, 0)), row(1, "Y", point(2_000_000, 0))];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(result.pairs).toEqual([
        { dbIndex: 0, fileIndex: 0, method: PairingMethod.GEOMETRY, distance: 1_000_000 },
      ]);
      expect(result.unpairedFile).toEqual([1]);
    });

    it("should produce the same pairs when the input rows are shuffled", () => {
      // Arrange
      const dbRows = [
        row(0, "d0", point(0, 0)),
        row(1, "d1", point(10, 0)),
        row(2, "d2", point(20, 0)),
        row(3, "d3", point(30, 0)),
      ];
      const fileRows = [
        row(0, "f0", point(21, 0)),
        row(1, "f1", point(1, 0)),
        row(2, "f2", point(29, 0)),
        row(3, "f3", point(12, 0)),
      ];
      const baseline = pairKeyGroup(dbRows, fileRows, options());

      // Act
      const shuffled = pairKeyGroup(
        reorder(dbRows, [3, 1, 0, 2]),
        reorder(fileRows, [2, 0, 3, 1]),
        options()
      );

      // Assert
      expect(shuffled).toEqual(baseline);
      expect(pairsOf(baseline)).toEqual([
        [0, 1, PairingMethod.GEOMETRY],
        [1, 3, PairingMethod.GEOMETRY],
        [2, 0, PairingMethod.GEOMETRY],
        [3, 2, PairingMethod.GEOMETRY],
      ]);
    });

    it("should break distance ties by dbIndex then fileIndex", () => {
      // Arrange: every edge has distance 0 and the same number of differing fields.
      const dbRows = [row(1, "d1", point(0, 0), ["v"]), row(0, "d0", point(0, 0), ["v"])];
      const fileRows = [row(1, "f1", point(0, 0), ["v"]), row(0, "f0", point(0, 0), ["v"])];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 0, PairingMethod.GEOMETRY],
        [1, 1, PairingMethod.GEOMETRY],
      ]);
    });

    it("should break distance ties by the number of differing attributes before indexes", () => {
      // Arrange: both DB rows sit on the file row; db1 shares its attribute value with file0.
      const dbRows = [row(0, "d0", point(0, 0), ["a"]), row(1, "d1", point(0, 0), ["b"])];
      const fileRows = [row(0, "f0", point(0, 0), ["b"]), row(1, "f1", point(0, 0), ["c"])];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 1, PairingMethod.GEOMETRY],
        [1, 0, PairingMethod.GEOMETRY],
      ]);
    });

    it("should treat distances equal at the comparison precision as ties and fall back to attribute differences", () => {
      // Arrange: db0 is exactly on the file row, db1 is 0.00001 away (quantizes to the same distance).
      const dbRows = [row(0, "d0", point(0, 0), ["a"]), row(1, "d1", point(0.00001, 0), ["b"])];
      const fileRows = [row(0, "f0", point(0, 0), ["b"]), row(1, "f1", point(500, 0), ["z"])];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(result.pairs).toEqual([
        { dbIndex: 0, fileIndex: 1, method: PairingMethod.GEOMETRY, distance: 500 },
        { dbIndex: 1, fileIndex: 0, method: PairingMethod.GEOMETRY, distance: 0.00001 },
      ]);
    });

    it("should pair min(D, F) rows and leave the surplus unpaired", () => {
      // Arrange
      const dbRows = [row(0, "d0", point(0, 0)), row(1, "d1", point(10, 0)), row(2, "d2", point(20, 0))];
      const fileRows = [row(0, "f0", point(0.5, 0)), row(1, "f1", point(19.5, 0))];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 0, PairingMethod.GEOMETRY],
        [2, 1, PairingMethod.GEOMETRY],
      ]);
      expect(result.unpairedDb).toEqual([1]);
      expect(result.unpairedFile).toEqual([]);
    });
  });

  describe("remainder handling", () => {
    it("should report all DB rows as unpaired when the file side is empty", () => {
      // Arrange
      const dbRows = [row(0, "a"), row(1, "b")];

      // Act
      const result = pairKeyGroup(dbRows, [], options());

      // Assert
      expect(result.unpairedDb).toEqual([0, 1]);
      expect(result.unpairedFile).toEqual([]);
      expect(result.ambiguousDb).toEqual([]);
      expect(result.cappedSkipped).toBe(false);
    });

    it("should report all file rows as unpaired when the DB side is empty", () => {
      // Act
      const result = pairKeyGroup([], [row(0, "a"), row(1, "b")], options());

      // Assert
      expect(result.unpairedFile).toEqual([0, 1]);
      expect(result.unpairedDb).toEqual([]);
      expect(result.ambiguousFile).toEqual([]);
    });

    it("should return an empty result for two empty sides", () => {
      // Act
      const result = pairKeyGroup([], [], options());

      // Assert
      expect(result).toEqual({
        pairs: [],
        unpairedDb: [],
        unpairedFile: [],
        dbTwinExtras: [],
        fileTwinExtras: [],
        ambiguousDb: [],
        ambiguousFile: [],
        cappedSkipped: false,
      });
    });

    it("should pair a single leftover per side by elimination when geometry is missing", () => {
      // Arrange
      const dbRows = [row(0, "a")];
      const fileRows = [row(0, "b")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(result.pairs).toEqual([{ dbIndex: 0, fileIndex: 0, method: PairingMethod.ELIMINATION }]);
      expect(result.pairs[0].distance).toBeUndefined();
    });

    it("should pair by elimination when only one side has geometry", () => {
      // Arrange
      const dbRows = [row(0, "a", point(0, 0))];
      const fileRows = [row(0, "b", null)];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([[0, 0, PairingMethod.ELIMINATION]]);
    });

    it("should eliminate the last remaining pair after geometry pairing consumed the rest", () => {
      // Arrange: file1 has no geometry; file0 pairs by geometry, the remaining db/file1 pair by elimination.
      const dbRows = [row(0, "d0", point(0, 0)), row(1, "d1", point(50, 0))];
      const fileRows = [row(0, "f0", point(49, 0)), row(1, "f1", null)];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 1, PairingMethod.ELIMINATION],
        [1, 0, PairingMethod.GEOMETRY],
      ]);
    });

    it("should mark all remaining rows ambiguous when several rows lack geometry on both sides", () => {
      // Arrange
      const dbRows = [row(0, "a"), row(1, "b")];
      const fileRows = [row(0, "c"), row(1, "d")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(result.pairs).toEqual([]);
      expect(result.ambiguousDb).toEqual([0, 1]);
      expect(result.ambiguousFile).toEqual([0, 1]);
      expect(result.cappedSkipped).toBe(false);
    });

    it("should mark remaining rows ambiguous for an uneven no-geometry group", () => {
      // Arrange
      const dbRows = [row(0, "a"), row(1, "b")];
      const fileRows = [row(0, "c")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(result.pairs).toEqual([]);
      expect(result.ambiguousDb).toEqual([0, 1]);
      expect(result.ambiguousFile).toEqual([0]);
    });

    it("should not treat unparseable geometry as pairable", () => {
      // Arrange
      const dbRows = [row(0, "a", { type: "Nope" }), row(1, "b", "garbage")];
      const fileRows = [row(0, "c", point(0, 0)), row(1, "d", point(1, 1))];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(result.pairs).toEqual([]);
      expect(result.ambiguousDb).toEqual([0, 1]);
    });
  });

  describe("candidate cap", () => {
    const geometryGroup = (count: number, prefix: string, offset: number) =>
      Array.from({ length: count }, (_unused, index) =>
        row(index, `${prefix}${index}`, point(index * 10 + offset, 0))
      );

    it("should skip geometry pairing and mark the rest ambiguous when candidates exceed the cap", () => {
      // Arrange: 2 x 2 = 4 candidates > 3
      const dbRows = geometryGroup(2, "d", 0);
      const fileRows = geometryGroup(2, "f", 1);

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options(3));

      // Assert
      expect(result.cappedSkipped).toBe(true);
      expect(result.pairs).toEqual([]);
      expect(result.ambiguousDb).toEqual([0, 1]);
      expect(result.ambiguousFile).toEqual([0, 1]);
    });

    it("should still pair when candidates equal the cap", () => {
      // Arrange: 2 x 2 = 4 candidates, cap 4
      const dbRows = geometryGroup(2, "d", 0);
      const fileRows = geometryGroup(2, "f", 1);

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options(4));

      // Assert
      expect(result.cappedSkipped).toBe(false);
      expect(result.pairs).toHaveLength(2);
    });

    it("should still pair equal-signature rows above the cap (Stage A is not capped)", () => {
      // Arrange: 2 exact pairs plus a 2 x 2 remainder, cap 1
      const dbRows = [row(0, "same-a"), row(1, "same-b"), ...geometryGroup(2, "d", 0).map((r) => ({ ...r, index: r.index + 2 }))];
      const fileRows = [row(0, "same-a"), row(1, "same-b"), ...geometryGroup(2, "f", 1).map((r) => ({ ...r, index: r.index + 2 }))];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options(1));

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 0, PairingMethod.EXACT],
        [1, 1, PairingMethod.EXACT],
      ]);
      expect(result.cappedSkipped).toBe(true);
      expect(result.ambiguousDb).toEqual([2, 3]);
      expect(result.ambiguousFile).toEqual([2, 3]);
    });

    it("should not report capping when one side is empty even with a zero cap", () => {
      // Act
      const result = pairKeyGroup(geometryGroup(3, "d", 0), [], options(0));

      // Assert
      expect(result.cappedSkipped).toBe(false);
      expect(result.unpairedDb).toEqual([0, 1, 2]);
    });

    it("should expose the production cap of 40,000 candidates", () => {
      // Assert
      expect(MAX_PAIRING_CANDIDATES).toBe(40_000);
    });
  });

  describe("Stage A step (b): attribute-only exact pass", () => {
    function attrRow(
      index: number,
      attributeSignature: string | undefined,
      geometry: unknown = null,
      geometryTag = "none"
    ): PairingRow {
      return {
        index,
        geometry,
        signature: `${attributeSignature}|${geometryTag}`,
        attributeSignature,
        values: [attributeSignature],
      };
    }

    it("should pair 1:1 as EXACT when DB rows have geometry, file rows have none and attributes are identical (D=2, F=2)", () => {
      // Arrange
      const dbRows = [attrRow(0, "a", point(0, 0), "g0"), attrRow(1, "b", point(5, 5), "g1")];
      const fileRows = [attrRow(0, "b"), attrRow(1, "a")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 1, PairingMethod.EXACT],
        [1, 0, PairingMethod.EXACT],
      ]);
      expect(result.pairs.every((pair) => pair.distance === undefined)).toBe(true);
      expect(result.ambiguousDb).toEqual([]);
      expect(result.ambiguousFile).toEqual([]);
    });

    it("should pair 1:1 when the DB side has no geometry and the file side has geometry", () => {
      // Arrange
      const dbRows = [attrRow(0, "a"), attrRow(1, "b")];
      const fileRows = [attrRow(0, "b", point(1, 1), "g1"), attrRow(1, "a", point(2, 2), "g2")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 1, PairingMethod.EXACT],
        [1, 0, PairingMethod.EXACT],
      ]);
    });

    it("should treat unparseable geometry as no usable geometry for the trigger", () => {
      // Arrange
      const dbRows = [attrRow(0, "a", { type: "Nope" }, "bad"), attrRow(1, "b", "garbage", "bad2")];
      const fileRows = [attrRow(0, "b", point(1, 1), "g1"), attrRow(1, "a", point(2, 2), "g2")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 1, PairingMethod.EXACT],
        [1, 0, PairingMethod.EXACT],
      ]);
    });

    it("should NOT use the attribute-only pass when both sides have geometry; geometry pairing decides", () => {
      // Arrange: attributes are all identical, only geometry differs. Attribute-only pairing
      // (lowest index first) would give db0-file0; geometry must give db0-file1 and db1-file0.
      const dbRows = [attrRow(0, "x", point(0, 0), "g0"), attrRow(1, "x", point(100, 0), "g1")];
      const fileRows = [attrRow(0, "x", point(100.5, 0), "g2"), attrRow(1, "x", point(0.5, 0), "g3")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 1, PairingMethod.GEOMETRY],
        [1, 0, PairingMethod.GEOMETRY],
      ]);
    });

    it("should not collapse twins that differ only by geometry", () => {
      // Arrange
      const dbRows = [attrRow(0, "x", point(0, 0), "g0"), attrRow(1, "x", point(9, 9), "g1")];

      // Act
      const result = pairKeyGroup(dbRows, [], options());

      // Assert
      expect(result.dbTwinExtras).toEqual([]);
      expect(result.unpairedDb).toEqual([0, 1]);
    });

    it("should not collapse file twins that differ only by geometry", () => {
      // Arrange
      const fileRows = [attrRow(0, "x", point(0, 0), "g0"), attrRow(1, "x", point(9, 9), "g1")];

      // Act
      const result = pairKeyGroup([], fileRows, options());

      // Assert
      expect(result.fileTwinExtras).toEqual([]);
      expect(result.unpairedFile).toEqual([0, 1]);
    });

    it("should still collapse twins with the same full signature", () => {
      // Arrange
      const dbRows = [attrRow(0, "x", point(0, 0), "g0"), attrRow(1, "x", point(0, 0), "g0")];

      // Act
      const result = pairKeyGroup(dbRows, [], options());

      // Assert
      expect(result.dbTwinExtras).toEqual([1]);
      expect(result.unpairedDb).toEqual([0]);
    });

    it("should skip step (b) when the rows carry no attributeSignature", () => {
      // Arrange
      const dbRows = [attrRow(0, undefined, point(0, 0), "g0"), attrRow(1, undefined, point(5, 5), "g1")];
      const fileRows = [attrRow(0, undefined, null, "n0"), attrRow(1, undefined, null, "n1")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(result.pairs).toEqual([]);
      expect(result.ambiguousDb).toEqual([0, 1]);
      expect(result.ambiguousFile).toEqual([0, 1]);
    });

    it("should skip step (b) when only one side carries attributeSignature", () => {
      // Arrange
      const dbRows = [attrRow(0, "a", point(0, 0), "g0"), attrRow(1, "b", point(5, 5), "g1")];
      const fileRows = [attrRow(0, undefined, null, "n0"), attrRow(1, undefined, null, "n1")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(result.pairs).toEqual([]);
      expect(result.ambiguousDb).toEqual([0, 1]);
    });

    it("should trigger on leftover representatives, not on the original rows", () => {
      // Arrange: row 0 pairs by full signature and consumes the only geometry rows of the DB side;
      // the DB leftovers have no geometry while the file leftovers do.
      const dbRows = [
        { ...attrRow(0, "same", point(0, 0), "g0") },
        attrRow(1, "b"),
        attrRow(2, "c"),
      ];
      const fileRows = [
        { ...attrRow(0, "same", point(0, 0), "g0") },
        attrRow(1, "c", point(7, 7), "g1"),
        attrRow(2, "b", point(8, 8), "g2"),
      ];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 0, PairingMethod.EXACT],
        [1, 2, PairingMethod.EXACT],
        [2, 1, PairingMethod.EXACT],
      ]);
    });

    it("should not trigger in the mixed case where each side still has at least one geometry row", () => {
      // Arrange: file0 lacks geometry but file1 has it, and the DB has geometry on both rows.
      // Attribute-only would give db0-file1 and db1-file0 as EXACT; geometry decides instead.
      const dbRows = [attrRow(0, "a", point(0, 0), "g0"), attrRow(1, "b", point(50, 0), "g1")];
      const fileRows = [attrRow(0, "b", null, "n0"), attrRow(1, "a", point(49, 0), "g2")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([
        [0, 0, PairingMethod.ELIMINATION],
        [1, 1, PairingMethod.GEOMETRY],
      ]);
    });

    it("should leave non-matching attribute rows for elimination or ambiguity after step (b)", () => {
      // Arrange: one attribute pair matches, the rest of D=3/F=2 stays unpaired.
      const dbRows = [attrRow(0, "a", point(0, 0), "g0"), attrRow(1, "b", point(1, 0), "g1"), attrRow(2, "c", point(2, 0), "g2")];
      const fileRows = [attrRow(0, "c"), attrRow(1, "z")];

      // Act
      const result = pairKeyGroup(dbRows, fileRows, options());

      // Assert
      expect(pairsOf(result)).toEqual([[2, 0, PairingMethod.EXACT]]);
      expect(result.ambiguousDb).toEqual([0, 1]);
      expect(result.ambiguousFile).toEqual([1]);
    });

    it("should produce the same pairs when the input rows are shuffled", () => {
      // Arrange
      const dbRows = [
        attrRow(0, "a", point(0, 0), "g0"),
        attrRow(1, "b", point(1, 0), "g1"),
        attrRow(2, "c", point(2, 0), "g2"),
        attrRow(3, "d", point(3, 0), "g3"),
      ];
      const fileRows = [attrRow(0, "d"), attrRow(1, "a"), attrRow(2, "c"), attrRow(3, "b")];
      const baseline = pairKeyGroup(dbRows, fileRows, options());

      // Act
      const shuffled = pairKeyGroup(
        reorder(dbRows, [2, 0, 3, 1]),
        reorder(fileRows, [3, 1, 0, 2]),
        options()
      );

      // Assert
      expect(shuffled).toEqual(baseline);
      expect(pairsOf(baseline)).toEqual([
        [0, 1, PairingMethod.EXACT],
        [1, 3, PairingMethod.EXACT],
        [2, 2, PairingMethod.EXACT],
        [3, 0, PairingMethod.EXACT],
      ]);
    });
  });
});
