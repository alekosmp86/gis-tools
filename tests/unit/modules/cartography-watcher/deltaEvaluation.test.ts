import { describe, it, expect } from "vitest";
import {
  countPendingResources,
  evaluateResourceDelta,
} from "@/modules/cartography-watcher/domain/deltaEvaluation";
import { DeltaStatus } from "@/modules/cartography-watcher/types";
import type { CkanResource, VaultResourceMeta } from "@/modules/cartography-watcher/types";

function buildResource(overrides: Partial<CkanResource> = {}): CkanResource {
  return {
    id: "resource-1",
    name: "Ejes viales - FLORES",
    format: "CSV",
    url: "https://catalogodatos.gub.uy/dataset/x/resource/y/download/flores.csv",
    ...overrides,
  };
}

function buildMeta(overrides: Partial<VaultResourceMeta> = {}): VaultResourceMeta {
  return {
    resourceId: "resource-1",
    resourceName: "Ejes viales - FLORES",
    format: "CSV",
    hash: "abc123",
    remoteLastModified: "2026-09-01T10:00:00.000Z",
    downloadedAt: "2026-09-01T11:00:00.000Z",
    fileSize: 1000,
    relativeFilePath: "ide-ejes/flores.csv",
    ...overrides,
  };
}

describe("evaluateResourceDelta", () => {
  it("should report a resource with no local copy as not downloaded", () => {
    // Arrange & Act
    const delta = evaluateResourceDelta(buildResource(), null);

    // Assert
    expect(delta.status).toBe(DeltaStatus.NOT_DOWNLOADED);
    expect(delta.localMeta).toBeNull();
  });

  it("should report an update when the published checksum differs", () => {
    // Arrange
    const resource = buildResource({ hash: "def456" });

    // Act
    const delta = evaluateResourceDelta(resource, buildMeta({ hash: "abc123" }));

    // Assert
    expect(delta.status).toBe(DeltaStatus.UPDATE_AVAILABLE);
    expect(delta.reason).toContain("Suma de verificación");
  });

  it("should trust a matching checksum even when the timestamp moved", () => {
    // Arrange: publishers touch metadata without changing content; the checksum is the truth.
    const resource = buildResource({
      hash: "abc123",
      last_modified: "2026-09-05T10:00:00.000Z",
    });

    // Act
    const delta = evaluateResourceDelta(resource, buildMeta({ hash: "abc123" }));

    // Assert
    expect(delta.status).toBe(DeltaStatus.UP_TO_DATE);
  });

  it("should report an update when the remote publication is newer", () => {
    // Arrange
    const resource = buildResource({ last_modified: "2026-09-05T10:00:00.000Z" });

    // Act
    const delta = evaluateResourceDelta(
      resource,
      buildMeta({ hash: "", remoteLastModified: "2026-09-01T10:00:00.000Z" })
    );

    // Assert
    expect(delta.status).toBe(DeltaStatus.UPDATE_AVAILABLE);
    expect(delta.reason).toContain("versión más reciente");
  });

  it("should fall back to metadata_modified when last_modified is absent", () => {
    // Arrange
    const resource = buildResource({
      last_modified: null,
      metadata_modified: "2026-09-05T10:00:00.000Z",
    });

    // Act
    const delta = evaluateResourceDelta(resource, buildMeta({ hash: "" }));

    // Assert
    expect(delta.status).toBe(DeltaStatus.UPDATE_AVAILABLE);
  });

  it("should treat an identical timestamp as up to date", () => {
    // Arrange: equal is not newer.
    const resource = buildResource({ last_modified: "2026-09-01T10:00:00.000Z" });

    // Act
    const delta = evaluateResourceDelta(
      resource,
      buildMeta({ hash: "", remoteLastModified: "2026-09-01T10:00:00.000Z" })
    );

    // Assert
    expect(delta.status).toBe(DeltaStatus.UP_TO_DATE);
  });

  it("should treat an older remote timestamp as up to date rather than an update", () => {
    // Arrange: a portal that revises a date backwards must not trigger a pointless re-download.
    const resource = buildResource({ last_modified: "2026-08-01T10:00:00.000Z" });

    // Act
    const delta = evaluateResourceDelta(
      resource,
      buildMeta({ hash: "", remoteLastModified: "2026-09-01T10:00:00.000Z" })
    );

    // Assert
    expect(delta.status).toBe(DeltaStatus.UP_TO_DATE);
  });

  it("should ignore an unparseable timestamp instead of guessing", () => {
    // Arrange
    const resource = buildResource({ last_modified: "no-es-una-fecha" });

    // Act
    const delta = evaluateResourceDelta(resource, buildMeta({ hash: "" }));

    // Assert
    expect(delta.status).toBe(DeltaStatus.UP_TO_DATE);
  });

  it("should use file size only when neither checksum nor timestamp is published", () => {
    // Arrange
    const resource = buildResource({
      hash: undefined,
      last_modified: null,
      metadata_modified: null,
      size: 2000,
    });

    // Act
    const delta = evaluateResourceDelta(resource, buildMeta({ hash: "", fileSize: 1000 }));

    // Assert
    expect(delta.status).toBe(DeltaStatus.UPDATE_AVAILABLE);
    expect(delta.reason).toContain("tamaño");
  });

  it("should not consult file size when a timestamp was published", () => {
    // Arrange: a same-date edit that changes length is not evidence of a new publication.
    const resource = buildResource({
      hash: undefined,
      last_modified: "2026-09-01T10:00:00.000Z",
      size: 2000,
    });

    // Act
    const delta = evaluateResourceDelta(
      resource,
      buildMeta({ hash: "", remoteLastModified: "2026-09-01T10:00:00.000Z", fileSize: 1000 })
    );

    // Assert
    expect(delta.status).toBe(DeltaStatus.UP_TO_DATE);
  });

  it("should not compare checksums when only one side publishes one", () => {
    // Arrange: an absent remote hash is not a mismatch.
    const resource = buildResource({ hash: undefined, last_modified: null, metadata_modified: null });

    // Act
    const delta = evaluateResourceDelta(resource, buildMeta({ hash: "abc123", fileSize: 1000 }));

    // Assert
    expect(delta.status).toBe(DeltaStatus.UP_TO_DATE);
  });
});

describe("countPendingResources", () => {
  it("should count both outdated and never-downloaded resources", () => {
    // Arrange
    const deltas = [
      evaluateResourceDelta(buildResource({ id: "a" }), null),
      evaluateResourceDelta(buildResource({ id: "b", hash: "zzz" }), buildMeta({ hash: "aaa" })),
      evaluateResourceDelta(buildResource({ id: "c", hash: "aaa" }), buildMeta({ hash: "aaa" })),
    ];

    // Act & Assert: two of the three need action.
    expect(countPendingResources(deltas)).toBe(2);
  });

  it("should count nothing when every resource is current", () => {
    // Arrange
    const deltas = [evaluateResourceDelta(buildResource({ hash: "aaa" }), buildMeta({ hash: "aaa" }))];

    // Assert
    expect(countPendingResources(deltas)).toBe(0);
  });
});
