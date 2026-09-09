import { describe, it, expect } from "vitest";
import { buildServerStatusSnapshot } from "@/modules/status/serverStatusSnapshot";
import { ServerEnvironment } from "@/modules/status/types";
import type { ServerStatusReading } from "@/modules/status/types";

const STARTED_AT = new Date("2026-09-09T10:00:00.000Z");

function buildReading(overrides: Partial<ServerStatusReading> = {}): ServerStatusReading {
  return {
    startedAt: STARTED_AT,
    now: STARTED_AT,
    nodeVersion: "v24.19.0",
    ...overrides,
  };
}

/** Builds a reading whose clock sits exactly `elapsedSeconds` after the start instant. */
function buildReadingAfterSeconds(elapsedSeconds: number): ServerStatusReading {
  return buildReading({ now: new Date(STARTED_AT.getTime() + elapsedSeconds * 1000) });
}

describe("buildServerStatusSnapshot", () => {
  it("should report zero uptime when the server has just started", () => {
    // Arrange & Act
    const snapshot = buildServerStatusSnapshot(buildReadingAfterSeconds(0));

    // Assert
    expect(snapshot.uptimeSeconds).toBe(0);
    expect(snapshot.uptimeLabel).toBe("menos de un minuto");
  });

  it("should floor a partial second rather than rounding it up", () => {
    // Arrange: 90.9 seconds is one minute of uptime, not two.
    const reading = buildReading({ now: new Date(STARTED_AT.getTime() + 90_900) });

    // Act
    const snapshot = buildServerStatusSnapshot(reading);

    // Assert
    expect(snapshot.uptimeSeconds).toBe(90);
    expect(snapshot.uptimeLabel).toBe("1 min");
  });

  it("should clamp uptime to zero when the clock moves backwards", () => {
    // Arrange: an NTP correction can place "now" before the start instant.
    const reading = buildReading({ now: new Date(STARTED_AT.getTime() - 60_000) });

    // Act
    const snapshot = buildServerStatusSnapshot(reading);

    // Assert: an honest zero beats a negative uptime.
    expect(snapshot.uptimeSeconds).toBe(0);
    expect(snapshot.uptimeLabel).toBe("menos de un minuto");
  });

  it("should switch from seconds to minutes exactly at one minute", () => {
    // Arrange & Act
    const justUnder = buildServerStatusSnapshot(buildReadingAfterSeconds(59));
    const exactlyOneMinute = buildServerStatusSnapshot(buildReadingAfterSeconds(60));

    // Assert
    expect(justUnder.uptimeLabel).toBe("menos de un minuto");
    expect(exactlyOneMinute.uptimeLabel).toBe("1 min");
  });

  it("should switch from minutes to hours exactly at one hour", () => {
    // Arrange & Act
    const justUnder = buildServerStatusSnapshot(buildReadingAfterSeconds(3599));
    const exactlyOneHour = buildServerStatusSnapshot(buildReadingAfterSeconds(3600));

    // Assert
    expect(justUnder.uptimeLabel).toBe("59 min");
    expect(exactlyOneHour.uptimeLabel).toBe("1 h");
  });

  it("should append the remaining minutes to an hour count", () => {
    // Arrange: 2 h 5 min.
    const snapshot = buildServerStatusSnapshot(buildReadingAfterSeconds(2 * 3600 + 5 * 60));

    // Assert
    expect(snapshot.uptimeLabel).toBe("2 h 5 min");
  });

  it("should omit a zero remainder from the hour label", () => {
    // Arrange & Act
    const snapshot = buildServerStatusSnapshot(buildReadingAfterSeconds(3 * 3600));

    // Assert: "3 h", never "3 h 0 min".
    expect(snapshot.uptimeLabel).toBe("3 h");
  });

  it("should switch from hours to days exactly at one day", () => {
    // Arrange & Act
    const justUnder = buildServerStatusSnapshot(buildReadingAfterSeconds(24 * 3600 - 1));
    const exactlyOneDay = buildServerStatusSnapshot(buildReadingAfterSeconds(24 * 3600));

    // Assert
    expect(justUnder.uptimeLabel).toBe("23 h 59 min");
    expect(exactlyOneDay.uptimeLabel).toBe("1 d");
  });

  it("should append the remaining hours to a day count and omit a zero remainder", () => {
    // Arrange & Act
    const withRemainder = buildServerStatusSnapshot(buildReadingAfterSeconds(3 * 86400 + 4 * 3600));
    const withoutRemainder = buildServerStatusSnapshot(buildReadingAfterSeconds(5 * 86400));

    // Assert
    expect(withRemainder.uptimeLabel).toBe("3 d 4 h");
    expect(withoutRemainder.uptimeLabel).toBe("5 d");
  });

  it("should treat an explicit production environment as production", () => {
    // Arrange & Act
    const snapshot = buildServerStatusSnapshot(buildReading({ rawEnvironment: "production" }));

    // Assert
    expect(snapshot.environment).toBe(ServerEnvironment.PRODUCTION);
  });

  it("should treat any other environment value as development", () => {
    // Arrange: unknown, empty and absent values must never be reported as production.
    const candidates = ["development", "test", "staging", "PRODUCTION", "", undefined];

    // Act & Assert
    for (const rawEnvironment of candidates) {
      const snapshot = buildServerStatusSnapshot(buildReading({ rawEnvironment }));
      expect(snapshot.environment).toBe(ServerEnvironment.DEVELOPMENT);
    }
  });

  it("should carry the node version through untouched and publish the start instant as ISO", () => {
    // Arrange & Act
    const snapshot = buildServerStatusSnapshot(buildReading({ nodeVersion: "v22.11.0" }));

    // Assert
    expect(snapshot.nodeVersion).toBe("v22.11.0");
    expect(snapshot.startedAtIso).toBe("2026-09-09T10:00:00.000Z");
  });
});
