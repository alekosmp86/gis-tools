import {
  GeoPackageFormatError,
  GeoPackageReader,
  gpkgBlobToWkbHex,
  type GpkgFeatureLayer,
  type GpkgRow,
} from "@/core/binary/GeoPackageReader";
import { GeometrySourceKind } from "@/core/services/server/shpReplace/replaceSql";
import type {
  ReplaceRecordRow,
  ReplaceRecordSource,
  ReplaceSourceWording,
} from "@/core/services/server/shpReplace/replaceRecordSource";
import type { GpkgLayerInfo } from "@/core/types/gpkgReplace";

export interface OpenGpkgFile extends ReplaceRecordSource {
  readonly layers: GpkgLayerInfo[];
  readonly srid: number | null;
}

interface GpkgCatalog {
  readonly layers: GpkgLayerInfo[];
  readonly selected: GpkgLayerInfo;
  readonly fieldNames: string[];
}

const GPKG_WORDING: ReplaceSourceWording = {
  missingFields: "Campos del GPKG",
  geometryName: "GPKG",
  noGeometry: "El archivo no tiene geometrías para mapear a la columna geométrica destino.",
};

const NOT_GEOPACKAGE_MESSAGE = "El archivo no es un GeoPackage válido.";
const NO_FEATURE_LAYERS_MESSAGE = "El GeoPackage no contiene capas de entidades.";
const SQLITE_ERROR_CODE = "ERR_SQLITE_ERROR";

const layerNotFoundMessage = (layerName: string): string =>
  `El GeoPackage no tiene una capa de entidades llamada "${layerName}".`;

const binaryColumnMessage = (columnName: string): string =>
  `La capa tiene columnas binarias no soportadas: ${columnName}.`;

const toLayerInfo = (reader: GeoPackageReader, layer: GpkgFeatureLayer): GpkgLayerInfo => ({
  name: layer.name,
  geometryColumn: layer.geometryColumn,
  srid: layer.srid,
  rowCount: reader.countRows(layer.name),
  fieldNames: reader.listFields(layer),
});

function selectLayerIndex(featureLayers: GpkgFeatureLayer[], layerName: string | undefined): number {
  if (layerName === undefined) return 0;
  const index = featureLayers.findIndex((layer) => layer.name === layerName);
  if (index < 0) throw new GeoPackageFormatError(layerNotFoundMessage(layerName));
  return index;
}

function buildCatalog(reader: GeoPackageReader, layerName: string | undefined): GpkgCatalog {
  const featureLayers = reader.listFeatureLayers();
  if (featureLayers.length === 0) throw new GeoPackageFormatError(NO_FEATURE_LAYERS_MESSAGE);
  const selectedIndex = selectLayerIndex(featureLayers, layerName);
  const layers = featureLayers.map((layer) => toLayerInfo(reader, layer));
  return {
    layers,
    selected: layers[selectedIndex],
    fieldNames: layers[selectedIndex].fieldNames,
  };
}

function withReader<Result>(filePath: string, read: (reader: GeoPackageReader) => Result): Result {
  const reader = new GeoPackageReader(filePath);
  try {
    return read(reader);
  } finally {
    reader.close();
  }
}

const isSqliteError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === SQLITE_ERROR_CODE;

function toCatalogError(error: unknown): unknown {
  if (error instanceof GeoPackageFormatError) return error;
  return isSqliteError(error) ? new GeoPackageFormatError(NOT_GEOPACKAGE_MESSAGE) : error;
}

function readCatalogOrFail(filePath: string, layerName: string | undefined): GpkgCatalog {
  try {
    return withReader(filePath, (reader) => buildCatalog(reader, layerName));
  } catch (error) {
    throw toCatalogError(error);
  }
}

const formatGpkgNumber = (value: number): string => {
  const text = String(value);
  return Number.isInteger(value) && text.includes("e") ? value.toFixed(0) : text;
};

const stringifyGpkgValue = (columnName: string, value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) throw new GeoPackageFormatError(binaryColumnMessage(columnName));
  return typeof value === "number" ? formatGpkgNumber(value) : String(value);
};

const asGeometryBlob = (value: unknown): Uint8Array | null => (value instanceof Uint8Array ? value : null);

function toRecordRow(row: GpkgRow, rec: number, layer: GpkgLayerInfo, fieldNames: string[]): ReplaceRecordRow {
  return {
    rec,
    values: Object.fromEntries(fieldNames.map((name) => [name, stringifyGpkgValue(name, row[name])])),
    geometryJson: gpkgBlobToWkbHex(asGeometryBlob(row[layer.geometryColumn])),
  };
}

function* iterateGpkgRows(
  filePath: string,
  layer: GpkgLayerInfo,
  fieldNames: string[]
): Generator<ReplaceRecordRow, void, undefined> {
  const reader = new GeoPackageReader(filePath);
  try {
    let rec = 0;
    for (const row of reader.iterateRows(layer.name)) {
      rec += 1;
      yield toRecordRow(row, rec, layer, fieldNames);
    }
  } finally {
    reader.close();
  }
}

export function openGpkgFile(filePath: string, layerName?: string): OpenGpkgFile {
  const catalog = readCatalogOrFail(filePath, layerName);
  return {
    fieldNames: catalog.fieldNames,
    recordCount: catalog.selected.rowCount,
    hasGeometry: true,
    geometryFormat: GeometrySourceKind.TEXT,
    wording: GPKG_WORDING,
    layers: catalog.layers,
    srid: catalog.selected.srid,
    records: () => iterateGpkgRows(filePath, catalog.selected, catalog.fieldNames),
  };
}
