/**
 * zipArchiveExtractor.ts
 * High-speed in-memory Zip archive extractor for Shapefile packages (.shp, .dbf, .shx, .prj, .cpg).
 * Decompresses files concurrently into typed Uint8Arrays without creating intermediate objects.
 */

import { iter } from "but-unzip";

export interface ExtractedShapefilePackage {
  shpBuffer?: Uint8Array;
  dbfBuffer?: Uint8Array;
  shxBuffer?: Uint8Array;
  prjText?: string;
  cpgText?: string;
  geojsonText?: string;
}

export async function extractShapefileZip(
  zipBuffer: ArrayBuffer | Uint8Array
): Promise<ExtractedShapefilePackage> {
  const rawBytes =
    zipBuffer instanceof Uint8Array
      ? zipBuffer
      : new Uint8Array(zipBuffer);

  const result: ExtractedShapefilePackage = {};
  const decoder = new TextDecoder("utf-8");

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
          result.prjText = decoder.decode(bytes);
        })
      );
    } else if (filename.endsWith(".cpg")) {
      pendingTasks.push(
        Promise.resolve(entry.read()).then((bytes) => {
          result.cpgText = decoder.decode(bytes).trim();
        })
      );
    } else if (filename.endsWith(".geojson") || filename.endsWith(".json")) {
      pendingTasks.push(
        Promise.resolve(entry.read()).then((bytes) => {
          result.geojsonText = decoder.decode(bytes);
        })
      );
    }
  }

  await Promise.all(pendingTasks);

  return result;
}
