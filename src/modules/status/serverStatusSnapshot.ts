import { ServerEnvironment } from "./types";
import type { ServerStatusReading, ServerStatusSnapshot } from "./types";

/**
 * Derives the published status from raw readings.
 *
 * Kept free of `process` and of the clock so it is deterministic and testable: the handler supplies
 * the readings, this decides what they mean. That split is what lets the module's real logic be
 * covered by unit tests without mocking anything.
 */

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;

/** Anything that is not an explicit production build is treated as development. */
function resolveEnvironment(rawEnvironment?: string): ServerEnvironment {
  return rawEnvironment === ServerEnvironment.PRODUCTION
    ? ServerEnvironment.PRODUCTION
    : ServerEnvironment.DEVELOPMENT;
}

/**
 * Elapsed whole seconds. Clamped at zero: a clock adjustment can place `now` before `startedAt`,
 * and a negative uptime is worse than an honest zero.
 */
function resolveUptimeSeconds(startedAt: Date, now: Date): number {
  const elapsedMilliseconds = now.getTime() - startedAt.getTime();
  return elapsedMilliseconds <= 0 ? 0 : Math.floor(elapsedMilliseconds / MILLISECONDS_PER_SECOND);
}

/** Joins the significant unit with its remainder, dropping the remainder when it is zero. */
function joinUptimeParts(primary: string, remainder: number, remainderUnit: string): string {
  return remainder === 0 ? primary : `${primary} ${remainder} ${remainderUnit}`;
}

/** Renders uptime in Spanish at the coarsest unit that still says something useful. */
function describeUptime(uptimeSeconds: number): string {
  if (uptimeSeconds < SECONDS_PER_MINUTE) {
    return "menos de un minuto";
  }

  if (uptimeSeconds < SECONDS_PER_HOUR) {
    return `${Math.floor(uptimeSeconds / SECONDS_PER_MINUTE)} min`;
  }

  if (uptimeSeconds < SECONDS_PER_DAY) {
    const wholeHours = Math.floor(uptimeSeconds / SECONDS_PER_HOUR);
    const remainingMinutes = Math.floor((uptimeSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    return joinUptimeParts(`${wholeHours} h`, remainingMinutes, "min");
  }

  const wholeDays = Math.floor(uptimeSeconds / SECONDS_PER_DAY);
  const remainingHours = Math.floor((uptimeSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  return joinUptimeParts(`${wholeDays} d`, remainingHours, "h");
}

export function buildServerStatusSnapshot(reading: ServerStatusReading): ServerStatusSnapshot {
  const uptimeSeconds = resolveUptimeSeconds(reading.startedAt, reading.now);

  return {
    nodeVersion: reading.nodeVersion,
    environment: resolveEnvironment(reading.rawEnvironment),
    startedAtIso: reading.startedAt.toISOString(),
    uptimeSeconds,
    uptimeLabel: describeUptime(uptimeSeconds),
  };
}
