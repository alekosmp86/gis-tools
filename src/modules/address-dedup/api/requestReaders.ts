import {
  DEFAULT_DB_HOST,
  DEFAULT_DB_PORT,
  DedupScope,
} from "../constants";
import type { DbConnection, DedupRequest } from "../types";

/** Validators for request bodies. Credentials are read from the POST body only, never from the query string. */

export type ParsedBody = Record<string, unknown>;

export type ValidationResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: string };

export async function readJsonBody(request: Request): Promise<ParsedBody | null> {
  try {
    const parsed = (await request.json()) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ParsedBody)
      : null;
  } catch {
    return null;
  }
}

export function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readConnection(body: ParsedBody): ValidationResult<DbConnection> {
  const raw = (typeof body.connection === "object" && body.connection !== null
    ? body.connection
    : {}) as ParsedBody;
  const dbName = readText(raw.db_name);
  const user = readText(raw.user);
  const password = typeof raw.password === "string" ? raw.password : "";

  if (!dbName || !user) {
    return { ok: false, error: "El nombre de la base de datos y el usuario son obligatorios." };
  }
  if (password.length === 0) {
    return { ok: false, error: "La contraseña es obligatoria." };
  }

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

export function readProvinceId(body: ParsedBody): ValidationResult<number> {
  const provinceId = body.provinceId;
  if (typeof provinceId !== "number" || !Number.isInteger(provinceId) || provinceId <= 0) {
    return { ok: false, error: "El identificador de provincia debe ser un entero positivo." };
  }
  return { ok: true, value: provinceId };
}

function readScope(body: ParsedBody): ValidationResult<DedupScope | undefined> {
  if (body.scope === undefined) return { ok: true, value: undefined };

  const knownScopes: ReadonlyArray<unknown> = Object.values(DedupScope);
  if (!knownScopes.includes(body.scope)) {
    return { ok: false, error: "El alcance indicado no es válido." };
  }
  return { ok: true, value: body.scope as DedupScope };
}

export function readToggle(body: ParsedBody): ValidationResult<boolean | undefined> {
  if (body.protectedSiblingRemovesLone === undefined) return { ok: true, value: undefined };
  if (typeof body.protectedSiblingRemovesLone !== "boolean") {
    return { ok: false, error: "La opción protectedSiblingRemovesLone debe ser verdadero o falso." };
  }
  return { ok: true, value: body.protectedSiblingRemovesLone };
}

export function readDedupRequest(body: ParsedBody): ValidationResult<DedupRequest> {
  const connection = readConnection(body);
  if (!connection.ok) return connection;
  const provinceId = readProvinceId(body);
  if (!provinceId.ok) return provinceId;
  const scope = readScope(body);
  if (!scope.ok) return scope;
  const toggle = readToggle(body);
  if (!toggle.ok) return toggle;

  return {
    ok: true,
    value: {
      connection: connection.value,
      provinceId: provinceId.value,
      scope: scope.value,
      protectedSiblingRemovesLone: toggle.value,
    },
  };
}
