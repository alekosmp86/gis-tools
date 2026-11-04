import shp from "shpjs";
import type { FeatureCollection, Geometry, GeoJsonProperties, Feature } from "geojson";
import {
  FileSourceKind,
  type ISpatialFileParser,
  type ParsedFileDataset,
  type ProgressCallback,
} from "@/core/types/parsers";
import { extractShapefileZip } from "@/core/binary/ZipShapefileExtractor";
import { readZipEntryDates } from "@/core/binary/zipEntryDates";
import { pickDatasetModifiedAt } from "@/core/services/fileDateSuggestion";
import { BinaryDbfReader } from "@/core/binary/BinaryDbfReader";
import { BinaryShpReader, ShapeType } from "@/core/binary/BinaryShpReader";
import { MAX_MAP_PREVIEW_FEATURES } from "@/core/constants/mapConstants";
import { PARSE_PROGRESS_CHUNK_SIZE } from "@/core/constants/parserConstants";
import { yieldToMainThread } from "@/core/common/mainThreadYield";
import { createProjectionConverter } from "@/core/spatial/ProjectionEngine";

type ExtractedPackage = Awaited<ReturnType<typeof extractShapefileZip>>;

function toIsoString(date: Date | null): string | undefined {
  if (date === null || Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function resolveZipModifiedAt(rawBuffer: ArrayBuffer, fallback: Date | null): string | undefined {
  return toIsoString(pickDatasetModifiedAt(readZipEntryDates(new Uint8Array(rawBuffer)), fallback));
}

function resolveShapeTypeName(shapeType: number): string {
  switch (shapeType) {
    case ShapeType.POINT:
    case ShapeType.POINTZ:
    case ShapeType.POINTM:
      return "Point";
    case ShapeType.POLYLINE:
    case ShapeType.POLYLINEZ:
    case ShapeType.POLYLINEM:
      return "LineString";
    case ShapeType.POLYGON:
    case ShapeType.POLYGONZ:
    case ShapeType.POLYGONM:
      return "Polygon";
    case ShapeType.MULTIPOINT:
    case ShapeType.MULTIPOINTZ:
    case ShapeType.MULTIPOINTM:
      return "MultiPoint";
    default:
      return "Desconocido";
  }
}

function openShpReader(shpBuffer: ExtractedPackage["shpBuffer"]): {
  shpReader: BinaryShpReader | null;
  geometryType: string;
} {
  if (!shpBuffer) return { shpReader: null, geometryType: "Desconocido" };
  try {
    const shpReader = new BinaryShpReader(shpBuffer);
    return { shpReader, geometryType: resolveShapeTypeName(shpReader.header.shapeType) };
  } catch {
    return { shpReader: null, geometryType: "Desconocido" };
  }
}

async function extractPreviewRecords(
  dbfReader: BinaryDbfReader,
  shpReader: BinaryShpReader | null,
  transformCoordinate: ReturnType<typeof createProjectionConverter>,
  previewLimit: number,
  onProgress?: ProgressCallback
): Promise<{
  recordsMap: Map<string, Record<string, unknown>>;
  features: Array<Feature<Geometry, GeoJsonProperties>>;
}> {
  const recordsMap = new Map<string, Record<string, unknown>>();
  const features: Array<Feature<Geometry, GeoJsonProperties>> = [];

  for (let recordIndex = 0; recordIndex < previewLimit; recordIndex++) {
    if (recordIndex > 0 && recordIndex % PARSE_PROGRESS_CHUNK_SIZE === 0) {
      onProgress?.("Extrayendo geometrías...", recordIndex, previewLimit);
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      await yieldToMainThread();
    }

    const geometry = shpReader ? shpReader.readGeometry(recordIndex, transformCoordinate) : null;
    const properties = dbfReader.readRecord(recordIndex) || {};
    recordsMap.set(`feat-${recordIndex}`, properties);

    if (geometry) {
      features.push({
        // Records without geometry produce no feature, so the feature position drifts from the
        // record position. The id keeps the link back to the record this feature came from.
        id: recordIndex,
        type: "Feature",
        geometry,
        properties,
      });
    }
  }

  return { recordsMap, features };
}

export class ShapefileParser implements ISpatialFileParser {
  readonly formatName = "Shapefile / GeoJSON";
  readonly supportedExtensions = [".zip", ".geojson", ".json"];

  async parse(file: File, onProgress?: ProgressCallback): Promise<ParsedFileDataset> {
    const fileName = file.name;
    const fileSize = file.size;
    const rawBuffer = await file.arrayBuffer();
    const fallbackModifiedAt = file.lastModified ? new Date(file.lastModified) : null;
    const lowerName = fileName.toLowerCase();

    if (lowerName.endsWith(".zip")) {
      return this.parseZip(fileName, fileSize, rawBuffer, fallbackModifiedAt, onProgress);
    }

    if (lowerName.endsWith(".json") || lowerName.endsWith(".geojson")) {
      const text = new TextDecoder().decode(rawBuffer);
      const featureCollection = JSON.parse(text) as FeatureCollection<Geometry, GeoJsonProperties>;
      return this.buildDatasetFromGeoJson(
        fileName,
        fileSize,
        featureCollection,
        toIsoString(fallbackModifiedAt),
        onProgress
      );
    }

    throw new Error("Formato no soportado. Por favor suba un archivo .zip (SHP+DBF) o .geojson.");
  }

  private async parseZip(
    fileName: string,
    fileSize: number,
    rawBuffer: ArrayBuffer,
    fallbackModifiedAt: Date | null,
    onProgress?: ProgressCallback
  ): Promise<ParsedFileDataset> {
    const modifiedAt = resolveZipModifiedAt(rawBuffer, fallbackModifiedAt);
    const extractedPackage = await extractShapefileZip(rawBuffer);

    if (extractedPackage.dbfBuffer) {
      return this.buildDatasetFromShapefilePackage(
        fileName,
        fileSize,
        extractedPackage,
        extractedPackage.dbfBuffer,
        modifiedAt,
        onProgress
      );
    }

    const fallbackResult = await shp(rawBuffer);
    const featureCollection = (
      Array.isArray(fallbackResult) ? fallbackResult[0] : fallbackResult
    ) as FeatureCollection<Geometry, GeoJsonProperties>;

    return this.buildDatasetFromGeoJson(fileName, fileSize, featureCollection, modifiedAt, onProgress);
  }

  private async buildDatasetFromShapefilePackage(
    fileName: string,
    fileSize: number,
    extractedPackage: ExtractedPackage,
    dbfBuffer: NonNullable<ExtractedPackage["dbfBuffer"]>,
    modifiedAt: string | undefined,
    onProgress?: ProgressCallback
  ): Promise<ParsedFileDataset> {
    const encoding = extractedPackage.cpgText || "windows-1252";
    const dbfReader = new BinaryDbfReader(dbfBuffer, encoding);
    const featureCount = dbfReader.header.recordCount;
    const attributes = dbfReader.header.fields.map((field) => field.name);
    const { shpReader, geometryType } = openShpReader(extractedPackage.shpBuffer);

    const isLargeDataset = featureCount > MAX_MAP_PREVIEW_FEATURES;
    const previewLimit = isLargeDataset ? MAX_MAP_PREVIEW_FEATURES : featureCount;
    const transformCoordinate = createProjectionConverter(extractedPackage.prjText);

    const { recordsMap, features } = await extractPreviewRecords(
      dbfReader,
      shpReader,
      transformCoordinate,
      previewLimit,
      onProgress
    );

    if (onProgress && previewLimit > 0) {
      onProgress("Extrayendo geometrías...", previewLimit, previewLimit);
    }

    const geojson: FeatureCollection = {
      type: "FeatureCollection",
      features,
    };

    return {
      kind: FileSourceKind.SHAPEFILE,
      fileName,
      fileSize,
      featureCount,
      geometryType,
      attributes,
      recordsMap,
      geojson,
      dbfBuffer,
      shpBuffer: extractedPackage.shpBuffer,
      prjText: extractedPackage.prjText,
      cpgText: extractedPackage.cpgText,
      isLargeDataset,
      modifiedAt,
    };
  }

  private async buildDatasetFromGeoJson(
    fileName: string,
    fileSize: number,
    featureCollection: FeatureCollection<Geometry, GeoJsonProperties>,
    modifiedAt: string | undefined,
    onProgress?: ProgressCallback
  ): Promise<ParsedFileDataset> {
    if (!featureCollection || !featureCollection.features) {
      throw new Error("No se encontraron entidades vectoriales en el archivo.");
    }

    const allFeatures = featureCollection.features;
    const featureCount = allFeatures.length;
    let geometryType = "Desconocido";
    const attributesSet = new Set<string>();
    const recordsMap = new Map<string, Record<string, unknown>>();

    if (featureCount > 0 && allFeatures[0].geometry) {
      geometryType = allFeatures[0].geometry.type;
    }

    const isLargeDataset = featureCount > MAX_MAP_PREVIEW_FEATURES;
    const previewFeatures = isLargeDataset
      ? allFeatures.slice(0, MAX_MAP_PREVIEW_FEATURES)
      : allFeatures;

    const previewCount = previewFeatures.length;
    for (let featureIndex = 0; featureIndex < previewCount; featureIndex++) {
      if (featureIndex > 0 && featureIndex % PARSE_PROGRESS_CHUNK_SIZE === 0) {
        onProgress?.("Procesando entidades GeoJSON...", featureIndex, previewCount);
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await yieldToMainThread();
      }

      const feature = previewFeatures[featureIndex];
      const record = feature.properties ? (feature.properties as Record<string, unknown>) : {};
      if (feature.properties) {
        Object.keys(feature.properties).forEach((attributeKey) => {
          attributesSet.add(attributeKey);
        });
      }

      const featureKey = `feat-${featureIndex}`;
      recordsMap.set(featureKey, record);
    }

    if (onProgress && previewCount > 0) {
      onProgress("Procesando entidades GeoJSON...", previewCount, previewCount);
    }

    const previewGeojson: FeatureCollection<Geometry, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: previewFeatures,
    };

    return {
      kind: FileSourceKind.SHAPEFILE,
      fileName,
      fileSize,
      featureCount,
      geometryType,
      attributes: Array.from(attributesSet),
      recordsMap,
      geojson: previewGeojson,
      isLargeDataset,
      modifiedAt,
    };
  }
}
