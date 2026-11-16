import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEjesCallesStartRequest } from "@/modules/routine-jobs/api/ejesCallesRequestParsing";
import { EJES_ROLES, EJES_SUMMARY_COUNT_KEYS, REAL_RUN_ENV_VAR } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesResult } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesAnalysisKeyOf } from "@/modules/routine-jobs/ui/shared/ejesCallesAnalysisKey";
import type { EjesRunSnapshot } from "@/modules/routine-jobs/ui/shared/ejesCallesRunStore";
import {
  ejesLoadRequestOf,
  EjesStep,
  initialEjesWizardState,
  toEjesStartRequest,
  type EjesWizardState,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesWizardState";
import { RunPhase } from "@/modules/routine-jobs/ui/shared/jobRunStore";

const PASSWORD = "pw-secret";

const validState = (overrides: Partial<EjesWizardState> = {}): EjesWizardState => {
  const initial = initialEjesWizardState();
  return {
    ...initial,
    step: EjesStep.REVIEW,
    connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD },
    slots: Object.fromEntries(EJES_ROLES.map((role) => [role, { ...initial.slots[role], valid: true }])) as EjesWizardState["slots"],
    confirmation: { password: PASSWORD },
    ...overrides,
  };
};

const FINGERPRINT = { rows: 42, digest: "0123456789abcdef0123456789abcdef" };

const countsOf = (): Record<string, number> => Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key, index) => [key, index + 1]));

const finishedResult = (overrides: Partial<EjesResult> = {}): EjesResult =>
  ({
    dryRun: true,
    blockers: [],
    counts: { ...countsOf(), twins: 50, plainHeld: 3 },
    fingerprint: { ...FINGERPRINT },
    ...overrides,
  }) as unknown as EjesResult;

const doneSnapshot = (state: EjesWizardState, overrides: Partial<EjesRunSnapshot> = {}): EjesRunSnapshot => ({
  phase: RunPhase.DONE,
  job: { state: "DONE", result: finishedResult() } as unknown as EjesRunSnapshot["job"],
  plan: { dryRun: true, ejesStaging: "bdj_carto.ide_ejesviacirculacion", analysisKey: ejesAnalysisKeyOf(toEjesStartRequest(state, { dryRun: true })) },
  ...overrides,
});

describe("ejesLoadRequestOf (EJL-22)", () => {
  beforeEach(() => {
    vi.stubEnv(REAL_RUN_ENV_VAR, "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("real-run request", () => {
    it("should be the real-run request with the summary and an empty accepted object when Cargar ahora is allowed", () => {
      const state = validState();

      const request = ejesLoadRequestOf(state, doneSnapshot(state));

      expect(request).not.toBeNull();
      expect(request).toMatchObject({ dryRun: false, accepted: {} });
      expect(Object.keys(request ?? {}).sort()).toEqual(["accepted", "connection", "dryRun", "summary", "tables"]);
    });

    it("should carry exactly the Revisar summary counts and the staging fingerprint of the finished dry run", () => {
      const state = validState();

      const request = ejesLoadRequestOf(state, doneSnapshot(state));

      expect(request?.summary).toEqual({
        counts: Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key, index) => [key, index + 1])),
        fingerprint: FINGERPRINT,
      });
    });

    it("should send the connection and the ten tables of the wizard, trimmed", () => {
      const state = validState({ connection: { host: " db.local ", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD } });

      const request = ejesLoadRequestOf(state, doneSnapshot(state));

      expect(request?.connection).toMatchObject({ host: "db.local", user: "gis_user", password: PASSWORD });
      expect(Object.keys(request?.tables ?? {})).toHaveLength(10);
    });
  });

  describe("null while Cargar ahora is not allowed", () => {
    it("should be null when the password is not retyped", () => {
      const state = validState({ confirmation: { password: "" } });

      expect(ejesLoadRequestOf(state, doneSnapshot(state))).toBeNull();
    });

    it("should be null when the analysis has a blocker", () => {
      const state = validState();
      const snapshot = doneSnapshot(state, { job: { state: "DONE", result: finishedResult({ blockers: ["bloqueo"] }) } as unknown as EjesRunSnapshot["job"] });

      expect(ejesLoadRequestOf(state, snapshot)).toBeNull();
    });

    it("should be null when the last run was not a dry run", () => {
      const state = validState();
      const snapshot = doneSnapshot(state);

      expect(ejesLoadRequestOf(state, { ...snapshot, plan: { ...snapshot.plan!, dryRun: false } })).toBeNull();
    });

    it("should be null when no analysis has finished, while one is running or it failed", () => {
      const state = validState();

      expect(ejesLoadRequestOf(state, { phase: RunPhase.IDLE })).toBeNull();
      expect(ejesLoadRequestOf(state, doneSnapshot(state, { phase: RunPhase.RUNNING }))).toBeNull();
      expect(ejesLoadRequestOf(state, doneSnapshot(state, { phase: RunPhase.FAILED }))).toBeNull();
      expect(ejesLoadRequestOf(state, doneSnapshot(state, { job: undefined }))).toBeNull();
    });

    it("should be null when a staging table changed after the analysis", () => {
      const analysed = validState();
      const changed = validState();
      changed.slots["ejes-origen"] = { ...changed.slots["ejes-origen"], table: "otra" };

      expect(ejesLoadRequestOf(changed, doneSnapshot(analysed))).toBeNull();
    });
  });

  describe("dry-run request", () => {
    it("should stay {connection, tables, dryRun: true}, with no summary and no accepted", () => {
      const state = validState();

      const request = toEjesStartRequest(state, { dryRun: true });

      expect(Object.keys(request).sort()).toEqual(["connection", "dryRun", "tables"]);
      expect(request.dryRun).toBe(true);
    });
  });

  describe("end to end through the server parser", () => {
    it("should be accepted by parseEjesCallesStartRequest with the switch on, and yield the same summary", () => {
      const state = validState();
      const request = ejesLoadRequestOf(state, doneSnapshot(state));

      const params = parseEjesCallesStartRequest(request as unknown as Record<string, unknown>);

      expect(params.dryRun).toBe(false);
      expect(params.summary).toEqual(request?.summary);
      expect(params.config).toMatchObject({ host: "db.local", user: "gis_user", db_name: "gis" });
      expect(Object.keys(params.tables)).toHaveLength(10);
    });

    it("should be refused by the server with the unavailable message when the switch is off", () => {
      vi.stubEnv(REAL_RUN_ENV_VAR, "false");
      const state = validState();
      const request = ejesLoadRequestOf(state, doneSnapshot(state));

      expect(() => parseEjesCallesStartRequest(request as unknown as Record<string, unknown>)).toThrow(
        "La carga real de ejes de calles todavía no está disponible."
      );
    });
  });
});
