import { closeSync, openSync, readSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { GpkgDatabase, GpkgDatabaseOpener, GpkgStatement } from "@/core/binary/GeoPackageReader";

const SQLITE_HEADER_PREFIX_BYTES = 20;
const SQLITE_WRITE_VERSION_OFFSET = 18;
const SQLITE_WAL_VERSION = 2;

const adaptStatement = (statement: StatementSync): GpkgStatement => {
  statement.setReadBigInts(true);
  return {
    all: <Row>() => statement.all() as unknown as Row[],
    iterate: <Row>() => statement.iterate() as unknown as Iterable<Row>,
  };
};

const adaptDatabase = (database: DatabaseSync): GpkgDatabase => ({
  prepare: (sql) => adaptStatement(database.prepare(sql)),
  close: () => database.close(),
});

const isWalModeFile = (filePath: string): boolean => {
  const header = Buffer.alloc(SQLITE_HEADER_PREFIX_BYTES);
  const fileDescriptor = openSync(filePath, "r");
  try {
    readSync(fileDescriptor, header, 0, SQLITE_HEADER_PREFIX_BYTES, 0);
  } finally {
    closeSync(fileDescriptor);
  }
  return header[SQLITE_WRITE_VERSION_OFFSET] === SQLITE_WAL_VERSION;
};

const openReadOnly = (filePath: string): DatabaseSync =>
  isWalModeFile(filePath)
    ? new DatabaseSync(filePath, { readOnly: true })
    : new DatabaseSync(`${pathToFileURL(filePath).href}?immutable=1`, { readOnly: true });

export const nodeSqliteOpener: GpkgDatabaseOpener = {
  open: (filePath) => adaptDatabase(openReadOnly(filePath)),
};
