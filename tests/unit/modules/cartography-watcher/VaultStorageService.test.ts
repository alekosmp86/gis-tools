import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VaultStorageService } from "@/modules/cartography-watcher/services/VaultStorageService";
import type { CkanResource } from "@/modules/cartography-watcher/types/watcher";

describe("VaultStorageService", () => {
  let tempDir: string;
  let vault: VaultStorageService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-test-"));
    vault = new VaultStorageService(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("saveVaultResource and local persistence", () => {
    it("should persist binary buffer and create sidecar .meta.json file", async () => {
      // Arrange
      const resource: CkanResource = {
        id: "res-artigas",
        name: "Artigas Vias",
        format: "CSV",
        url: "https://example.com/artigas.csv",
        hash: "md5-artigas-hash",
        last_modified: "2026-09-01T12:00:00Z",
      };
      const content = Buffer.from("id,nombre\n1,Artigas\n", "utf-8");

      // Act
      const meta = await vault.saveVaultResource("ejes-vias", resource, content);

      // Assert
      expect(meta.resourceId).toBe("res-artigas");
      expect(meta.fileSize).toBe(content.byteLength);
      expect(meta.hash).toBe("md5-artigas-hash");
      expect(fs.existsSync(meta.localFilePath)).toBe(true);

      const isCached = vault.isResourceCached("ejes-vias", "res-artigas");
      expect(isCached).toBe(true);

      const readMeta = await vault.readResourceMeta("ejes-vias", "res-artigas");
      expect(readMeta).toBeDefined();
      expect(readMeta?.resourceName).toBe("Artigas Vias");

      const vaultFile = await vault.getVaultFile("ejes-vias", "res-artigas");
      expect(vaultFile).toBeDefined();
      expect(vaultFile?.content.toString("utf-8")).toBe("id,nombre\n1,Artigas\n");
    });
  });
});
