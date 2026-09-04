import type { FeatureCollection, Feature, Geometry, GeoJsonProperties } from "geojson";
import { FileSourceKind, type ISpatialFileParser, type ParsedFileDataset } from "@/types/parsers";
import { parseAnyGeometryString } from "@/utils/spatial/WktGeometryParser";
import { normalizeCoordinate } from "@/utils/spatial/EwkbGeometryParser";

interface SpatialColumnHeaders {
  geomColHeader?: string;
  latColHeader?: string;
  lngColHeader?: string;
}

export class CsvParser implements ISpatialFileParser {
  readonly formatName = "CSV (Valores Separados por Comas)";
  readonly supportedExtensions = [".csv", ".txt"];

  /**
   * Main orchestrator: coordinates file reading, delimiter detection, header parsing,
   * row processing, and GeoJSON dataset construction.
   */
  async parse(file: File): Promise<ParsedFileDataset> {
    const fileName = file.name;
    const fileSize = file.size;
    const rawText = await file.text();

    const lines = this.cleanAndSplitLines(rawText);
    if (lines.length === 0) {
      throw new Error("El archivo CSV está vacío.");
    }

    const delimiter = this.detectDelimiter(lines[0]);
    const headers = this.extractHeaders(lines[0], delimiter);
    const spatialCols = this.resolveSpatialColumnHeaders(headers);

    const { recordsMap, geojsonFeatures } = this.processRows(
      lines,
      headers,
      delimiter,
      spatialCols
    );

    const featureCollection = this.buildFeatureCollection(geojsonFeatures);

    return {
      kind: FileSourceKind.CSV,
      fileName,
      fileSize,
      featureCount: lines.length - 1,
      geometryType: geojsonFeatures[0]?.geometry.type,
      attributes: headers,
      recordsMap,
      geojson: featureCollection,
    };
  }

  /**
   * Strips UTF-8 Byte Order Mark (BOM) and splits text into non-empty trimmed lines.
   */
  private cleanAndSplitLines(rawText: string): string[] {
    const textWithoutBom = rawText.replace(/^\uFEFF/, "");
    return textWithoutBom.split(/\r?\n/).filter((line) => line.trim().length > 0);
  }

  /**
   * Analyzes the header line outside quotation marks to auto-detect whether the CSV
   * is delimited by semicolon (;), tab (\t), or standard comma (,).
   */
  private detectDelimiter(sampleLine: string): string {
    let commaCount = 0;
    let semiCount = 0;
    let tabCount = 0;
    let inQuotes = false;

    for (let charIndex = 0; charIndex < sampleLine.length; charIndex++) {
      const char = sampleLine[charIndex];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes) {
        if (char === ",") commaCount++;
        else if (char === ";") semiCount++;
        else if (char === "\t") tabCount++;
      }
    }

    if (semiCount > commaCount && semiCount > tabCount) return ";";
    if (tabCount > commaCount && tabCount > semiCount) return "\t";
    return ",";
  }

  /**
   * Parses a single CSV line into an array of string values respecting quotes and the specified delimiter.
   */
  private parseCsvLine(lineText: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let charIndex = 0; charIndex < lineText.length; charIndex++) {
      const char = lineText[charIndex];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim().replace(/^["']|["']$/g, "").trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^["']|["']$/g, "").trim());
    return result;
  }

  /**
   * Extracts and cleans header column names from the first CSV line.
   */
  private extractHeaders(firstLine: string, delimiter: string): string[] {
    const headers = this.parseCsvLine(firstLine, delimiter).map((header) =>
      header.trim().replace(/^["']|["']$/g, "").trim().replace(/^\uFEFF/, "")
    );
    if (headers.length === 0) {
      throw new Error("No se pudieron detectar las columnas de encabezado en el archivo CSV.");
    }
    return headers;
  }

  /**
   * Detects explicit geometry or coordinate (lat/lng) column names in the headers.
   */
  private resolveSpatialColumnHeaders(headers: string[]): SpatialColumnHeaders {
    const geomColHeader = headers.find((header) =>
      /^(geom|geometry|wkt|wkb_geometry|the_geom|geom_wkt|geom_wkb)$/i.test(header.trim())
    );
    const latColHeader = headers.find((header) =>
      /^(lat|latitude|latitud|y_coord|y)$/i.test(header.trim())
    );
    const lngColHeader = headers.find((header) =>
      /^(lng|lon|long|longitude|longitud|x_coord|x)$/i.test(header.trim())
    );

    return { geomColHeader, latColHeader, lngColHeader };
  }

  /**
   * Iterates through data rows, builds recordsMap, and extracts any valid geometries.
   */
  private processRows(
    lines: string[],
    headers: string[],
    delimiter: string,
    spatialCols: SpatialColumnHeaders
  ): {
    recordsMap: Map<string, Record<string, unknown>>;
    geojsonFeatures: Array<Feature<Geometry, GeoJsonProperties>>;
  } {
    const recordsMap = new Map<string, Record<string, unknown>>();
    const geojsonFeatures: Array<Feature<Geometry, GeoJsonProperties>> = [];

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
      const values = this.parseCsvLine(lines[lineIndex], delimiter);
      if (values.length === 0) continue;

      const record: Record<string, unknown> = {};
      headers.forEach((header, headerIndex) => {
        record[header] = values[headerIndex] !== undefined ? values[headerIndex] : "";
      });

      const rowKey = `row-${lineIndex - 1}`;
      recordsMap.set(rowKey, record);

      const parsedGeom = this.extractGeometry(record, spatialCols);
      if (parsedGeom) {
        geojsonFeatures.push({
          type: "Feature",
          geometry: parsedGeom,
          properties: record,
        });
      }
    }

    return { recordsMap, geojsonFeatures };
  }

  /**
   * Extracts GeoJSON geometry from either an explicit geometry column (WKT/EWKB) or lat/lng coordinates.
   */
  private extractGeometry(
    record: Record<string, unknown>,
    spatialCols: SpatialColumnHeaders
  ): Geometry | null {
    // 1. Check explicit geometry column (EWKB Hex or WKT)
    if (spatialCols.geomColHeader && record[spatialCols.geomColHeader]) {
      const parsed = parseAnyGeometryString(record[spatialCols.geomColHeader]);
      if (parsed) return parsed;
    }

    // 2. Fallback: Check Lat/Lng columns
    if (
      spatialCols.latColHeader &&
      spatialCols.lngColHeader &&
      record[spatialCols.latColHeader] &&
      record[spatialCols.lngColHeader]
    ) {
      const latVal = parseFloat(String(record[spatialCols.latColHeader]));
      const lngVal = parseFloat(String(record[spatialCols.lngColHeader]));

      if (!isNaN(latVal) && !isNaN(lngVal)) {
        const [lon, lat] = normalizeCoordinate(lngVal, latVal);
        return {
          type: "Point",
          coordinates: [lon, lat],
        };
      }
    }

    return null;
  }

  /**
   * Constructs the final FeatureCollection if any spatial features were extracted.
   */
  private buildFeatureCollection(
    features: Array<Feature<Geometry, GeoJsonProperties>>
  ): FeatureCollection | undefined {
    if (features.length === 0) return undefined;
    return {
      type: "FeatureCollection",
      features,
    };
  }
}
