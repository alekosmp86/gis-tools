import { SCRUBBED_SECRET } from "./constants.ts";

/** Replaces every exact occurrence of each non-empty secret. Longest first so overlaps hide fully. */
export function scrubSecrets(message: string, secrets: readonly string[]): string {
  const ordered = secrets.filter((secret) => secret.length > 0).sort((a, b) => b.length - a.length);
  return ordered.reduce((text, secret) => text.split(secret).join(SCRUBBED_SECRET), message);
}

export type Scrubber = (message: string) => string;

export function createScrubber(secrets: readonly string[]): Scrubber {
  const frozen = [...secrets];
  return (message) => scrubSecrets(message, frozen);
}

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
