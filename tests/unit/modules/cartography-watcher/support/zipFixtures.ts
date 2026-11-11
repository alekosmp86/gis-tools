import { crc32 } from "node:zlib";

/** Builds a minimal stored (uncompressed) ZIP so tests exercise real bytes, never a mock. */
export function buildZip(entryNames: ReadonlyArray<string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entryName of entryNames) {
    const nameBytes = Buffer.from(entryName, "utf8");
    const data = entryName.endsWith("/") ? Buffer.alloc(0) : Buffer.from(`data:${entryName}`);
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entryNames.length, 8);
  end.writeUInt16LE(entryNames.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export const FULL_SHAPEFILE_ENTRIES = [
  "centros.shp",
  "centros.dbf",
  "centros.shx",
  "centros.prj",
] as const;

export function buildShapefileZip(withProjection = true): Buffer {
  return buildZip(withProjection ? FULL_SHAPEFILE_ENTRIES : FULL_SHAPEFILE_ENTRIES.slice(0, 3));
}
