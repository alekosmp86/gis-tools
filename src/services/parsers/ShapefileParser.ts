import shp from "shpjs";
import type { FeatureCollection, Geometry, GeoJsonProperties, Feature } from "geojson";
import { FileSourceKind, type ISpatialFileParser, type ParsedFileDataset } from "@/types/parsers";
import { extractShapefileZip } from "@/utils/zipArchiveExtractor";
import { BinaryDbfReader } from "@/utils/binaryDbfReader";
import { BinaryShpReader, ShapeType } from "@/utils/binaryShpReader";

/** Maximum number of features rendered in the initial step map preview to avoid Leaflet OOM */
export const MAX_MAP_PREVIEW_FEATURES = 50_000;


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

  async parse(file: File): Promise<ParsedFileDataset> {
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

        const recordsMap = new Map<string, Record<string, unknown>>();
        const features: Array<Feature<Geometry, GeoJsonProperties>> = [];

        // Build representative subset for map preview (up to MAX_MAP_PREVIEW_FEATURES)
        for (let recordIndex = 0; recordIndex < previewLimit; recordIndex++) {
          const geometry = shpReader ? shpReader.readGeometry(recordIndex) : null;
          const properties = dbfReader.readRecord(recordIndex) || {};
          recordsMap.set(`feat-${recordIndex}`, properties);

          if (geometry) {
            features.push({
              type: "Feature",
              geometry,
              properties,
            });
          }
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

      return this.buildDatasetFromGeoJson(fileName, fileSize, featureCollection);
    }

    if (fileName.toLowerCase().endsWith(".json") || fileName.toLowerCase().endsWith(".geojson")) {
      const text = new TextDecoder().decode(rawBuffer);
      const featureCollection = JSON.parse(text) as FeatureCollection<Geometry, GeoJsonProperties>;
      return this.buildDatasetFromGeoJson(fileName, fileSize, featureCollection);
    }

    throw new Error("Formato no soportado. Por favor suba un archivo .zip (SHP+DBF) o .geojson.");
  }

  private buildDatasetFromGeoJson(
    fileName: string,
    fileSize: number,
    featureCollection: FeatureCollection<Geometry, GeoJsonProperties>
  ): ParsedFileDataset {
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

    previewFeatures.forEach((feature, featureIndex) => {
      const record = feature.properties ? (feature.properties as Record<string, unknown>) : {};
      if (feature.properties) {
        Object.keys(feature.properties).forEach((attributeKey) => {
          attributesSet.add(attributeKey);
        });
      }

      const featureKey = `feat-${featureIndex}`;
      recordsMap.set(featureKey, record);
    });

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
