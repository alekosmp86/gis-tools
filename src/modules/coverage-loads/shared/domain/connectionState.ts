import { DEFAULT_DB_HOST, DEFAULT_DB_PORT } from "../../constants";
import type { ConnectionPayload } from "../../types";

export type ConnectionField = keyof ConnectionPayload;

export type ProfileValues = Partial<Omit<ConnectionPayload, "password">>;

export const INITIAL_CONNECTION: ConnectionPayload = {
  host: DEFAULT_DB_HOST,
  port: String(DEFAULT_DB_PORT),
  db_name: "",
  user: "",
  password: "",
};

const REQUIRED_CONNECTION_FIELDS: ReadonlyArray<ConnectionField> = ["host", "port", "db_name", "user"];

export function isConnectionComplete(connection: ConnectionPayload): boolean {
  return REQUIRED_CONNECTION_FIELDS.every((field) => connection[field].trim() !== "");
}

export function withConnectionField(
  connection: ConnectionPayload,
  field: ConnectionField,
  value: string
): ConnectionPayload {
  return { ...connection, [field]: value };
}

/** A profile never carries a password: applying one clears it. */
export function withProfileValues(connection: ConnectionPayload, values: ProfileValues): ConnectionPayload {
  return { ...connection, ...values, password: "" };
}

export function isSameConnection(left: ConnectionPayload, right: ConnectionPayload): boolean {
  return (Object.keys(left) as ConnectionField[]).every((field) => left[field] === right[field]);
}
