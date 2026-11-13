import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunDeps, RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { REAL_RUN_ENV_VAR, REAL_RUN_UNAVAILABLE_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { assertEjesRealRunEnabled } from "@/modules/routine-jobs/jobs/ejes-calles/domain/realRunSwitch";
import { runEjesCalles } from "@/modules/routine-jobs/jobs/ejes-calles/services/runEjesCalles";
import { runEjesPersistTransaction } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import { createEjesDatabase, loadContextOn, paramsWith } from "./ejesLoadHarness";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertEjesRealRunEnabled (EJL-16)", () => {
  it("should use the EJES_CALLES_REAL_RUN_ENABLED variable", () => {
    expect(REAL_RUN_ENV_VAR).toBe("EJES_CALLES_REAL_RUN_ENABLED");
  });

  it("should throw the unavailable message when the variable is unset", () => {
    vi.stubEnv(REAL_RUN_ENV_VAR, undefined);

    expect(() => assertEjesRealRunEnabled()).toThrow(REAL_RUN_UNAVAILABLE_MESSAGE);
  });

  it.each(["false", "TRUE", "True", "1", "", " true"])("should throw when the variable is %j", (value) => {
    vi.stubEnv(REAL_RUN_ENV_VAR, value);

    expect(() => assertEjesRealRunEnabled()).toThrow(REAL_RUN_UNAVAILABLE_MESSAGE);
  });

  it("should not throw when the variable is exactly true", () => {
    vi.stubEnv(REAL_RUN_ENV_VAR, "true");

    expect(() => assertEjesRealRunEnabled()).not.toThrow();
  });

  it("should throw the error built by the given factory", () => {
    vi.stubEnv(REAL_RUN_ENV_VAR, "false");
    const custom = new TypeError("custom");

    expect(() => assertEjesRealRunEnabled(() => custom)).toThrow(custom);
  });
});

describe("runEjesCalles with the switch off (EJL-16)", () => {
  it("should refuse a non-dry run and open no session", async () => {
    vi.stubEnv(REAL_RUN_ENV_VAR, "false");
    const openSession = vi.fn(async (): Promise<RunSession> => {
      throw new Error("session must not open");
    });
    const deps: RunDeps = { openSession, now: () => 0 };

    await expect(runEjesCalles(paramsWith(undefined), deps)).rejects.toThrow(REAL_RUN_UNAVAILABLE_MESSAGE);
    expect(openSession).not.toHaveBeenCalled();
  });

  it("should still open a session for a dry run", async () => {
    vi.stubEnv(REAL_RUN_ENV_VAR, "false");
    const openSession = vi.fn(async (): Promise<RunSession> => {
      throw new Error("opened");
    });
    const deps: RunDeps = { openSession, now: () => 0 };

    await expect(runEjesCalles({ ...paramsWith(undefined), dryRun: true }, deps)).rejects.toThrow("opened");
    expect(openSession).toHaveBeenCalledTimes(1);
  });
});

describe("runEjesPersistTransaction with the switch off (EJL-16)", () => {
  it("should refuse and issue no SQL", async () => {
    vi.stubEnv(REAL_RUN_ENV_VAR, "false");
    const query = vi.fn(async () => ({ rows: [] }));
    const session = { query, close: async () => undefined } as unknown as RunSession;
    const database = await createEjesDatabase(PGlite);
    try {
      const context = await loadContextOn(database);
      query.mockClear();

      await expect(
        runEjesPersistTransaction(session, paramsWith({ counts: {} as never }), context, createStepTimer({ now: () => 0, total: 20 }))
      ).rejects.toThrow(REAL_RUN_UNAVAILABLE_MESSAGE);
      expect(query).not.toHaveBeenCalled();
    } finally {
      await database.close();
    }
  }, 60_000);
});
