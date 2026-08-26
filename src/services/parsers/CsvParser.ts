import type { FeatureCollection, Feature, Geometry, GeoJsonProperties } from "geojson";
import type { ISpatialFileParser, ParsedFileDataset } from "@/types/parsers";
import { cleanSuid } from "@/utils/gisCleaners";
import { parseAnyGeometryString } from "@/utils/wktParser";
import { normalizeCoordinate } from "@/utils/ewkbParser";

export class CsvParser implements ISpatialFileParser {
  readonly formatName = "CSV (Valores Separados por Comas)";
  readonly supportedExtensions = [".csv", ".txt"];

  async parse(file: File): Promise<ParsedFileDataset> {
    const fileName = file.name;
    const fileSize = file.size;
    const text = await file.text();

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      throw new Error("El archivo CSV está vacío.");
    }

    const parseCsvLine = (line: string): string[] => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
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
    const firstHeader = headers[0];

    // 1. Detect geometry column name (e.g. geom, geometry, wkt, wkb_geometry, the_geom, geom_wkt)
    const geomColHeader = headers.find((h) =>
      /^(geom|geometry|wkt|wkb_geometry|the_geom|geom_wkt)$/i.test(h.trim())
    );

    // 2. Detect Lat/Lng coordinate column headers
    const latColHeader = headers.find((h) =>
      /^(lat|latitude|latitud|y_coord|y)$/i.test(h.trim())
    );
    const lngColHeader = headers.find((h) =>
      /^(lng|lon|long|longitude|longitud|x_coord|x)$/i.test(h.trim())
    );

    const geojsonFeatures: Array<Feature<Geometry, GeoJsonProperties>> = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      if (values.length === 0) continue;

      const record: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        record[h] = values[idx] !== undefined ? values[idx] : "";
      });

      const rawSuid = record[firstHeader];
      const key = cleanSuid(rawSuid) || `row-${i}`;
      recordsMap.set(key, record);

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
