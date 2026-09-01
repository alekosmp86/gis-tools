import type { FeatureCollection, Feature, Geometry, GeoJsonProperties } from "geojson";
import { FileSourceKind, type ISpatialFileParser, type ParsedFileDataset } from "@/types/parsers";
import { parseAnyGeometryString } from "@/utils/wktParser";
import { normalizeCoordinate } from "@/utils/ewkbParser";

export class CsvParser implements ISpatialFileParser {
  readonly formatName = "CSV (Valores Separados por Comas)";
  readonly supportedExtensions = [".csv", ".txt"];

  async parse(file: File): Promise<ParsedFileDataset> {
    const fileName = file.name;
    const fileSize = file.size;
    const text = await file.text();

    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      throw new Error("El archivo CSV está vacío.");
    }

    const parseCsvLine = (lineText: string): string[] => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;

      for (let charIndex = 0; charIndex < lineText.length; charIndex++) {
        const char = lineText[charIndex];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          result.push(current.trim().replace(/^["']|["']$/g, ""));
          current = "";
        } else {
          current += char;
        }
      }
      result.push(current.trim().replace(/^["']|["']$/g, ""));
      return result;
    };

    const headers = parseCsvLine(lines[0]);
    if (headers.length === 0) {
      throw new Error("No se pudieron detectar las columnas de encabezado en el archivo CSV.");
    }

    const recordsMap = new Map<string, Record<string, unknown>>();

    // 1. Detect geometry column name (e.g. geom, geometry, wkt, wkb_geometry, the_geom, geom_wkt)
    const geomColHeader = headers.find((header) =>
      /^(geom|geometry|wkt|wkb_geometry|the_geom|geom_wkt)$/i.test(header.trim())
    );

    // 2. Detect Lat/Lng coordinate column headers
    const latColHeader = headers.find((header) =>
      /^(lat|latitude|latitud|y_coord|y)$/i.test(header.trim())
    );
    const lngColHeader = headers.find((header) =>
      /^(lng|lon|long|longitude|longitud|x_coord|x)$/i.test(header.trim())
    );

    const geojsonFeatures: Array<Feature<Geometry, GeoJsonProperties>> = [];

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
      const values = parseCsvLine(lines[lineIndex]);
      if (values.length === 0) continue;

      const record: Record<string, unknown> = {};
      headers.forEach((header, headerIndex) => {
        record[header] = values[headerIndex] !== undefined ? values[headerIndex] : "";
      });

      const rowKey = `row-${lineIndex - 1}`;
      recordsMap.set(rowKey, record);

      let parsedGeom: Geometry | null = null;

      // Check explicit geometry column first (EWKB Hex or WKT)
      if (geomColHeader && record[geomColHeader]) {
        parsedGeom = parseAnyGeometryString(record[geomColHeader]);
      }

      // Fallback: Check Lat/Lng columns
      if (!parsedGeom && latColHeader && lngColHeader && record[latColHeader] && record[lngColHeader]) {
        const latVal = parseFloat(String(record[latColHeader]));
        const lngVal = parseFloat(String(record[lngColHeader]));

        if (!isNaN(latVal) && !isNaN(lngVal)) {
          const [lon, lat] = normalizeCoordinate(lngVal, latVal);
          parsedGeom = {
            type: "Point",
            coordinates: [lon, lat],
          };
        }
      }

      if (parsedGeom) {
        geojsonFeatures.push({
          type: "Feature",
          geometry: parsedGeom,
          properties: record,
        });
      }
    }

    let geometryType: string | undefined = undefined;
    let featureCollection: FeatureCollection | undefined = undefined;

    if (geojsonFeatures.length > 0) {
      geometryType = geojsonFeatures[0].geometry.type;
      featureCollection = {
        type: "FeatureCollection",
        features: geojsonFeatures,
      };
    }

    return {
      kind: FileSourceKind.CSV,
      fileName,
      fileSize,
      featureCount: lines.length - 1,
      geometryType,
      attributes: headers,
      recordsMap,
      geojson: featureCollection,
    };
  }
}
