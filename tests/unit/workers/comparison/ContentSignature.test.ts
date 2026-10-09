import { describe, it, expect } from "vitest";
import { buildContentSignature } from "@/core/workers/comparison/ContentSignature";

describe("buildContentSignature", () => {
  it("should return equal signatures when records are identical", () => {
    // Arrange
    const a = { id: "1", name: "X" };
    const b = { id: "1", name: "X" };

    // Act
    const sigA = buildContentSignature(a, ["id", "name"]);
    const sigB = buildContentSignature(b, ["id", "name"]);

    // Assert
    expect(sigA).toBe(sigB);
  });

  it("should return different signatures when one cleaned value differs", () => {
    // Arrange
    const a = { id: "1", name: "X" };
    const b = { id: "1", name: "Y" };

    // Act / Assert
    expect(buildContentSignature(a, ["id", "name"])).not.toBe(
      buildContentSignature(b, ["id", "name"])
    );
  });

  it("should look columns up case-insensitively", () => {
    // Arrange
    const a = { ID: "1", Name: "X" };
    const b = { id: "1", name: "X" };

    // Act / Assert
    expect(buildContentSignature(a, ["id", "NAME"])).toBe(
      buildContentSignature(b, ["id", "name"])
    );
  });

  it("should clean quotes, whitespace and .0 suffix before comparing", () => {
    // Arrange
    const a = { id: '  "12.0" ', name: " X " };
    const b = { id: 12, name: "X" };

    // Act / Assert
    expect(buildContentSignature(a, ["id", "name"])).toBe(
      buildContentSignature(b, ["id", "name"])
    );
  });

  it("should ignore geometry and columns not listed", () => {
    // Arrange
    const a = { id: "1", _geometry: { type: "Point", coordinates: [1, 2] }, extra: "a" };
    const b = { id: "1", _geometry: { type: "Point", coordinates: [9, 9] }, extra: "b" };

    // Act / Assert
    expect(buildContentSignature(a, ["id"])).toBe(buildContentSignature(b, ["id"]));
  });

  it("should not collide when a pipe is inside a value versus separate columns", () => {
    // Arrange
    const joined = { a: "x|y" };
    const split = { a: "x", b: "y" };

    // Act / Assert
    expect(buildContentSignature(joined, ["a"])).not.toBe(
      buildContentSignature(split, ["a", "b"])
    );
  });

  it("should not collide when a value moves between columns", () => {
    // Arrange
    const a = { a: "x", b: "" };
    const b = { a: "", b: "x" };

    // Act / Assert
    expect(buildContentSignature(a, ["a", "b"])).not.toBe(
      buildContentSignature(b, ["a", "b"])
    );
  });

  it("should treat missing columns like empty values and handle no columns", () => {
    // Act
    const missing = buildContentSignature({}, ["a"]);
    const empty = buildContentSignature({ a: "" }, ["a"]);

    // Assert
    expect(missing).toBe(empty);
    expect(buildContentSignature({ a: "1" }, [])).toBe(buildContentSignature({ b: "2" }, []));
  });

  describe("geometry and options", () => {
    const g1 = { type: "Point", coordinates: [1, 2] };
    const g2 = { type: "Point", coordinates: [9, 9] };

    it("should differ when attributes match but geometry differs", () => {
      expect(buildContentSignature({ id: "1" }, ["id"], g1)).not.toBe(
        buildContentSignature({ id: "1" }, ["id"], g2)
      );
    });

    it("should match when attributes and geometry are the same", () => {
      expect(buildContentSignature({ id: "1" }, ["id"], g1)).toBe(
        buildContentSignature({ id: "1" }, ["id"], { ...g1 })
      );
    });

    it("should use a fixed token for null and undefined geometry", () => {
      const viaNull = buildContentSignature({ id: "1" }, ["id"], null);
      const viaOptions = buildContentSignature({ id: "1" }, ["id"], undefined, {});
      expect(viaNull).toBe(viaOptions);
      expect(viaNull).not.toBe(buildContentSignature({ id: "1" }, ["id"], g1));
    });

    it("should stay backward compatible with the 2-arg form", () => {
      expect(buildContentSignature({ id: "1" }, ["id"])).toBe(JSON.stringify(["1"]));
    });

    it("should sign all non-geometry keys sorted when allProperties is set", () => {
      const opts = { allProperties: true };
      const a = { b: "2", a: "1", _geometry: g1, Geometry: g2 };
      expect(buildContentSignature(a, [], undefined, opts)).toBe(
        buildContentSignature({ a: "1", b: "2" }, [], undefined, opts)
      );
      expect(buildContentSignature({ a: "1", b: "3" }, [], undefined, opts)).not.toBe(
        buildContentSignature({ a: "1", b: "2" }, [], undefined, opts)
      );
    });

    it("should normalize SUID columns through cleanSuidPart and others through cleanValue", () => {
      const options = {
        suidColumns: ["ID"],
        cleanSuidPart: (v: unknown) => (String(v).toLowerCase() === "n/a" ? "" : String(v)),
      };
      expect(buildContentSignature({ id: "N/A", n: "x" }, ["id", "n"], undefined, options)).toBe(
        buildContentSignature({ id: "", n: "x" }, ["id", "n"], undefined, options)
      );
      expect(buildContentSignature({ id: "1", n: "N/A" }, ["id", "n"], undefined, options)).not.toBe(
        buildContentSignature({ id: "1", n: "" }, ["id", "n"], undefined, options)
      );
    });
  });
});
