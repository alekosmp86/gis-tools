import { describe, expect, it } from "vitest";
import type { PairChoice } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import {
  initialWizardState,
  simulationBlockingReason,
  wizardReducer,
  WizardStep,
  type ActualizarWizardState,
} from "@/modules/routine-jobs/ui/actualizarPadronWizardState";

const MESSAGE_SIMULATION_STALE = "Analice de nuevo con la selección de pares actual antes de persistir.";

const choiceOf = (overrides: Partial<PairChoice> = {}): PairChoice => ({
  typePadron: "URBANO",
  provinceId: 2,
  localityId: 10,
  number: "100",
  oldId: 7,
  ...overrides,
});

const FIRST = choiceOf({ number: "100", oldId: 7 });
const SECOND = choiceOf({ number: "200", oldId: 8 });
const THIRD = choiceOf({ number: "300", oldId: 9 });

const stateWith = (pairChoices: PairChoice[], overrides: Partial<ActualizarWizardState> = {}): ActualizarWizardState => ({
  ...initialWizardState(),
  step: WizardStep.REVIEW,
  pairChoices,
  ...overrides,
});

describe("actualizarPadronWizardState pair choice bulk actions", () => {
  describe("pairChoicesChosen", () => {
    it("should add every chosen pair when the list has no choices yet", () => {
      const next = wizardReducer(stateWith([]), { type: "pairChoicesChosen", choices: [FIRST, SECOND] });

      expect(next.pairChoices).toHaveLength(2);
      expect(next.pairChoices).toEqual(expect.arrayContaining([FIRST, SECOND]));
    });

    it("should keep the choices of other new keys when a bulk choice is dispatched", () => {
      const next = wizardReducer(stateWith([FIRST]), { type: "pairChoicesChosen", choices: [SECOND, THIRD] });

      expect(next.pairChoices).toHaveLength(3);
      expect(next.pairChoices).toEqual(expect.arrayContaining([FIRST, SECOND, THIRD]));
    });

    it("should replace the earlier choice of a new key that is chosen again in bulk", () => {
      const replacement = choiceOf({ number: "100", oldId: 42 });

      const next = wizardReducer(stateWith([FIRST, SECOND]), { type: "pairChoicesChosen", choices: [replacement] });

      expect(next.pairChoices).toHaveLength(2);
      expect(next.pairChoices).toEqual(expect.arrayContaining([replacement, SECOND]));
      expect(next.pairChoices).not.toContainEqual(FIRST);
    });

    it("should leave the choices unchanged when an empty bulk choice is dispatched", () => {
      const state = stateWith([FIRST, SECOND]);

      const next = wizardReducer(state, { type: "pairChoicesChosen", choices: [] });

      expect(next.pairChoices).toEqual([FIRST, SECOND]);
    });

    it("should keep the step and the simulated choices when a bulk choice is dispatched", () => {
      const simulated = [FIRST];
      const state = stateWith([FIRST], { simulatedChoices: simulated });

      const next = wizardReducer(state, { type: "pairChoicesChosen", choices: [SECOND] });

      expect(next.step).toBe(WizardStep.REVIEW);
      expect(next.simulatedChoices).toBe(simulated);
    });

    it("should make the analysis on screen stale when a bulk choice changes the selection after it completed", () => {
      const state = stateWith([FIRST], { simulatedChoices: [FIRST] });

      const next = wizardReducer(state, { type: "pairChoicesChosen", choices: [SECOND] });

      expect(simulationBlockingReason(next)).toBe(MESSAGE_SIMULATION_STALE);
    });
  });

  describe("pairChoicesRemoved", () => {
    it("should remove every listed new key and keep the others", () => {
      const removedWithOtherOldId = choiceOf({ number: "100", oldId: 99 });

      const next = wizardReducer(stateWith([FIRST, SECOND, THIRD]), {
        type: "pairChoicesRemoved",
        choices: [removedWithOtherOldId, SECOND],
      });

      expect(next.pairChoices).toEqual([THIRD]);
    });

    it("should leave the choices unchanged when the removed list names no chosen new key", () => {
      const state = stateWith([FIRST]);

      const next = wizardReducer(state, { type: "pairChoicesRemoved", choices: [THIRD] });

      expect(next.pairChoices).toEqual([FIRST]);
    });

    it("should leave the choices unchanged when an empty removal is dispatched", () => {
      const next = wizardReducer(stateWith([FIRST, SECOND]), { type: "pairChoicesRemoved", choices: [] });

      expect(next.pairChoices).toEqual([FIRST, SECOND]);
    });

    it("should leave no choice when every chosen new key is removed in bulk", () => {
      const next = wizardReducer(stateWith([FIRST, SECOND]), { type: "pairChoicesRemoved", choices: [FIRST, SECOND] });

      expect(next.pairChoices).toEqual([]);
    });
  });
});
