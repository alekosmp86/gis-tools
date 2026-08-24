import shp from "shpjs";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import type { ISpatialFileParser, ParsedFileDataset } from "@/types/parsers";
import { cleanSuid } from "@/utils/gisCleaners";

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

    features.forEach((feat) => {
      if (feat.properties) {
        Object.keys(feat.properties).forEach((attrKey) => {
          attributesSet.add(attrKey);
        });

        // Store feature in map by first attribute or raw properties
        const firstAttr = Object.keys(feat.properties)[0];
        if (firstAttr) {
          const rawSuid = feat.properties[firstAttr];
          const key = cleanSuid(rawSuid);
          if (key) {
            recordsMap.set(key, feat.properties as Record<string, unknown>);
          }
        }
      }
    });

    return {
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
