import { describe, expect, it } from "vitest";
import { EJES_TABLE_ROLE, type EjesTableRole } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesResult } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EjesAcceptList, type EjesAcceptChange } from "@/modules/routine-jobs/ui/ejes-calles/ejesAccept";
import { ejesAnalysisKeyOf } from "@/modules/routine-jobs/ui/shared/ejesCallesAnalysisKey";
import type { EjesRunSnapshot } from "@/modules/routine-jobs/ui/shared/ejesCallesRunStore";
import {
  acceptKeysOfState,
  ejesLoadRequestOf,
  ejesWizardReducer,
  initialEjesWizardState,
  resultKeyOf,
  toEjesStartRequest,
  type EjesWizardState,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesWizardState";
import { RunPhase } from "@/modules/routine-jobs/ui/shared/jobRunStore";

const PASSWORD = "Ejes-Accept-pw!3";

const tablesDone = (): EjesWizardState => {
  let state = initialEjesWizardState();
  state = ejesWizardReducer(state, { type: "connectionChanged", field: "host", value: "db.local" });
  state = ejesWizardReducer(state, { type: "connectionChanged", field: "db_name", value: "gis" });
  state = ejesWizardReducer(state, { type: "connectionChanged", field: "user", value: "gis_user" });
  for (const role of Object.values(EJES_TABLE_ROLE) as EjesTableRole[]) {
    state = ejesWizardReducer(state, { type: "slotTableChosen", key: role, table: `t_${role}`, valid: true });
  }
  return state;
};

const typedPassword = (state: EjesWizardState): EjesWizardState => {
  const withPassword = ejesWizardReducer(state, { type: "connectionChanged", field: "password", value: PASSWORD });
  return ejesWizardReducer(withPassword, { type: "confirmationChanged", patch: { password: PASSWORD } });
};

const accept = (state: EjesWizardState, analysisKey: string, change: EjesAcceptChange): EjesWizardState =>
  ejesWizardReducer(state, { type: "acceptChanged", analysisKey, change });

const withAcceptance = (): EjesWizardState =>
  accept(
    accept(tablesDone(), "key-1", { list: EjesAcceptList.PLAIN_REMOVALS, keys: ["5001"], accepted: true }),
    "key-1",
    { list: EjesAcceptList.MERGES, keys: ["6103"], accepted: true }
  );

const resultOf = (overrides: Partial<EjesResult> = {}): EjesResult =>
  ({
    dryRun: true,
    targetModified: false,
    outcomeUnknown: false,
    blockers: [],
    counts: { newSections: 2, unchanged: 3, attr: 0, geom: 0, both: 0, removed: 1, splits: 0, merges: 1, plainRemovals: 1, renumbered: 0, renumberSkipped: 0, splitPointsAuto: 0, splitPointsReview: 0, splitPointsNoGeometry: 0 },
    fingerprint: { rows: 4, digest: "abc123" },
    ...overrides,
  }) as unknown as EjesResult;

const doneSnapshotFor = (state: EjesWizardState, jobId = "job-1"): EjesRunSnapshot =>
  ({
    phase: RunPhase.DONE,
    jobId,
    job: { state: "DONE", result: resultOf() },
    plan: { dryRun: true, analysisKey: ejesAnalysisKeyOf(toEjesStartRequest(state, { dryRun: true })) },
  }) as unknown as EjesRunSnapshot;

const acceptedOn = (state: EjesWizardState, snapshot: EjesRunSnapshot): EjesWizardState => ({
  ...state,
  acceptance: { analysisKey: resultKeyOf(snapshot), splits: [], plainRemovals: ["5001"], merges: ["6103"], twinRemovals: [], pointChoices: [] },
});

describe("ejes wizard accepted rows (EJ-24)", () => {
  describe("acceptChanged", () => {
    it("should store the accepted keys on the state, for the analysis key of the change", () => {
      const state = withAcceptance();

      expect(state.acceptance).toEqual({ analysisKey: "key-1", splits: [], plainRemovals: ["5001"], merges: ["6103"], twinRemovals: [], pointChoices: [] });
    });

    it("should leave the wizard step and the typed confirmation as they were", () => {
      const typed = typedPassword(tablesDone());
      const next = accept(typed, "key-1", { list: EjesAcceptList.MERGES, keys: ["6103"], accepted: true });

      expect(next.step).toBe(typed.step);
      expect(next.confirmation).toEqual(typed.confirmation);
    });
  });

  describe("acceptance is cleared when the connection or a table changes, and on reset", () => {
    it("should clear the acceptance when a connection field other than the password changes", () => {
      const next = ejesWizardReducer(withAcceptance(), { type: "connectionChanged", field: "host", value: "otro.local" });

      expect(next.acceptance).toBeNull();
    });

    it("should clear the acceptance when a table is chosen", () => {
      const next = ejesWizardReducer(withAcceptance(), {
        type: "slotTableChosen",
        key: EJES_TABLE_ROLE.ROAD_SECTION,
        table: "otra_tabla",
        valid: true,
      });

      expect(next.acceptance).toBeNull();
    });

    it("should clear the acceptance when a table schema changes", () => {
      const next = ejesWizardReducer(withAcceptance(), {
        type: "slotSchemaChanged",
        key: EJES_TABLE_ROLE.ROAD_SECTION,
        schema: "otro_esquema",
      });

      expect(next.acceptance).toBeNull();
    });

    it("should clear the acceptance on reset", () => {
      expect(ejesWizardReducer(withAcceptance(), { type: "reset" }).acceptance).toBeNull();
    });

    it("should clear the acceptance when a new dry run starts, since a new analysis is a new result", () => {
      const next = ejesWizardReducer(withAcceptance(), { type: "runStarted", dryRun: true });

      expect(next.acceptance).toBeNull();
    });

    it("should keep the acceptance when a real run starts, so the rows stay accepted on the result", () => {
      const next = ejesWizardReducer(withAcceptance(), { type: "runStarted", dryRun: false });

      expect(next.acceptance).toEqual({ analysisKey: "key-1", splits: [], plainRemovals: ["5001"], merges: ["6103"], twinRemovals: [], pointChoices: [] });
    });

    it("should keep the acceptance when only the password changes", () => {
      const next = ejesWizardReducer(withAcceptance(), { type: "connectionChanged", field: "password", value: "otra-clave-2" });

      expect(next.acceptance).toEqual({ analysisKey: "key-1", splits: [], plainRemovals: ["5001"], merges: ["6103"], twinRemovals: [], pointChoices: [] });
    });
  });

  describe("the keys sent with Cargar ahora", () => {
    it("should send the accepted keys of the same analysis in the real-run request, with the summary of the dry run", () => {
      const state = typedPassword(tablesDone());
      const snapshot = doneSnapshotFor(state);
      const analysisState = acceptedOn(state, snapshot);

      const request = ejesLoadRequestOf(analysisState, snapshot);

      expect(request).not.toBeNull();
      expect(request?.dryRun).toBe(false);
      expect(request?.accepted).toEqual({ splits: [], plainRemovals: [{ ref: "5001" }], merges: [{ newRef: "6103" }], twinRemovals: [] });
      expect(request?.summary).toEqual({
        counts: { newSections: 2, unchanged: 3, attr: 0, geom: 0, both: 0, removed: 1, splits: 0, merges: 1, plainRemovals: 1, renumbered: 0, renumberSkipped: 0, splitPointsAuto: 0, splitPointsReview: 0, splitPointsNoGeometry: 0 },
        fingerprint: { rows: 4, digest: "abc123" },
      });
    });

    it("should send no accepted key after a new dry run, because the new analysis clears the selection", () => {
      const state = typedPassword(tablesDone());
      const analysisState = acceptedOn(state, doneSnapshotFor(state, "job-1"));
      const reAnalysed = ejesWizardReducer(analysisState, { type: "runStarted", dryRun: true });
      const snapshot = doneSnapshotFor(reAnalysed, "job-2");

      const request = ejesLoadRequestOf(reAnalysed, snapshot);

      expect(reAnalysed.acceptance).toBeNull();
      expect(request?.accepted).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: [] });
    });

    it("should not match an acceptance made on a result of another job id, even for the same analysis", () => {
      const state = typedPassword(tablesDone());
      const acceptedOnFirst = acceptedOn(state, doneSnapshotFor(state, "job-1"));
      const secondResult = doneSnapshotFor(state, "job-2");

      expect(acceptKeysOfState(acceptedOnFirst, secondResult)).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: [] });
      expect(acceptKeysOfState(acceptedOnFirst, doneSnapshotFor(state, "job-1"))).toEqual({
        splits: [],
        plainRemovals: ["5001"],
        merges: ["6103"], twinRemovals: [],
      });
    });

    it("should keep the accepted keys for the same result after a password-only change, and send them", () => {
      const state = typedPassword(tablesDone());
      const snapshot = doneSnapshotFor(state);
      const accepted = acceptedOn(state, snapshot);
      const retyped = ejesWizardReducer(accepted, { type: "connectionChanged", field: "password", value: `${PASSWORD}x` });
      const retypedAgain = ejesWizardReducer(retyped, { type: "confirmationChanged", patch: { password: `${PASSWORD}x` } });

      expect(retyped.acceptance).toEqual(accepted.acceptance);
      expect(acceptKeysOfState(retypedAgain, snapshot)).toEqual({ splits: [], plainRemovals: ["5001"], merges: ["6103"], twinRemovals: [] });
    });

    it("should send an empty accepted object when the acceptance was made for another analysis", () => {
      const typed = typedPassword(tablesDone());
      const acceptedElsewhere = accept(typed, "otra-analisis", { list: EjesAcceptList.MERGES, keys: ["6103"], accepted: true });
      const snapshot = doneSnapshotFor(acceptedElsewhere);

      expect(acceptKeysOfState(acceptedElsewhere, snapshot)).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: [] });
      expect(ejesLoadRequestOf(acceptedElsewhere, snapshot)?.accepted).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: [] });
    });

    it("should return no real-run request without the typed password", () => {
      const state = tablesDone();

      expect(ejesLoadRequestOf(state, doneSnapshotFor(state))).toBeNull();
    });

    it("should return no real-run request when the connection changed after the analysis (accepted keys are cleared too)", () => {
      const analysisState = typedPassword(withAcceptance());
      const snapshot = doneSnapshotFor(analysisState);
      const changed = ejesWizardReducer(analysisState, { type: "connectionChanged", field: "host", value: "otro.local" });

      expect(changed.acceptance).toBeNull();
      expect(ejesLoadRequestOf(changed, snapshot)).toBeNull();
    });
  });
});
