import shp from "shpjs";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { FileSourceKind, type ISpatialFileParser, type ParsedFileDataset } from "@/types/parsers";

export class ShapefileParser implements ISpatialFileParser {
  readonly formatName = "Shapefile / GeoJSON";
  readonly supportedExtensions = [".zip", ".geojson", ".json"];

  async parse(file: File): Promise<ParsedFileDataset> {
    const fileName = file.name;
    const fileSize = file.size;
    const buffer = await file.arrayBuffer();

    let featureCollection: FeatureCollection<Geometry, GeoJsonProperties>;

    if (fileName.toLowerCase().endsWith(".zip")) {
      const result = await shp(buffer);
      if (Array.isArray(result)) {
        featureCollection = result[0] as FeatureCollection<Geometry, GeoJsonProperties>;
      } else {
        featureCollection = result as FeatureCollection<Geometry, GeoJsonProperties>;
      }
    } else if (fileName.toLowerCase().endsWith(".json") || fileName.toLowerCase().endsWith(".geojson")) {
      const text = new TextDecoder().decode(buffer);
      featureCollection = JSON.parse(text);
    } else {
      throw new Error("Formato no soportado. Por favor suba un archivo .zip (SHP+DBF) o .geojson.");
    }

    if (!featureCollection || !featureCollection.features) {
      throw new Error("No se encontraron entidades vectoriales en el archivo.");
    }

    const features = featureCollection.features;
    const featureCount = features.length;

    let geometryType = "Desconocido";
    const attributesSet = new Set<string>();
    const recordsMap = new Map<string, Record<string, unknown>>();

    if (featureCount > 0 && features[0].geometry) {
      geometryType = features[0].geometry.type;
    }

    features.forEach((feature, featureIndex) => {
      const record = feature.properties ? (feature.properties as Record<string, unknown>) : {};
      if (feature.properties) {
        Object.keys(feature.properties).forEach((attributeKey) => {
          attributesSet.add(attributeKey);
        });
      }

      const featureKey = `feat-${featureIndex}`;
      recordsMap.set(featureKey, record);
    });

    return {
      kind: FileSourceKind.SHAPEFILE,
      fileName,
      fileSize,
      featureCount,
      geometryType,
      attributes: Array.from(attributesSet),
      recordsMap,
      geojson: featureCollection,
    };
  }
}

