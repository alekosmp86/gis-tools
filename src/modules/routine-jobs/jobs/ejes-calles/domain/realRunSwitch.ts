import { REAL_RUN_ENV_VAR, REAL_RUN_UNAVAILABLE_MESSAGE } from "../constants";

const isEjesRealRunEnabled = (): boolean => process.env[REAL_RUN_ENV_VAR] === "true";

export function assertEjesRealRunEnabled(makeError: (message: string) => Error = (message) => new Error(message)): void {
  if (!isEjesRealRunEnabled()) throw makeError(REAL_RUN_UNAVAILABLE_MESSAGE);
}
