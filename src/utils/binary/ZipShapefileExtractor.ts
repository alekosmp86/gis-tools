import { iter } from "but-unzip";

export interface ExtractedShapefilePackage {
  shpBuffer?: Uint8Array;
  dbfBuffer?: Uint8Array;
  shxBuffer?: Uint8Array;
  prjText?: string;
  cpgText?: string;
  geojsonText?: string;
}

/**
 * ZipShapefileExtractor
 * Object-Oriented service for in-memory extraction of Shapefile bundles (.shp, .dbf, .shx, .prj, .cpg).
 */
export class ZipShapefileExtractor {
  private readonly decoder = new TextDecoder("utf-8");

  /**
   * Decompresses ZIP archive bytes and collects Shapefile component buffers concurrently.
   */
  public async extract(zipBuffer: ArrayBuffer | Uint8Array): Promise<ExtractedShapefilePackage> {
    const rawBytes =
      zipBuffer instanceof Uint8Array
        ? zipBuffer
        : new Uint8Array(zipBuffer);

    const result: ExtractedShapefilePackage = {};
    const pendingTasks: Array<Promise<void>> = [];

    for (const entry of iter(rawBytes)) {
      const filename = entry.filename.toLowerCase();
      if (filename.includes("__macosx") || filename.startsWith(".")) {
        continue;
      }

      if (filename.endsWith(".shp")) {
        pendingTasks.push(
          Promise.resolve(entry.read()).then((bytes) => {
            result.shpBuffer = bytes;
          })
        );
      } else if (filename.endsWith(".dbf")) {
        pendingTasks.push(
          Promise.resolve(entry.read()).then((bytes) => {
            result.dbfBuffer = bytes;
          })
        );
      } else if (filename.endsWith(".shx")) {
        pendingTasks.push(
          Promise.resolve(entry.read()).then((bytes) => {
            result.shxBuffer = bytes;
          })
        );
      } else if (filename.endsWith(".prj")) {
        pendingTasks.push(
          Promise.resolve(entry.read()).then((bytes) => {
            result.prjText = this.decoder.decode(bytes);
          })
        );
      } else if (filename.endsWith(".cpg")) {
        pendingTasks.push(
          Promise.resolve(entry.read()).then((bytes) => {
            result.cpgText = this.decoder.decode(bytes).trim();
          })
        );
      } else if (filename.endsWith(".geojson") || filename.endsWith(".json")) {
        pendingTasks.push(
          Promise.resolve(entry.read()).then((bytes) => {
            result.geojsonText = this.decoder.decode(bytes);
          })
        );
      }
    }

    await Promise.all(pendingTasks);
    return result;
  }

  public static async extractShapefileZip(
    zipBuffer: ArrayBuffer | Uint8Array
  ): Promise<ExtractedShapefilePackage> {
    const extractor = new ZipShapefileExtractor();
    return extractor.extract(zipBuffer);
  }
}

/** Convenience export */
export const extractShapefileZip = ZipShapefileExtractor.extractShapefileZip;
