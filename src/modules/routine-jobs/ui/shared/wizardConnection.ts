// fallow-ignore-file duplicate-export
import type { ClientConnection } from "./clientTypes";

export const WizardStep = {
  CONNECTION: "connection",
  TABLES: "tables",
  OPTIONS: "options",
  REVIEW: "review",
  RESULT: "result",
} as const;

export type WizardStep = (typeof WizardStep)[keyof typeof WizardStep];

export type ConnectionField = keyof ClientConnection;

const PORT_MIN = 1;
const PORT_MAX = 65535;
const DIGITS_PATTERN = /^\d+$/;

const CONNECTION_MESSAGES = {
  host: "Indique el servidor (host).",
  port: `El puerto debe ser un número entre ${PORT_MIN} y ${PORT_MAX}.`,
  database: "Indique la base de datos.",
  user: "Indique el usuario.",
} as const;

/** Every connection field changes the server or the credentials, so it invalidates the catalog failures. */
const CATALOG_FIELDS: readonly ConnectionField[] = ["host", "port", "db_name", "user", "password"];

export function connectionFieldInvalidatesCatalog(field: ConnectionField): boolean {
  return CATALOG_FIELDS.includes(field);
}

export const isBlank = (value: string): boolean => value.trim() === "";

const isValidPort = (value: string): boolean => {
  const trimmed = value.trim();
  if (!DIGITS_PATTERN.test(trimmed)) return false;
  const port = Number(trimmed);
  return port >= PORT_MIN && port <= PORT_MAX;
};

export function connectionBlockingReason(connection: ClientConnection): string | null {
  if (isBlank(connection.host)) return CONNECTION_MESSAGES.host;
  if (!isValidPort(connection.port)) return CONNECTION_MESSAGES.port;
  if (isBlank(connection.db_name)) return CONNECTION_MESSAGES.database;
  if (isBlank(connection.user)) return CONNECTION_MESSAGES.user;
  return null;
}
