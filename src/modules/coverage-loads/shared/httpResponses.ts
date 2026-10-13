/**
 * Response helpers shared by the module's handlers. The password is scrubbed from any error text
 * before it leaves.
 */

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  SERVER_ERROR: 500,
  GATEWAY_TIMEOUT: 504,
} as const;

const SQLSTATE_LOCK_NOT_AVAILABLE = "55P03";
const SQLSTATE_QUERY_CANCELED = "57014";

const LOCK_TIMEOUT_MESSAGE = "Otra carga está en curso, intente de nuevo en unos segundos.";
const STATEMENT_TIMEOUT_MESSAGE = "La operación excedió el tiempo máximo.";

interface MappedDatabaseError {
  status: number;
  message: string;
}

const DATABASE_ERRORS_BY_SQLSTATE: Readonly<Record<string, MappedDatabaseError>> = {
  [SQLSTATE_LOCK_NOT_AVAILABLE]: { status: HTTP_STATUS.CONFLICT, message: LOCK_TIMEOUT_MESSAGE },
  [SQLSTATE_QUERY_CANCELED]: { status: HTTP_STATUS.GATEWAY_TIMEOUT, message: STATEMENT_TIMEOUT_MESSAGE },
};

function mapDatabaseError(error: unknown): MappedDatabaseError | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? (DATABASE_ERRORS_BY_SQLSTATE[code] ?? null) : null;
}

const SCRUBBED_SECRET = "***";

export function jsonResponse(body: unknown, status: number = HTTP_STATUS.OK): Response {
  return Response.json(body, { status });
}

export function failure(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ success: false, error: message, ...extra }, status);
}

function scrubSecret(message: string, secret: string): string {
  return secret.length > 0 ? message.split(secret).join(SCRUBBED_SECRET) : message;
}

export function toErrorResponse(
  error: unknown,
  secret: string,
  fallbackMessage: string,
  status: number = HTTP_STATUS.SERVER_ERROR
): Response {
  const mapped = mapDatabaseError(error);
  if (mapped) return failure(scrubSecret(mapped.message, secret), mapped.status);
  const message = error instanceof Error ? error.message : fallbackMessage;
  return failure(scrubSecret(message, secret), status);
}
