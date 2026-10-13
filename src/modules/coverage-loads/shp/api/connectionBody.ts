import { failure, HTTP_STATUS } from "../../shared/httpResponses";
import { readConnection, readJsonBody } from "../../shared/requestReaders";
import type { ParsedBody } from "../../shared/requestReaders";
import type { DbConnection } from "../../types";

const INVALID_JSON_MESSAGE = "El cuerpo de la solicitud debe ser un JSON válido.";

export type JsonBodyResult = { readonly ok: true; readonly body: ParsedBody } | { readonly ok: false; readonly response: Response };
export type ConnectionBodyResult =
  | { readonly ok: true; readonly body: ParsedBody; readonly connection: DbConnection }
  | { readonly ok: false; readonly response: Response };

export async function readBody(request: Request): Promise<JsonBodyResult> {
  const body = await readJsonBody(request);
  return body ? { ok: true, body } : { ok: false, response: failure(INVALID_JSON_MESSAGE, HTTP_STATUS.BAD_REQUEST) };
}

/** JSON body with the credentials inside it (never the URL or a header). */
export async function readBodyWithConnection(request: Request): Promise<ConnectionBodyResult> {
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed;
  const connection = readConnection(parsed.body);
  if (!connection.ok) return { ok: false, response: failure(connection.error, HTTP_STATUS.BAD_REQUEST) };
  return { ok: true, body: parsed.body, connection: connection.value };
}
