import { describe, it, expect } from "vitest";
import { CkanPortalClient } from "@/modules/cartography-watcher/services/CkanPortalClient";
import {
  type CkanResource,
  type VaultResourceMeta,
  DeltaStatus,
} from "@/modules/cartography-watcher/types/watcher";

describe("CkanPortalClient", () => {
  const client = new CkanPortalClient();

  describe("parsePortalUrl", () => {
    it("should parse standard dataset URL", () => {
      // Arrange
      const url = "https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion";

      // Act
      const result = client.parsePortalUrl(url);

      // Assert
      expect(result.host).toBe("catalogodatos.gub.uy");
      expect(result.datasetSlug).toBe("ide-ejes-vias-circulacion");
    });

    it("should parse Direcciones Geograficas dataset URL", () => {
      // Arrange
      const url = "https://catalogodatos.gub.uy/dataset/ide-direcciones-geograficas-del-uruguay";

      // Act
      const result = client.parsePortalUrl(url);

      // Assert
      expect(result.host).toBe("catalogodatos.gub.uy");
      expect(result.datasetSlug).toBe("ide-direcciones-geograficas-del-uruguay");
    });

    it("should parse deep resource URL and extract the dataset slug", () => {
      // Arrange
      const url =
        "https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion/resource/6f454696-b934-4c47-99c3-c76086ed75de?inner_span=True";

      // Act
      const result = client.parsePortalUrl(url);

      // Assert
      expect(result.host).toBe("catalogodatos.gub.uy");
      expect(result.datasetSlug).toBe("ide-ejes-vias-circulacion");
    });

    it("should accept plain dataset slug without protocol", () => {
      // Arrange
      const slug = "ide-ejes-vias-circulacion";

      // Act
      const result = client.parsePortalUrl(slug);

      // Assert
      expect(result.host).toBe("catalogodatos.gub.uy");
      expect(result.datasetSlug).toBe("ide-ejes-vias-circulacion");
    });

    it("should throw an error for empty or blank input", () => {
      // Arrange & Act & Assert
      expect(() => client.parsePortalUrl("")).toThrow("no puede estar vacío");
      expect(() => client.parsePortalUrl("   ")).toThrow("no puede estar vacío");
    });

    it("should throw an error for URLs lacking a dataset segment", () => {
      // Arrange
      const invalidUrl = "https://catalogodatos.gub.uy/about";

      // Act & Assert
      expect(() => client.parsePortalUrl(invalidUrl)).toThrow("No se pudo identificar el slug");
    });
  });

  describe("evaluateResourceDelta", () => {
    const mockRemoteResource: CkanResource = {
      id: "res-artigas-01",
      name: "Ejes de vías de circulación - ARTIGAS",
      format: "CSV",
      url: "https://catalogodatos.gub.uy/download/artigas.csv",
      hash: "abc123md5hash",
      last_modified: "2026-09-01T06:30:37.000Z",
      size: 2000000,
    };

    it("should return NOT_DOWNLOADED when no local vault metadata exists", () => {
      // Act
      const delta = client.evaluateResourceDelta(mockRemoteResource, null);

      // Assert
      expect(delta.status).toBe(DeltaStatus.NOT_DOWNLOADED);
      expect(delta.localMeta).toBeNull();
    });

    it("should return UP_TO_DATE when hashes match exactly", () => {
      // Arrange
      const localMeta: VaultResourceMeta = {
        resourceId: "res-artigas-01",
        resourceName: "Ejes de vías de circulación - ARTIGAS",
        format: "CSV",
        hash: "abc123md5hash",
        remoteLastModified: "2026-09-01T06:30:37.000Z",
        downloadedAt: "2026-09-02T10:00:00.000Z",
        fileSize: 2000000,
        localFilePath: "/data/vault/artigas.csv",
        relativeFilePath: "data/vault/artigas.csv",
      };

      // Act
      const delta = client.evaluateResourceDelta(mockRemoteResource, localMeta);

      // Assert
      expect(delta.status).toBe(DeltaStatus.UP_TO_DATE);
    });

    it("should return UPDATE_AVAILABLE when remote MD5 hash differs from local hash", () => {
      // Arrange
      const localMeta: VaultResourceMeta = {
        resourceId: "res-artigas-01",
        resourceName: "Ejes de vías de circulación - ARTIGAS",
        format: "CSV",
        hash: "OLD_DIFFERENT_HASH",
        remoteLastModified: "2026-08-01T06:30:37.000Z",
        downloadedAt: "2026-08-02T10:00:00.000Z",
        fileSize: 1950000,
        localFilePath: "/data/vault/artigas.csv",
        relativeFilePath: "data/vault/artigas.csv",
      };

      // Act
      const delta = client.evaluateResourceDelta(mockRemoteResource, localMeta);

      // Assert
      expect(delta.status).toBe(DeltaStatus.UPDATE_AVAILABLE);
      expect(delta.reason).toContain("MD5");
    });

    it("should return UPDATE_AVAILABLE when remote timestamp is newer than local timestamp", () => {
      // Arrange: remote has no hash, but timestamp is newer
      const unhashedRemote: CkanResource = {
        ...mockRemoteResource,
        hash: undefined,
        last_modified: "2026-09-05T00:00:00.000Z",
      };

      const localMeta: VaultResourceMeta = {
        resourceId: "res-artigas-01",
        resourceName: "Ejes de vías de circulación - ARTIGAS",
        format: "CSV",
        hash: "",
        remoteLastModified: "2026-09-01T00:00:00.000Z",
        downloadedAt: "2026-09-02T10:00:00.000Z",
        fileSize: 2000000,
        localFilePath: "/data/vault/artigas.csv",
        relativeFilePath: "data/vault/artigas.csv",
      };

      // Act
      const delta = client.evaluateResourceDelta(unhashedRemote, localMeta);

      // Assert
      expect(delta.status).toBe(DeltaStatus.UPDATE_AVAILABLE);
      expect(delta.reason).toContain("Nueva versión");
    });
  });
});
