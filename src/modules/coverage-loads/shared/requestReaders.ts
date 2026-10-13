import { DEFAULT_DB_HOST, DEFAULT_DB_PORT } from "../constants";
import type { DbConnection } from "../types";

/** Validators for request bodies. Credentials are read from the POST body only, never from the query string. */

export type ParsedBody = Record<string, unknown>;

export type ValidationResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: string };

const CONNECTION_REQUIRED_MESSAGE = "El nombre de la base de datos y el usuario son obligatorios.";
const PASSWORD_REQUIRED_MESSAGE = "La contraseña es obligatoria.";
const CONNECTION_INVALID_MESSAGE = "Los datos de conexión no son válidos.";

function asRecord(value: unknown): ParsedBody | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as ParsedBody) : null;
}

export function parseJsonRecord(text: string): ParsedBody | null {
  try {
    return asRecord(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export async function readJsonBody(request: Request): Promise<ParsedBody | null> {
  try {
    return asRecord((await request.json()) as unknown);
  } catch {
    return null;
  }
}

export function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Validates the connection object, whether it arrived inside a JSON body or as a multipart JSON field. */
export function readConnectionFields(rawConnection: unknown): ValidationResult<DbConnection> {
  const raw = asRecord(rawConnection) ?? {};
  const dbName = readText(raw.db_name);
  const user = readText(raw.user);
  const password = typeof raw.password === "string" ? raw.password : "";

  if (!dbName || !user) return { ok: false, error: CONNECTION_REQUIRED_MESSAGE };
  if (password.length === 0) return { ok: false, error: PASSWORD_REQUIRED_MESSAGE };

  return {
    ok: true,
    value: {
      host: readText(raw.host) || DEFAULT_DB_HOST,
      port: Number(raw.port) || DEFAULT_DB_PORT,
      db_name: dbName,
      user,
      password,
    },
  };
}

export function readConnection(body: ParsedBody): ValidationResult<DbConnection> {
  return readConnectionFields(body.connection);
}

/** Multipart form: the connection travels as a JSON string in the `connection` field. */
export function readConnectionFromForm(form: FormData, fieldName: string): ValidationResult<DbConnection> {
  const rawField = form.get(fieldName);
  if (typeof rawField !== "string") return { ok: false, error: CONNECTION_INVALID_MESSAGE };
  const parsed = parseJsonRecord(rawField);
  if (!parsed) return { ok: false, error: CONNECTION_INVALID_MESSAGE };
  return readConnectionFields(parsed);
}
