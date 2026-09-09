import fs from "node:fs";
import path from "node:path";
import {
  type CkanResource,
  type VaultResourceMeta,
  SpatialFileFormat,
} from "../types/watcher";
import { sanitizeSlug, resolveResourceFilename } from "../utils/vaultNaming";

/**
 * VaultStorageService.ts
 * Manages local storage of the latest cartographic datasets under data/vault/<source_slug>/.
 * Enforces single latest file storage with sidecar JSON metadata.
 * Strictly scoped to local file system operations (SRP).
 */
export class VaultStorageService {
  private readonly baseVaultDir: string;

  constructor(customBaseDir?: string) {
    this.baseVaultDir =
      customBaseDir ?? path.join(process.cwd(), "data", "vault");
  }

  private getSourceDir(sourceSlug: string): string {
    const cleanSource = sanitizeSlug(sourceSlug);
    return path.join(this.baseVaultDir, cleanSource);
  }

  /**
   * Reads the sidecar metadata for a given resource in the vault.
   */
  public async readResourceMeta(
    sourceSlug: string,
    resourceId: string
  ): Promise<VaultResourceMeta | null> {
    const sourceDir = this.getSourceDir(sourceSlug);
    const metaFilename = `${sanitizeSlug(resourceId)}.meta.json`;
    const metaFilePath = path.join(sourceDir, metaFilename);

    try {
      if (!fs.existsSync(metaFilePath)) {
        return null;
      }
      const rawJson = await fs.promises.readFile(metaFilePath, "utf-8");
      return JSON.parse(rawJson) as VaultResourceMeta;
    } catch {
      return null;
    }
  }

  /**
   * Checks synchronously whether a resource metadata file exists in the vault.
   */
  public isResourceCached(sourceSlug: string, resourceId: string): boolean {
    const metaFilePath = path.join(
      this.getSourceDir(sourceSlug),
      `${sanitizeSlug(resourceId)}.meta.json`
    );
    return fs.existsSync(metaFilePath);
  }

  /**
   * Lists all vault entries stored under a given source slug.
   */
  public async listVaultEntries(sourceSlug: string): Promise<VaultResourceMeta[]> {
    const sourceDir = this.getSourceDir(sourceSlug);
    if (!fs.existsSync(sourceDir)) {
      return [];
    }

    const files = await fs.promises.readdir(sourceDir);
    const metaFiles = files.filter((file) => file.endsWith(".meta.json"));
    const readPromises = metaFiles.map(async (metaFile) => {
      try {
        const fullPath = path.join(sourceDir, metaFile);
        const content = await fs.promises.readFile(fullPath, "utf-8");
        return JSON.parse(content) as VaultResourceMeta;
      } catch {
        return null;
      }
    });

    const entries = await Promise.all(readPromises);
    return entries.filter((entry): entry is VaultResourceMeta => entry !== null);
  }

  /**
   * Retrieves the raw content and metadata of a vaulted resource.
   */
  public async getVaultFile(
    sourceSlug: string,
    resourceId: string
  ): Promise<{ meta: VaultResourceMeta; content: Buffer } | null> {
    const meta = await this.readResourceMeta(sourceSlug, resourceId);
    if (!meta || !meta.localFilePath || !fs.existsSync(meta.localFilePath)) {
      return null;
    }

    const content = await fs.promises.readFile(meta.localFilePath);
    return { meta, content };
  }

  /**
   * Saves a binary file and its sidecar metadata into the vault under the specified source slug.
   * Overwrites single latest file.
   */
  public async saveVaultResource(
    sourceSlug: string,
    resource: CkanResource,
    content: Buffer
  ): Promise<VaultResourceMeta> {
    const sourceDir = this.getSourceDir(sourceSlug);
    if (!fs.existsSync(sourceDir)) {
      await fs.promises.mkdir(sourceDir, { recursive: true });
    }

    const targetFilename = resolveResourceFilename(resource);
    const targetFilePath = path.join(sourceDir, targetFilename);

    // Save the binary file to disk
    await fs.promises.writeFile(targetFilePath, content);

    // Create and save the sidecar metadata
    const relativePath = path.relative(process.cwd(), targetFilePath).replace(/\\/g, "/");
    const metaData: VaultResourceMeta = {
      resourceId: resource.id,
      resourceName: resource.name,
      format: resource.format || SpatialFileFormat.CSV,
      hash: resource.hash || "",
      remoteLastModified:
        resource.last_modified || resource.metadata_modified || new Date().toISOString(),
      downloadedAt: new Date().toISOString(),
      fileSize: content.byteLength,
      localFilePath: targetFilePath,
      relativeFilePath: relativePath,
    };

    const metaFilename = `${sanitizeSlug(resource.id)}.meta.json`;
    const metaFilePath = path.join(sourceDir, metaFilename);
    await fs.promises.writeFile(metaFilePath, JSON.stringify(metaData, null, 2), "utf-8");

    return metaData;
  }
}
