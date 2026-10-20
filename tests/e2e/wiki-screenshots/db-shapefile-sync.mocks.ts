import { crc32 } from "node:zlib";
import proj4 from "proj4";
import type { MockBackendOptions } from "../support/mockBackend";
import { CSV_CONNECTED_MOCKS, CSV_PARCELS, type ParcelRow } from "./db-csv-sync.mocks";

interface CatalogResourceMock {
  readonly id: string;
  readonly name: string;
  readonly format: string;
  readonly sizeBytes: number | null;
  readonly lastModified: string | null;
  readonly isCached: boolean;
}

interface CatalogSourceGroupMock {
  readonly sourceId: string;
  readonly datasetSlug: string;
  readonly title: string;
  readonly description?: string;
  readonly resources: ReadonlyArray<CatalogResourceMock>;
}

export const SHAPEFILE_DEPARTMENT_COLUMN = "departamen";
export const SHAPEFILE_ZIP_NAME = "parcelas_actualizadas.zip";
const SHAPEFILE_BASE_NAME = "parcelas_actualizadas";

const UTM_21S_PROJ = "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs";
const UTM_21S_PRJ =
  'PROJCS["WGS 84 / UTM zone 21S",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-57],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1],AUTHORITY["EPSG","32721"]]';

const DBF_FIELDS = [
  { property: "padron", column: "padron" },
  { property: "departamento", column: SHAPEFILE_DEPARTMENT_COLUMN },
  { property: "localidad", column: "localidad" },
  { property: "area_m2", column: "area_m2" },
  { property: "uso_suelo", column: "uso_suelo" },
] as const;
const DBF_FIELD_LENGTH = 40;
const SHP_POLYGON_TYPE = 5;
const SHP_HEADER_BYTES = 100;
const SHP_FILE_CODE = 9994;
const SHP_VERSION = 1000;

type Ring = Array<[number, number]>;

function toProjectedRing(ring: Array<[number, number]>): Ring {
  return ring.map((coordinate) => {
    const [easting, northing] = proj4("EPSG:4326", UTM_21S_PROJ, coordinate);
    return [Math.round(easting * 100) / 100, Math.round(northing * 100) / 100];
  });
}

function computeBounds(rings: Ring[]): [number, number, number, number] {
  const points = rings.flat();
  const eastings = points.map(([easting]) => easting);
  const northings = points.map(([, northing]) => northing);
  return [Math.min(...eastings), Math.min(...northings), Math.max(...eastings), Math.max(...northings)];
}

function writeBounds(buffer: Buffer, offset: number, bounds: number[]): void {
  bounds.forEach((value, index) => buffer.writeDoubleLE(value, offset + index * 8));
}

function buildPolygonRecord(ring: Ring): Buffer {
  const contentBytes = 44 + 4 + ring.length * 16;
  const content = Buffer.alloc(contentBytes);
  content.writeInt32LE(SHP_POLYGON_TYPE, 0);
  writeBounds(content, 4, computeBounds([ring]));
  content.writeInt32LE(1, 36);
  content.writeInt32LE(ring.length, 40);
  content.writeInt32LE(0, 44);
  ring.forEach(([easting, northing], index) => {
    content.writeDoubleLE(easting, 48 + index * 16);
    content.writeDoubleLE(northing, 56 + index * 16);
  });
  return content;
}

function buildMainHeader(fileBytes: number, bounds: number[]): Buffer {
  const header = Buffer.alloc(SHP_HEADER_BYTES);
  header.writeInt32BE(SHP_FILE_CODE, 0);
  header.writeInt32BE(fileBytes / 2, 24);
  header.writeInt32LE(SHP_VERSION, 28);
  header.writeInt32LE(SHP_POLYGON_TYPE, 32);
  writeBounds(header, 36, bounds);
  return header;
}

function buildShpAndShx(rings: Ring[]): { shp: Buffer; shx: Buffer } {
  const contents = rings.map(buildPolygonRecord);
  const bounds = computeBounds(rings);
  const shpRecords: Buffer[] = [];
  const shxRecords: Buffer[] = [];
  let offsetBytes = SHP_HEADER_BYTES;
  contents.forEach((content, index) => {
    const recordHeader = Buffer.alloc(8);
    recordHeader.writeInt32BE(index + 1, 0);
    recordHeader.writeInt32BE(content.length / 2, 4);
    shpRecords.push(recordHeader, content);
    const indexEntry = Buffer.alloc(8);
    indexEntry.writeInt32BE(offsetBytes / 2, 0);
    indexEntry.writeInt32BE(content.length / 2, 4);
    shxRecords.push(indexEntry);
    offsetBytes += 8 + content.length;
  });
  const shxBytes = SHP_HEADER_BYTES + shxRecords.length * 8;
  return {
    shp: Buffer.concat([buildMainHeader(offsetBytes, bounds), ...shpRecords]),
    shx: Buffer.concat([buildMainHeader(shxBytes, bounds), ...shxRecords]),
  };
}

function buildDbf(parcels: ParcelRow[]): Buffer {
  const headerBytes = 32 + DBF_FIELDS.length * 32 + 1;
  const recordBytes = 1 + DBF_FIELDS.length * DBF_FIELD_LENGTH;
  const header = Buffer.alloc(headerBytes);
  header.writeUInt8(3, 0);
  header.writeUInt8(126, 1);
  header.writeUInt8(10, 2);
  header.writeUInt8(20, 3);
  header.writeUInt32LE(parcels.length, 4);
  header.writeUInt16LE(headerBytes, 8);
  header.writeUInt16LE(recordBytes, 10);
  DBF_FIELDS.forEach((field, index) => {
    const descriptorOffset = 32 + index * 32;
    header.write(field.column, descriptorOffset, "ascii");
    header.write("C", descriptorOffset + 11, "ascii");
    header.writeUInt8(DBF_FIELD_LENGTH, descriptorOffset + 16);
  });
  header.writeUInt8(0x0d, headerBytes - 1);
  const records = parcels.map((parcel) =>
    Buffer.concat([
      Buffer.from(" ", "ascii"),
      ...DBF_FIELDS.map((field) => Buffer.from(String(parcel[field.property]).padEnd(DBF_FIELD_LENGTH, " "), "latin1")),
    ])
  );
  return Buffer.concat([header, ...records, Buffer.from([0x1a])]);
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function buildStoredZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, nameBytes, data);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function buildShapefileZip(): Buffer {
  const rings = CSV_PARCELS.map((parcel) => toProjectedRing(parcel.geometry));
  const { shp, shx } = buildShpAndShx(rings);
  return buildStoredZip([
    { name: `${SHAPEFILE_BASE_NAME}.shp`, data: shp },
    { name: `${SHAPEFILE_BASE_NAME}.shx`, data: shx },
    { name: `${SHAPEFILE_BASE_NAME}.dbf`, data: buildDbf(CSV_PARCELS) },
    { name: `${SHAPEFILE_BASE_NAME}.prj`, data: Buffer.from(UTM_21S_PRJ, "ascii") },
  ]);
}

const CATALOG_GROUPS: CatalogSourceGroupMock[] = [
  {
    sourceId: "src-catastro-default",
    datasetSlug: "catastro-nacional",
    title: "Catastro Nacional de Parcelas",
    description: "Cartografía oficial de parcelas rurales y urbanas.",
    resources: [
      {
        id: "res-parcelas-mvd",
        name: "parcelas_montevideo.zip",
        format: "SHP",
        sizeBytes: 45000,
        lastModified: "2026-08-01T00:00:00.000Z",
        isCached: true,
      },
      {
        id: "res-parcelas-canelones",
        name: "parcelas_canelones.zip",
        format: "SHP",
        sizeBytes: 78400,
        lastModified: "2026-08-12T00:00:00.000Z",
        isCached: false,
      },
    ],
  },
];

export const SHAPEFILE_CONNECTED_MOCKS: MockBackendOptions = {
  ...CSV_CONNECTED_MOCKS,
  watcherCatalog: CATALOG_GROUPS,
};
