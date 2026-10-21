export const DEFAULT_DB_HOST = "localhost";
export const DEFAULT_DB_PORT = 5432;

export const CONNECTION_TIMEOUT_MS = 10000;

/** Budget for any single statement of the module; the loads are small, this is a safety net. */
export const STATEMENT_TIMEOUT_MS = 120000;

/** How long a write waits for a table lock (LOCK TABLE ... SHARE ROW EXCLUSIVE serialises loads) before giving up. */
export const WRITE_LOCK_TIMEOUT = "10s";

/** Upload limits and rejected-rows CSV shared by every part that takes files. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export const CSV_SEPARATOR = ";";
export const CSV_ENCLOSURE = '"';

export const REJECTED_FILE_PREFIX = "filas_rechazadas";
export const REJECTED_CSV_HEADER: ReadonlyArray<string> = ["archivo", "linea", "texto", "motivo"];

/** Browser downloads: how long the object URL lives after the click, so the download can start. */
export const DOWNLOAD_URL_REVOKE_DELAY_MS = 1000;
