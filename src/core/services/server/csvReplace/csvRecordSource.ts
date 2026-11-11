import { detectCsvDelimiter, resolveSpatialColumnHeaders, type SpatialColumnHeaders } from "@/core/services/parsers/csvDialect";
import { GeometrySourceKind } from "@/core/services/server/shpReplace/replaceSql";
import type {
  ReplaceRecordRow,
  ReplaceRecordSource,
  ReplaceSourceWording,
} from "@/core/services/server/shpReplace/replaceRecordSource";
import { readCsvRecords, type CsvRecord } from "@/core/services/server/csvReplace/csvRecordReader";
import { readFirstLine, readTextChunks } from "@/core/services/server/csvReplace/utf8FileChunks";

const CSV_WORDING: ReplaceSourceWording = {
  missingFields: "Columnas del CSV",
  geometryName: "CSV",
  noGeometry:
    "El CSV no tiene una columna de geometría (EWKB, WKT) ni un par de columnas de latitud y longitud para mapear a la columna geométrica destino.",
};

const HEX_PREFIX_PATTERN = /^(?:\\x|0x)(?=[0-9a-f]+$)/i;

type CsvGeometryReader = (fields: string[], dataRow: number) => string | null;

const normalizeGeometryCell = (cell: string): string | null => {
  const trimmed = cell.trim();
  return trimmed === "" ? null : trimmed.replace(HEX_PREFIX_PATTERN, "");
};

function parseCoordinate(cell: string, label: string, dataRow: number): number {
  const value = Number(cell.trim().replace(",", "."));
  if (!Number.isFinite(value)) {
    throw new Error(`La fila ${dataRow} tiene una ${label} no numérica: "${cell}".`);
  }
  return value;
}

function buildPointText(latitudeCell: string, longitudeCell: string, dataRow: number): string | null {
  const hasLatitude = latitudeCell.trim() !== "";
  const hasLongitude = longitudeCell.trim() !== "";
  if (!hasLatitude && !hasLongitude) return null;
  if (hasLatitude !== hasLongitude) {
    throw new Error(`La fila ${dataRow} tiene solo una de las coordenadas (latitud y longitud deben venir juntas).`);
  }
  const longitude = parseCoordinate(longitudeCell, "longitud", dataRow);
  const latitude = parseCoordinate(latitudeCell, "latitud", dataRow);
  return `POINT(${longitude} ${latitude})`;
}

function validateHeaders(headers: string[]): void {
  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) {
      throw new Error(`El encabezado "${header}" está repetido: cada columna debe tener un nombre único.`);
    }
    seen.add(header);
  }
}

function assertFieldCount(record: CsvRecord, headerCount: number): void {
  if (record.fields.length !== headerCount) {
    throw new Error(
      `La línea ${record.line} tiene ${record.fields.length} campos y el encabezado tiene ${headerCount}.`
    );
  }
}

interface ScannedCsv {
  headers: string[];
  recordCount: number;
}

function scanCsv(filePath: string, delimiter: string): ScannedCsv {
  let headers: string[] | null = null;
  let recordCount = 0;
  for (const record of readCsvRecords(readTextChunks(filePath), delimiter)) {
    if (headers === null) {
      headers = record.fields.map((field) => field.trim());
      validateHeaders(headers);
      continue;
    }
    assertFieldCount(record, headers.length);
    recordCount += 1;
  }
  if (headers === null) throw new Error("El archivo CSV está vacío.");
  if (recordCount === 0) throw new Error("El archivo no contiene filas de datos.");
  return { headers, recordCount };
}

function buildGeometryReader(headers: string[], spatial: SpatialColumnHeaders): CsvGeometryReader | null {
  const indexOf = (header: string | undefined): number => (header === undefined ? -1 : headers.indexOf(header));
  const geometryIndex = indexOf(spatial.geomColHeader);
  const latitudeIndex = indexOf(spatial.latColHeader);
  const longitudeIndex = indexOf(spatial.lngColHeader);
  const hasPair = latitudeIndex >= 0 && longitudeIndex >= 0;
  if (geometryIndex < 0 && !hasPair) return null;
  return (fields, dataRow) => {
    const geometryCell = geometryIndex >= 0 ? normalizeGeometryCell(fields[geometryIndex]) : null;
    if (geometryCell !== null || !hasPair) return geometryCell;
    return buildPointText(fields[latitudeIndex], fields[longitudeIndex], dataRow);
  };
}

function* iterateRows(
  filePath: string,
  delimiter: string,
  headers: string[],
  readGeometry: CsvGeometryReader | null
): Generator<ReplaceRecordRow, void, undefined> {
  let dataRow = 0;
  let isHeader = true;
  for (const record of readCsvRecords(readTextChunks(filePath), delimiter)) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    dataRow += 1;
    const values: Record<string, string | null> = {};
    headers.forEach((header, index) => {
      values[header] = record.fields[index];
    });
    yield { rec: dataRow, values, geometryJson: readGeometry ? readGeometry(record.fields, dataRow) : null };
  }
}

export function openCsvFile(filePath: string): ReplaceRecordSource {
  const delimiter = detectCsvDelimiter(readFirstLine(filePath));
  const { headers, recordCount } = scanCsv(filePath, delimiter);
  const readGeometry = buildGeometryReader(headers, resolveSpatialColumnHeaders(headers));
  return {
    fieldNames: headers,
    recordCount,
    hasGeometry: readGeometry !== null,
    geometryFormat: GeometrySourceKind.TEXT,
    wording: CSV_WORDING,
    records: () => iterateRows(filePath, delimiter, headers, readGeometry),
  };
}
