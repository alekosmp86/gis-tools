import shp from "shpjs";
import type { FeatureCollection, Geometry, GeoJsonProperties, Feature } from "geojson";
import {
  FileSourceKind,
  type ISpatialFileParser,
  type ParsedFileDataset,
  type ProgressCallback,
} from "@/core/types/parsers";
import { extractShapefileZip } from "@/core/binary/ZipShapefileExtractor";
import { BinaryDbfReader } from "@/core/binary/BinaryDbfReader";
import { BinaryShpReader, ShapeType } from "@/core/binary/BinaryShpReader";
import { MAX_MAP_PREVIEW_FEATURES } from "@/core/constants/mapConstants";
import { PARSE_PROGRESS_CHUNK_SIZE } from "@/core/constants/parserConstants";
import { yieldToMainThread } from "@/core/common/mainThreadYield";
import { createProjectionConverter } from "@/core/spatial/ProjectionEngine";

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

export class ShapefileParser implements ISpatialFileParser {
  readonly formatName = "Shapefile / GeoJSON";
  readonly supportedExtensions = [".zip", ".geojson", ".json"];

  async parse(file: File, onProgress?: ProgressCallback): Promise<ParsedFileDataset> {
    const fileName = file.name;
    const fileSize = file.size;
    const rawBuffer = await file.arrayBuffer();

    if (fileName.toLowerCase().endsWith(".zip")) {
      const extractedPackage = await extractShapefileZip(rawBuffer);

      if (extractedPackage.dbfBuffer) {
        const encoding = extractedPackage.cpgText || "windows-1252";
        const dbfReader = new BinaryDbfReader(extractedPackage.dbfBuffer, encoding);
        const featureCount = dbfReader.header.recordCount;
        const attributes = dbfReader.header.fields.map((field) => field.name);

        let geometryType = "Desconocido";
        let shpReader: BinaryShpReader | null = null;

        if (extractedPackage.shpBuffer) {
          try {
            shpReader = new BinaryShpReader(extractedPackage.shpBuffer);
            geometryType = resolveShapeTypeName(shpReader.header.shapeType);
          } catch {
            geometryType = "Desconocido";
          }
        }

        const isLargeDataset = featureCount > MAX_MAP_PREVIEW_FEATURES;
        const previewLimit = isLargeDataset ? MAX_MAP_PREVIEW_FEATURES : featureCount;
        const transformCoordinate = createProjectionConverter(extractedPackage.prjText);

        const recordsMap = new Map<string, Record<string, unknown>>();
        const features: Array<Feature<Geometry, GeoJsonProperties>> = [];

        // Build representative subset for map preview (up to MAX_MAP_PREVIEW_FEATURES)
        for (let recordIndex = 0; recordIndex < previewLimit; recordIndex++) {
          if (recordIndex > 0 && recordIndex % PARSE_PROGRESS_CHUNK_SIZE === 0) {
            onProgress?.("Extrayendo geometrías...", recordIndex, previewLimit);
            // react-doctor-disable-next-line react-doctor/async-await-in-loop
            await yieldToMainThread();
          }

          const geometry = shpReader
            ? shpReader.readGeometry(recordIndex, transformCoordinate)
            : null;
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
          dbfBuffer: extractedPackage.dbfBuffer,
          shpBuffer: extractedPackage.shpBuffer,
          prjText: extractedPackage.prjText,
          cpgText: extractedPackage.cpgText,
          isLargeDataset,
        };
      }

      // Fallback if no DBF file in ZIP
      const fallbackResult = await shp(rawBuffer);
      let featureCollection: FeatureCollection<Geometry, GeoJsonProperties>;
      if (Array.isArray(fallbackResult)) {
        featureCollection = fallbackResult[0] as FeatureCollection<Geometry, GeoJsonProperties>;
      } else {
        featureCollection = fallbackResult as FeatureCollection<Geometry, GeoJsonProperties>;
      }

      return this.buildDatasetFromGeoJson(fileName, fileSize, featureCollection, onProgress);
    }

    if (fileName.toLowerCase().endsWith(".json") || fileName.toLowerCase().endsWith(".geojson")) {
      const text = new TextDecoder().decode(rawBuffer);
      const featureCollection = JSON.parse(text) as FeatureCollection<Geometry, GeoJsonProperties>;
      return this.buildDatasetFromGeoJson(fileName, fileSize, featureCollection, onProgress);
    }

    throw new Error("Formato no soportado. Por favor suba un archivo .zip (SHP+DBF) o .geojson.");
  }

  private async buildDatasetFromGeoJson(
    fileName: string,
    fileSize: number,
    featureCollection: FeatureCollection<Geometry, GeoJsonProperties>,
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
    };
  }
}
