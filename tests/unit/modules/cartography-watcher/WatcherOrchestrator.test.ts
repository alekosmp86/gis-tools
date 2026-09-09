import { describe, it, expect, vi } from "vitest";
import { WatcherOrchestrator } from "@/modules/cartography-watcher/services/WatcherOrchestrator";
import { CkanPortalClient } from "@/modules/cartography-watcher/services/CkanPortalClient";
import { VaultStorageService } from "@/modules/cartography-watcher/services/VaultStorageService";
import {
  type CkanPackage,
  type WatchedSourceConfig,
  SourceBadgeState,
} from "@/modules/cartography-watcher/types/watcher";

describe("WatcherOrchestrator", () => {
  it("should evaluate multiple sources and aggregate badge states", async () => {
    // Arrange
    const mockClient = new CkanPortalClient();
    const mockVault = new VaultStorageService();

    const mockPackageVias: CkanPackage = {
      id: "pkg-1",
      name: "ide-ejes-vias-circulacion",
      title: "Ejes de vías de circulación",
      metadata_modified: "2026-09-01T00:00:00Z",
      resources: [
        {
          id: "res-1",
          name: "Artigas CSV",
          format: "CSV",
          url: "https://example.com/artigas.csv",
          hash: "hash-artigas-123",
          last_modified: "2026-09-01T00:00:00Z",
        },
      ],
    };

    const mockPackageDirecciones: CkanPackage = {
      id: "pkg-2",
      name: "ide-direcciones-geograficas-del-uruguay",
      title: "Direcciones Geográficas del Uruguay",
      metadata_modified: "2026-09-01T00:00:00Z",
      resources: [
        {
          id: "res-2",
          name: "Montevideo CSV",
          format: "CSV",
          url: "https://example.com/mvd.csv",
          hash: "hash-mvd-456",
          last_modified: "2026-09-01T00:00:00Z",
        },
      ],
    };

    vi.spyOn(mockClient, "parsePortalUrl").mockImplementation((urlOrSlug) => {
      if (urlOrSlug.includes("direcciones")) {
        return { host: "catalogodatos.gub.uy", datasetSlug: "ide-direcciones-geograficas-del-uruguay" };
      }
      return { host: "catalogodatos.gub.uy", datasetSlug: "ide-ejes-vias-circulacion" };
    });

    vi.spyOn(mockClient, "fetchPackageMetadata").mockImplementation(async (datasetSlug) => {
      if (datasetSlug === "ide-direcciones-geograficas-del-uruguay") {
        return mockPackageDirecciones;
      }
      return mockPackageVias;
    });

    // Mock vault: res-1 has local meta matching hash (UP_TO_DATE), res-2 has no local meta (NOT_DOWNLOADED)
    vi.spyOn(mockVault, "readResourceMeta").mockImplementation(async (_slug, resourceId) => {
      if (resourceId === "res-1") {
        return {
          resourceId: "res-1",
          resourceName: "Artigas CSV",
          format: "CSV",
          hash: "hash-artigas-123",
          remoteLastModified: "2026-09-01T00:00:00Z",
          downloadedAt: "2026-09-02T00:00:00Z",
          fileSize: 1000,
          localFilePath: "/data/vault/artigas.csv",
          relativeFilePath: "data/vault/artigas.csv",
        };
      }
      return null;
    });

    const orchestrator = new WatcherOrchestrator(mockClient, mockVault);

    const sources: WatchedSourceConfig[] = [
      {
        id: "vias",
        title: "Ejes de vías",
        url: "https://catalogodatos.gub.uy/dataset/ide-ejes-vias-circulacion",
        datasetSlug: "ide-ejes-vias-circulacion",
      },
      {
        id: "direcciones",
        title: "Direcciones Geográficas",
        url: "https://catalogodatos.gub.uy/dataset/ide-direcciones-geograficas-del-uruguay",
        datasetSlug: "ide-direcciones-geograficas-del-uruguay",
      },
    ];

    // Act
    const summaries = await orchestrator.checkMultipleSources(sources);

    // Assert
    expect(summaries).toHaveLength(2);

    const viasSummary = summaries.find((item) => item.sourceId === "vias");
    expect(viasSummary).toBeDefined();
    expect(viasSummary?.status).toBe(SourceBadgeState.UP_TO_DATE);
    expect(viasSummary?.updatesCount).toBe(0);

    const direccionesSummary = summaries.find((item) => item.sourceId === "direcciones");
    expect(direccionesSummary).toBeDefined();
    expect(direccionesSummary?.status).toBe(SourceBadgeState.UPDATE_AVAILABLE);
    expect(direccionesSummary?.updatesCount).toBe(1);
    expect(direccionesSummary?.totalResources).toBe(1);
  });

  it("should mark source with error if fetch fails", async () => {
    // Arrange
    const mockClient = new CkanPortalClient();
    const mockVault = new VaultStorageService();

    vi.spyOn(mockClient, "parsePortalUrl").mockReturnValue({
      host: "catalogodatos.gub.uy",
      datasetSlug: "invalid-source",
    });

    vi.spyOn(mockClient, "fetchPackageMetadata").mockRejectedValue(
      new Error("Network connection timeout")
    );

    const orchestrator = new WatcherOrchestrator(mockClient, mockVault);

    const sources: WatchedSourceConfig[] = [
      {
        id: "invalid",
        title: "Invalid Source",
        url: "https://catalogodatos.gub.uy/dataset/invalid-source",
        datasetSlug: "invalid-source",
      },
    ];

    // Act
    const summaries = await orchestrator.checkMultipleSources(sources);

    // Assert
    expect(summaries).toHaveLength(1);
    expect(summaries[0].status).toBe(SourceBadgeState.ERROR);
    expect(summaries[0].errorMessage).toContain("Network connection timeout");
  });

  it("should coordinate downloading resource binary and saving to vault", async () => {
    // Arrange
    const mockClient = new CkanPortalClient();
    const mockVault = new VaultStorageService();

    vi.spyOn(mockClient, "parsePortalUrl").mockReturnValue({
      host: "catalogodatos.gub.uy",
      datasetSlug: "ejes-vias",
    });

    vi.spyOn(mockClient, "fetchPackageMetadata").mockResolvedValue({
      id: "pkg-1",
      name: "ejes-vias",
      title: "Ejes de vías",
      metadata_modified: "2026-09-01T00:00:00Z",
      resources: [
        {
          id: "res-1",
          name: "Artigas CSV",
          format: "CSV",
          url: "https://example.com/artigas.csv",
        },
      ],
    });

    const mockBuffer = Buffer.from("csv-content");
    vi.spyOn(mockClient, "downloadResourceBinary").mockResolvedValue(mockBuffer);
    vi.spyOn(mockVault, "saveVaultResource").mockResolvedValue({
      resourceId: "res-1",
      resourceName: "Artigas CSV",
      format: "CSV",
      hash: "",
      remoteLastModified: "2026-09-01T00:00:00Z",
      downloadedAt: "2026-09-01T00:00:00Z",
      fileSize: mockBuffer.byteLength,
      localFilePath: "/path/to/artigas.csv",
      relativeFilePath: "data/vault/artigas.csv",
    });

    const orchestrator = new WatcherOrchestrator(mockClient, mockVault);

    // Act
    const result = await orchestrator.downloadResource("ejes-vias", "res-1");

    // Assert
    expect(mockClient.downloadResourceBinary).toHaveBeenCalledWith("https://example.com/artigas.csv");
    expect(mockVault.saveVaultResource).toHaveBeenCalledWith(
      "ejes-vias",
      expect.objectContaining({ id: "res-1" }),
      mockBuffer
    );
    expect(result.meta.resourceId).toBe("res-1");
    expect(result.content).toBe(mockBuffer);
  });
});
