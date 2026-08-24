import type { ISpatialFileParser, ParsedFileDataset } from "@/types/parsers";
import { cleanSuid } from "@/utils/gisCleaners";

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

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      if (values.length === 0) continue;

      const record: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        record[h] = values[idx] !== undefined ? values[idx] : "";
      });

      const rawSuid = record[firstHeader];
      const key = cleanSuid(rawSuid);
      if (key) {
        recordsMap.set(key, record);
      }
    }

    return {
      fileName,
      fileSize,
      featureCount: lines.length - 1,
      geometryType: undefined, // CSV has no spatial geometries
      attributes: headers,
      recordsMap,
    };
  }
}
