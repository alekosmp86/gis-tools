import fs from "node:fs";
import path from "node:path";
import { resolveResourceFilename, sanitizeSlug } from "../domain/sourceNaming";
import type { CkanResource, VaultResourceMeta } from "../types";

/**
 * Holds the downloaded copy of each resource, plus a sidecar describing what was downloaded.
 *
 * One responsibility: files on disk. It decides nothing about deltas or catalogues — it only
 * answers what is stored and stores what it is given. The root is injectable so tests run against
 * a temporary directory rather than the real vault.
 *
 * Layout: `<root>/<source>/<file>` beside `<root>/<source>/<resourceId>.meta.json`.
 */
export class VaultStorageService {
  private readonly rootDir: string;

  constructor(rootDir: string = path.join(process.cwd(), "data", "vault")) {
    this.rootDir = rootDir;
  }

  private resolveSourceDir(sourceSlug: string): string {
    return path.join(this.rootDir, sanitizeSlug(sourceSlug));
  }

  private resolveMetaPath(sourceSlug: string, resourceId: string): string {
    return path.join(this.resolveSourceDir(sourceSlug), `${sanitizeSlug(resourceId)}.meta.json`);
  }

  /** Reads what is known about a stored resource, or null when it was never stored. */
  public async readMeta(
    sourceSlug: string,
    resourceId: string
  ): Promise<VaultResourceMeta | null> {
    const metaPath = this.resolveMetaPath(sourceSlug, resourceId);

    try {
      const rawJson = await fs.promises.readFile(metaPath, "utf8");
      return JSON.parse(rawJson) as VaultResourceMeta;
    } catch {
      // Absent or unreadable metadata both mean "not usable"; the caller re-downloads.
      return null;
    }
  }

  /** Reads the metadata for every resource stored under a source, keyed by resource id. */
  public async readAllMeta(sourceSlug: string): Promise<Map<string, VaultResourceMeta>> {
    const sourceDir = this.resolveSourceDir(sourceSlug);
    const storedMeta = new Map<string, VaultResourceMeta>();

    let entries: string[];
    try {
      entries = await fs.promises.readdir(sourceDir);
    } catch {
      return storedMeta;
    }

    const readOne = async (entry: string): Promise<VaultResourceMeta | null> => {
      try {
        const rawJson = await fs.promises.readFile(path.join(sourceDir, entry), "utf8");
        return JSON.parse(rawJson) as VaultResourceMeta;
      } catch {
        // A corrupt sidecar is skipped rather than failing the whole listing.
        return null;
      }
    };

    const pendingReads: Promise<VaultResourceMeta | null>[] = [];
    for (const entry of entries) {
      if (entry.endsWith(".meta.json")) {
        pendingReads.push(readOne(entry));
      }
    }

    const readMeta = await Promise.all(pendingReads);

    for (const meta of readMeta) {
      if (meta) {
        storedMeta.set(meta.resourceId, meta);
      }
    }

    return storedMeta;
  }

  /** Returns the stored bytes and metadata, or null when either half is missing. */
  public async readResource(
    sourceSlug: string,
    resourceId: string
  ): Promise<{ meta: VaultResourceMeta; content: Buffer } | null> {
    const meta = await this.readMeta(sourceSlug, resourceId);
    if (!meta) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(path.join(this.rootDir, meta.relativeFilePath));
      return { meta, content };
    } catch {
      // The sidecar outlived its file; treat the resource as absent.
      return null;
    }
  }

  /** Writes a resource and its sidecar, replacing any previous copy of the same resource. */
  public async writeResource(
    sourceSlug: string,
    resource: CkanResource,
    content: Buffer,
    downloadedAt: Date = new Date()
  ): Promise<VaultResourceMeta> {
    const sourceDir = this.resolveSourceDir(sourceSlug);
    await fs.promises.mkdir(sourceDir, { recursive: true });

    const filename = resolveResourceFilename(resource.name, resource.format, resource.url);
    await fs.promises.writeFile(path.join(sourceDir, filename), content);

    const meta: VaultResourceMeta = {
      resourceId: resource.id,
      resourceName: resource.name,
      format: resource.format,
      hash: resource.hash ?? "",
      remoteLastModified:
        resource.last_modified ?? resource.metadata_modified ?? downloadedAt.toISOString(),
      downloadedAt: downloadedAt.toISOString(),
      fileSize: content.byteLength,
      // Stored relative to the vault root so a moved or mounted vault stays readable.
      relativeFilePath: path.posix.join(sanitizeSlug(sourceSlug), filename),
    };

    await fs.promises.writeFile(
      this.resolveMetaPath(sourceSlug, resource.id),
      JSON.stringify(meta, null, 2),
      "utf8"
    );

    return meta;
  }
}
