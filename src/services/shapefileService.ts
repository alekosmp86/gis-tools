import shp from "shpjs";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import type { ParsedShapefileData } from "@/types/shp";

export async function parseUploadedSpatialFile(file: File): Promise<ParsedShapefileData> {
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
    throw new Error("Formato no soportado. Por favor suba un archivo .zip (que contenga .shp, .dbf) o .geojson.");
  }

  if (!featureCollection || !featureCollection.features) {
    throw new Error("No se encontraron entidades vectoriales en el archivo proporcionado.");
  }

  const features = featureCollection.features;
  const featureCount = features.length;

  let geometryType = "Desconocido";
  const attributesSet = new Set<string>();

  if (featureCount > 0) {
    const firstGeom = features[0].geometry;
    if (firstGeom) {
      geometryType = firstGeom.type;
    }

    // Collect all attribute property keys across features
    features.forEach((feat) => {
      if (feat.properties) {
        Object.keys(feat.properties).forEach((key) => attributesSet.add(key));
      }
    });
  }

  const attributes = Array.from(attributesSet);

  return {
    fileName,
    fileSize,
    featureCount,
    geometryType,
    attributes,
    geojson: featureCollection,
  };
}
