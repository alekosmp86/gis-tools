import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatDate,
  getTargetSyncUrl,
} from "@/modules/cartography-watcher/utils/watcherFormatters";

describe("watcherFormatters", () => {
  describe("formatBytes", () => {
    it("should format megabytes with two decimal places", () => {
      // Arrange
      const rawBytes = 5.25 * 1024 * 1024;

      // Act
      const formatted = formatBytes(rawBytes);

      // Assert
      expect(formatted).toBe("5.25 MB");
    });

    it("should format kilobytes with one decimal place", () => {
      // Arrange
      const rawBytes = 150.4 * 1024;

      // Act
      const formatted = formatBytes(rawBytes);

      // Assert
      expect(formatted).toBe("150.4 KB");
    });

    it("should return fallback for undefined, null, zero, or negative bytes", () => {
      expect(formatBytes(null)).toBe("Desconocido");
      expect(formatBytes(undefined)).toBe("Desconocido");
      expect(formatBytes(0)).toBe("Desconocido");
      expect(formatBytes(-100)).toBe("Desconocido");
    });
  });

  describe("formatDate", () => {
    it("should format ISO date strings into DD/MM/YYYY by default", () => {
      // Arrange
      const dateString = "2026-09-08T15:30:00Z";

      // Act
      const formatted = formatDate(dateString);

      // Assert
      expect(formatted).toBe("08/09/2026");
    });

    it("should include hours and minutes when includeTime is true", () => {
      // Arrange
      const dateString = "2026-09-08T15:30:00Z";

      // Act
      const formatted = formatDate(dateString, true);

      // Assert
      expect(formatted).toBe("08/09/2026 15:30");
    });

    it("should return fallback for null or empty dates", () => {
      expect(formatDate(null)).toBe("Fecha no disponible");
      expect(formatDate("")).toBe("Fecha no disponible");
      expect(formatDate(undefined)).toBe("Fecha no disponible");
    });

    it("should return raw string when parsing fails", () => {
      // Arrange
      const invalidDateString = "not-a-valid-date";

      // Act
      const formatted = formatDate(invalidDateString);

      // Assert
      expect(formatted).toBe("not-a-valid-date");
    });
  });

  describe("getTargetSyncUrl", () => {
    it("should return db-csv-sync route for CSV resources", () => {
      // Arrange
      const format = "CSV";
      const sourceSlug = "ide-direcciones";
      const resourceId = "res-csv-123";

      // Act
      const url = getTargetSyncUrl(format, sourceSlug, resourceId);

      // Assert
      expect(url).toBe(
        "/tools/db-csv-sync?sourceSlug=ide-direcciones&resourceId=res-csv-123"
      );
    });

    it("should return db-shapefile-sync route for SHP or ZIP resources", () => {
      // Arrange
      const format = "SHP (ZIP)";
      const sourceSlug = "ide-padrones";
      const resourceId = "res-shp-456";

      // Act
      const url = getTargetSyncUrl(format, sourceSlug, resourceId);

      // Assert
      expect(url).toBe(
        "/tools/db-shapefile-sync?sourceSlug=ide-padrones&resourceId=res-shp-456"
      );
    });

    it("should return null if resourceId is missing or format is unsupported", () => {
      expect(getTargetSyncUrl("CSV", "slug", undefined)).toBeNull();
      expect(getTargetSyncUrl("PDF", "slug", "res-123")).toBeNull();
      expect(getTargetSyncUrl(null, "slug", "res-123")).toBeNull();
    });
  });
});
