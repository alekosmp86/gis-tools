import { describe, it, expect } from "vitest";
import {
  extractSlugFromUrl,
  formatTitleFromSlug,
} from "@/modules/cartography-watcher/utils/watcherUrls";
import {
  deriveBadgeStateFromResult,
  applyDownloadedResourceDelta,
  recalculateSummaryAfterDownload,
} from "@/modules/cartography-watcher/utils/watcherCalculations";
import {
  type WatcherSourceCheckResult,
  type WatchResourceDelta,
  type SourceCheckSummary,
  DeltaStatus,
  SourceBadgeState,
} from "@/modules/cartography-watcher/types/watcher";

describe("watcherUrls", () => {
  describe("extractSlugFromUrl", () => {
    it("should extract slug from standard CKAN dataset URL", () => {
      // Arrange
      const url = "https://catalogodatos.gub.uy/dataset/ide-direcciones-nacionales";

      // Act
      const slug = extractSlugFromUrl(url);

      // Assert
      expect(slug).toBe("ide-direcciones-nacionales");
    });

    it("should extract slug when URL has trailing subpaths or queries", () => {
      // Arrange
      const url = "https://catalogodatos.gub.uy/dataset/ide-padrones/resource/12345?view=grid";

      // Act
      const slug = extractSlugFromUrl(url);

      // Assert
      expect(slug).toBe("ide-padrones");
    });

    it("should return fallback custom dataset slug for non-CKAN or malformed URLs", () => {
      // Arrange
      const url = "https://example.com/other-path";

      // Act
      const slug = extractSlugFromUrl(url);

      // Assert
      expect(slug).toMatch(/^custom-dataset-/);
    });
  });

  describe("formatTitleFromSlug", () => {
    it("should strip ide prefix and capitalize hyphenated words", () => {
      // Arrange
      const slug = "ide-direcciones-nacionales";

      // Act
      const formattedTitle = formatTitleFromSlug(slug);

      // Assert
      expect(formattedTitle).toBe("Direcciones Nacionales");
    });

    it("should capitalize words when no prefix exists", () => {
      // Arrange
      const slug = "padrones-rurales-montevideo";

      // Act
      const formattedTitle = formatTitleFromSlug(slug);

      // Assert
      expect(formattedTitle).toBe("Padrones Rurales Montevideo");
    });
  });
});

describe("watcherCalculations", () => {
  describe("deriveBadgeStateFromResult", () => {
    it("should return UPDATE_AVAILABLE when updatesCount is greater than zero", () => {
      // Arrange
      const result: WatcherSourceCheckResult = {
        datasetSlug: "test-slug",
        datasetTitle: "Test Dataset",
        datasetModified: "2026-09-01T10:00:00Z",
        totalResources: 2,
        updatesCount: 1,
        resources: [
          {
            resource: { id: "res-1", name: "R1", format: "CSV", url: "https://example.com/r1.csv" },
            status: DeltaStatus.UPDATE_AVAILABLE,
          },
          {
            resource: { id: "res-2", name: "R2", format: "SHP", url: "https://example.com/r2.zip" },
            status: DeltaStatus.UP_TO_DATE,
          },
        ],
      };

      // Act
      const state = deriveBadgeStateFromResult(result);

      // Assert
      expect(state).toBe(SourceBadgeState.UPDATE_AVAILABLE);
    });

    it("should return NOT_DOWNLOADED when zero updates but no resources have been downloaded yet", () => {
      // Arrange
      const result: WatcherSourceCheckResult = {
        datasetSlug: "test-slug",
        datasetTitle: "Test Dataset",
        datasetModified: "2026-09-01T10:00:00Z",
        totalResources: 1,
        updatesCount: 0,
        resources: [
          {
            resource: { id: "res-1", name: "R1", format: "CSV", url: "https://example.com/r1.csv" },
            status: DeltaStatus.NOT_DOWNLOADED,
          },
        ],
      };

      // Act
      const state = deriveBadgeStateFromResult(result);

      // Assert
      expect(state).toBe(SourceBadgeState.NOT_DOWNLOADED);
    });

    it("should return UP_TO_DATE when zero updates and resources are downloaded", () => {
      // Arrange
      const result: WatcherSourceCheckResult = {
        datasetSlug: "test-slug",
        datasetTitle: "Test Dataset",
        datasetModified: "2026-09-01T10:00:00Z",
        totalResources: 1,
        updatesCount: 0,
        resources: [
          {
            resource: { id: "res-1", name: "R1", format: "CSV", url: "https://example.com/r1.csv" },
            status: DeltaStatus.UP_TO_DATE,
          },
        ],
      };

      // Act
      const state = deriveBadgeStateFromResult(result);

      // Assert
      expect(state).toBe(SourceBadgeState.UP_TO_DATE);
    });
  });

  describe("applyDownloadedResourceDelta", () => {
    it("should replace the matching resource delta and recalculate updatesCount", () => {
      // Arrange
      const initialResult: WatcherSourceCheckResult = {
        datasetSlug: "test-slug",
        datasetTitle: "Test Dataset",
        datasetModified: "2026-09-01T10:00:00Z",
        totalResources: 2,
        updatesCount: 2,
        resources: [
          {
            resource: { id: "res-1", name: "R1", format: "CSV", url: "https://example.com/r1.csv" },
            status: DeltaStatus.UPDATE_AVAILABLE,
          },
          {
            resource: { id: "res-2", name: "R2", format: "SHP", url: "https://example.com/r2.zip" },
            status: DeltaStatus.NOT_DOWNLOADED,
          },
        ],
      };

      const downloadedDelta: WatchResourceDelta = {
        resource: { id: "res-1", name: "R1", format: "CSV", url: "https://example.com/r1.csv" },
        status: DeltaStatus.UP_TO_DATE,
      };

      // Act
      const updatedResult = applyDownloadedResourceDelta(initialResult, downloadedDelta);

      // Assert
      expect(updatedResult.updatesCount).toBe(1);
      expect(updatedResult.resources[0].status).toBe(DeltaStatus.UP_TO_DATE);
      expect(updatedResult.resources[1].status).toBe(DeltaStatus.NOT_DOWNLOADED);
    });
  });

  describe("recalculateSummaryAfterDownload", () => {
    it("should decrement updatesCount and transition badge to UP_TO_DATE when no updates remain", () => {
      // Arrange
      const initialSummary: SourceCheckSummary = {
        sourceId: "source-1",
        datasetSlug: "slug-1",
        title: "Title 1",
        status: SourceBadgeState.UPDATE_AVAILABLE,
        totalResources: 3,
        updatesCount: 1,
      };

      // Act
      const updatedSummary = recalculateSummaryAfterDownload(initialSummary);

      // Assert
      expect(updatedSummary.updatesCount).toBe(0);
      expect(updatedSummary.status).toBe(SourceBadgeState.UP_TO_DATE);
    });

    it("should decrement updatesCount and keep UPDATE_AVAILABLE when remaining updates exist", () => {
      // Arrange
      const initialSummary: SourceCheckSummary = {
        sourceId: "source-1",
        datasetSlug: "slug-1",
        title: "Title 1",
        status: SourceBadgeState.UPDATE_AVAILABLE,
        totalResources: 3,
        updatesCount: 2,
      };

      // Act
      const updatedSummary = recalculateSummaryAfterDownload(initialSummary);

      // Assert
      expect(updatedSummary.updatesCount).toBe(1);
      expect(updatedSummary.status).toBe(SourceBadgeState.UPDATE_AVAILABLE);
    });
  });
});
