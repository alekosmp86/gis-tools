import { describe, expect, it } from "vitest";
import {
  INITIAL_CONNECTION,
  isConnectionComplete,
  isSameConnection,
  withConnectionField,
  withProfileValues,
} from "@/modules/coverage-loads/shared/domain/connectionState";

const CONNECTION = { host: "db.example", port: "5432", db_name: "carto", user: "operator", password: "secret" };

describe("connectionState", () => {
  describe("INITIAL_CONNECTION", () => {
    it("should default to localhost:5432 with empty database, user and password", () => {
      // Arrange, Act & Assert
      expect(INITIAL_CONNECTION).toEqual({ host: "localhost", port: "5432", db_name: "", user: "", password: "" });
    });
  });

  describe("isConnectionComplete", () => {
    it("should accept a connection with every required field filled", () => {
      // Arrange, Act & Assert
      expect(isConnectionComplete(CONNECTION)).toBe(true);
    });

    it("should reject the initial connection, which has no database or user", () => {
      // Arrange, Act & Assert
      expect(isConnectionComplete(INITIAL_CONNECTION)).toBe(false);
    });

    it.each(["host", "port", "db_name", "user"] as const)("should reject a connection whose %s is empty", (field) => {
      // Arrange
      const connection = { ...CONNECTION, [field]: "" };

      // Act & Assert
      expect(isConnectionComplete(connection)).toBe(false);
    });

    it.each(["host", "port", "db_name", "user"] as const)("should reject a connection whose %s is whitespace only", (field) => {
      // Arrange
      const connection = { ...CONNECTION, [field]: "   \t" };

      // Act & Assert
      expect(isConnectionComplete(connection)).toBe(false);
    });

    it("should not require the password", () => {
      // Arrange, Act & Assert
      expect(isConnectionComplete({ ...CONNECTION, password: "" })).toBe(true);
    });
  });

  describe("withConnectionField", () => {
    it("should return a copy with only that field replaced", () => {
      // Arrange & Act
      const next = withConnectionField(CONNECTION, "db_name", "other");

      // Assert
      expect(next).toEqual({ ...CONNECTION, db_name: "other" });
      expect(next).not.toBe(CONNECTION);
    });

    it("should not mutate the original connection", () => {
      // Arrange
      const original = { ...CONNECTION };

      // Act
      withConnectionField(original, "host", "elsewhere");

      // Assert
      expect(original).toEqual(CONNECTION);
    });

    it("should store the value verbatim without trimming", () => {
      // Arrange & Act
      const next = withConnectionField(CONNECTION, "user", "  padded  ");

      // Assert
      expect(next.user).toBe("  padded  ");
    });
  });

  describe("withProfileValues", () => {
    it("should apply only the given values, keep the rest and clear the password", () => {
      // Arrange & Act
      const next = withProfileValues({ ...CONNECTION, password: "typed" }, { host: "other", db_name: "dev" });

      // Assert
      expect(next).toEqual({ host: "other", port: "5432", db_name: "dev", user: "operator", password: "" });
    });

    it("should still clear the password when the profile carries no values", () => {
      // Arrange & Act
      const next = withProfileValues(CONNECTION, {});

      // Assert
      expect(next).toEqual({ ...CONNECTION, password: "" });
    });

    it("should not mutate the original connection", () => {
      // Arrange
      const original = { ...CONNECTION };

      // Act
      withProfileValues(original, { host: "other" });

      // Assert
      expect(original).toEqual(CONNECTION);
    });
  });

  describe("isSameConnection", () => {
    it("should be true for equal connections, including a distinct copy", () => {
      // Arrange, Act & Assert
      expect(isSameConnection(CONNECTION, { ...CONNECTION })).toBe(true);
    });

    it.each(["host", "port", "db_name", "user", "password"] as const)("should be false when only %s differs", (field) => {
      // Arrange
      const other = { ...CONNECTION, [field]: `${CONNECTION[field]}-changed` };

      // Act & Assert
      expect(isSameConnection(CONNECTION, other)).toBe(false);
      expect(isSameConnection(other, CONNECTION)).toBe(false);
    });
  });
});
