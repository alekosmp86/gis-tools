/**
 * Types owned by the status module.
 *
 * A module owns its own contracts: nothing here belongs in `core/types`, because nothing outside
 * this folder has any reason to know these shapes exist.
 */

/** Execution environment the server reports. */
export const ServerEnvironment = {
  PRODUCTION: "production",
  DEVELOPMENT: "development",
} as const;

export type ServerEnvironment = (typeof ServerEnvironment)[keyof typeof ServerEnvironment];

/** Raw inputs a snapshot is derived from, injected so the derivation stays deterministic. */
export interface ServerStatusReading {
  readonly startedAt: Date;
  readonly now: Date;
  readonly nodeVersion: string;
  /** Unvalidated `NODE_ENV`; normalised into a `ServerEnvironment` by the builder. */
  readonly rawEnvironment?: string;
}

/** What the endpoint publishes. */
export interface ServerStatusSnapshot {
  readonly nodeVersion: string;
  readonly environment: ServerEnvironment;
  readonly startedAtIso: string;
  readonly uptimeSeconds: number;
  /** Human-readable uptime, in Spanish, for direct display. */
  readonly uptimeLabel: string;
}

/** Envelope returned by `GET /api/m/status`, matching the shape core's own routes use. */
export interface ServerStatusResponse {
  readonly success: boolean;
  readonly status: ServerStatusSnapshot;
}
