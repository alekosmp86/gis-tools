const SCRUBBED_SECRET = "***";
const UNKNOWN_FAILURE = "error desconocido";

/** Message of any thrown value with the connection password removed. */
export function failureReader(secret: string): (error: unknown) => string {
  return (error) => {
    const message = error instanceof Error ? error.message : UNKNOWN_FAILURE;
    return secret.length > 0 ? message.split(secret).join(SCRUBBED_SECRET) : message;
  };
}
