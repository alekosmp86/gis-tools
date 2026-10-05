/**
 * Response helpers shared by the module's handlers. The password is scrubbed from any error text
 * before it leaves.
 */

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  SERVER_ERROR: 500,
} as const;

const SCRUBBED_SECRET = "***";

export function jsonResponse(body: unknown, status: number = HTTP_STATUS.OK): Response {
  return Response.json(body, { status });
}

export function failure(message: string, status: number): Response {
  return jsonResponse({ success: false, error: message }, status);
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
  const message = error instanceof Error ? error.message : fallbackMessage;
  return failure(scrubSecret(message, secret), status);
}
