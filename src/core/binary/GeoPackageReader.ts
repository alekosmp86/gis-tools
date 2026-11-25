import { quoteIdentifier } from "@/core/services/sqlStatements";
import { nodeSqliteOpener } from "@/core/binary/GeoPackageSqliteDatabase";

export type GpkgRow = Record<string, unknown>;

export interface GpkgStatement {
  all<Row>(): Row[];
  iterate<Row>(): Iterable<Row>;
}

export interface GpkgDatabase {
  prepare(sql: string): GpkgStatement;
  close(): void;
}

export interface GpkgDatabaseOpener {
  open(filePath: string): GpkgDatabase;
}

export interface GpkgFeatureLayer {
  readonly name: string;
  readonly geometryColumn: string;
  readonly srid: number | null;
}

interface GpkgFeatureLayerRow extends Omit<GpkgFeatureLayer, "srid"> {
  readonly srid: number | bigint | null;
}

interface GpkgColumnInfo {
  readonly name: string;
  readonly pk: number;
}

export class GeoPackageFormatError extends Error {
  override readonly name = "GeoPackageFormatError";
}

const FID_COLUMN = "fid";
const GEOMETRY_HEADER_MAGIC_G = 0x47;
const GEOMETRY_HEADER_MAGIC_P = 0x50;
const GEOMETRY_VERSION_OFFSET = 2;
const GEOMETRY_SUPPORTED_VERSION = 0;
const GEOMETRY_FIXED_HEADER_BYTES = 8;
const GEOMETRY_ENVELOPE_SHIFT = 1;
const GEOMETRY_ENVELOPE_MASK = 0x07;
const GEOMETRY_EMPTY_FLAG = 0x10;
const GEOMETRY_EXTENDED_FLAG = 0x20;
const ENVELOPE_BYTES_BY_INDICATOR: readonly number[] = [0, 32, 48, 48, 64];

const FEATURE_LAYERS_SQL = `SELECT c.table_name AS name, g.column_name AS geometryColumn,
  CASE WHEN UPPER(s.organization) = 'EPSG' THEN s.organization_coordsys_id END AS srid
FROM gpkg_contents c
INNER JOIN gpkg_geometry_columns g ON g.table_name = c.table_name
LEFT JOIN gpkg_spatial_ref_sys s ON s.srs_id = g.srs_id
WHERE c.data_type = 'features' ORDER BY c.rowid`;

const NOT_GEOPACKAGE_BLOB_MESSAGE = "Una geometría del GeoPackage no tiene cabecera GeoPackageBinary válida.";
const UNSUPPORTED_VERSION_MESSAGE = "Una geometría del GeoPackage usa una versión de cabecera no soportada.";
const EXTENDED_GEOMETRY_MESSAGE = "El GeoPackage usa geometrías de tipo extendido, no soportadas.";
const INVALID_ENVELOPE_MESSAGE = "Una geometría del GeoPackage tiene un envolvente no válido.";
const TRUNCATED_GEOMETRY_MESSAGE = "Una geometría del GeoPackage no tiene datos WKB.";

const isGeoPackageBinaryHeader = (blob: Uint8Array): boolean =>
  blob[0] === GEOMETRY_HEADER_MAGIC_G && blob[1] === GEOMETRY_HEADER_MAGIC_P;

const assertSupportedHeader = (blob: Uint8Array, flags: number): void => {
  if (!isGeoPackageBinaryHeader(blob)) throw new GeoPackageFormatError(NOT_GEOPACKAGE_BLOB_MESSAGE);
  if (blob[GEOMETRY_VERSION_OFFSET] !== GEOMETRY_SUPPORTED_VERSION) {
    throw new GeoPackageFormatError(UNSUPPORTED_VERSION_MESSAGE);
  }
  if ((flags & GEOMETRY_EXTENDED_FLAG) !== 0) throw new GeoPackageFormatError(EXTENDED_GEOMETRY_MESSAGE);
};

const envelopeBytesOf = (flags: number): number => {
  const indicator = (flags >> GEOMETRY_ENVELOPE_SHIFT) & GEOMETRY_ENVELOPE_MASK;
  const envelopeBytes = ENVELOPE_BYTES_BY_INDICATOR[indicator];
  if (envelopeBytes === undefined) throw new GeoPackageFormatError(INVALID_ENVELOPE_MESSAGE);
  return envelopeBytes;
};

const toFeatureLayer = (row: GpkgFeatureLayerRow): GpkgFeatureLayer => ({
  ...row,
  srid: row.srid === null ? null : Number(row.srid),
});

export function gpkgBlobToWkbHex(blob: Uint8Array | null): string | null {
  if (blob === null || blob.byteLength === 0) return null;
  const flags = blob[3];
  assertSupportedHeader(blob, flags);
  if ((flags & GEOMETRY_EMPTY_FLAG) !== 0) return null;
  const wkbStart = GEOMETRY_FIXED_HEADER_BYTES + envelopeBytesOf(flags);
  if (blob.byteLength <= wkbStart) throw new GeoPackageFormatError(TRUNCATED_GEOMETRY_MESSAGE);
  return Buffer.from(blob.subarray(wkbStart)).toString("hex").toUpperCase();
}

export class GeoPackageReader {
  private readonly database: GpkgDatabase;

  constructor(filePath: string, opener: GpkgDatabaseOpener = nodeSqliteOpener) {
    this.database = opener.open(filePath);
  }

  listFeatureLayers(): GpkgFeatureLayer[] {
    return this.database.prepare(FEATURE_LAYERS_SQL).all<GpkgFeatureLayerRow>().map(toFeatureLayer);
  }

  listFields(layer: GpkgFeatureLayer): string[] {
    const columns = this.listColumns(layer.name).filter((column) => column.name !== layer.geometryColumn);
    const dataColumns = columns.filter((column) => !(column.pk > 0 && column.name === FID_COLUMN));
    return (dataColumns.length > 0 ? dataColumns : columns).map((column) => column.name);
  }

  countRows(layerName: string): number {
    const sql = `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(layerName)}`;
    const [countRow] = this.database.prepare(sql).all<{ rowCount: number }>();
    return Number(countRow?.rowCount ?? 0);
  }

  iterateRows(layerName: string): Iterable<GpkgRow> {
    const sql = `SELECT * FROM ${quoteIdentifier(layerName)} ORDER BY rowid`;
    return this.database.prepare(sql).iterate<GpkgRow>();
  }

  close(): void {
    this.database.close();
  }

  private listColumns(layerName: string): GpkgColumnInfo[] {
    return this.database.prepare(`PRAGMA table_info(${quoteIdentifier(layerName)})`).all<GpkgColumnInfo>();
  }
}
