export const DOWNLOAD_PROGRESS_BYTE_INTERVAL = 64 * 1024;

export const DIRECT_DOWNLOAD_TIMEOUT_MS = 60_000;

export const DIRECT_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;

export const ZIP_LOCAL_HEADER_SIGNATURE: ReadonlyArray<number> = [0x50, 0x4b, 0x03, 0x04];

export const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE: ReadonlyArray<number> = [0x50, 0x4b, 0x05, 0x06];

export const ZIP_END_OF_CENTRAL_DIRECTORY_MIN_BYTES = 22;

export const ZIP_END_OF_CENTRAL_DIRECTORY_SEARCH_BYTES = 65535 + ZIP_END_OF_CENTRAL_DIRECTORY_MIN_BYTES;

export const ZIP_MAX_ENTRIES = 65535;

export const SHAPEFILE_REQUIRED_EXTENSIONS: ReadonlyArray<string> = [".shp", ".dbf", ".shx"];

export const SHAPEFILE_PROJECTION_EXTENSION = ".prj";

export const DIRECT_ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

export const DIRECT_CATALOG_FORMAT = "SHP";

export const DIRECT_ZIP_EXTENSION = ".zip";

export const ON_DEMAND_LABEL = "Se descarga en cada uso";

export const MISSING_PRJ_WARNING = "Sin archivo .prj: se pedirá el SRID al cargar.";
