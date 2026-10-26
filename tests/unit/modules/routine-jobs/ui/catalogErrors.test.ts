import { describe, expect, it } from "vitest";
import {
  clearCatalogFailure,
  currentCatalogError,
  emptyCatalogFailures,
  recordCatalogFailure,
  type CatalogFailures,
} from "@/modules/routine-jobs/ui/catalogErrors";

const KEY_A = "9:db.local|4:5432|3:gis|5:carto|8:catastro";
const KEY_B = "9:db.local|4:5432|3:gis|5:carto|5:otro1";
const FIRST = "Error interno al procesar la solicitud.";
const SECOND = "No se pudo conectar con el servidor.";

const frozen = <T extends object>(value: T): Readonly<T> => Object.freeze({ ...value });

describe("catalogErrors", () => {
  describe("emptyCatalogFailures", () => {
    it("AC-4b: should return an object with no recorded failures", () => {
      expect(emptyCatalogFailures()).toEqual({});
    });

    it("AC-4b: should return an independent object on every call", () => {
      const first = emptyCatalogFailures() as Record<string, string>;
      first[KEY_A] = FIRST;

      expect(emptyCatalogFailures()).toEqual({});
    });
  });

  describe("recordCatalogFailure", () => {
    it("AC-4b: should record the message under the key", () => {
      const failures = recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST);

      expect(currentCatalogError(failures, KEY_A)).toBe(FIRST);
    });

    it("AC-4b: should keep the first message already recorded for the same key", () => {
      const once = recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST);
      const twice = recordCatalogFailure(once, KEY_A, SECOND);

      expect(currentCatalogError(twice, KEY_A)).toBe(FIRST);
    });

    it("AC-4b: should return a new object when the key already has a message", () => {
      const once = recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST);
      const twice = recordCatalogFailure(once, KEY_A, SECOND);

      expect(twice).not.toBe(once);
    });

    it("AC-4b: should keep failures of other keys when recording a new key", () => {
      const once = recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST);
      const twice = recordCatalogFailure(once, KEY_B, SECOND);

      expect(currentCatalogError(twice, KEY_A)).toBe(FIRST);
      expect(currentCatalogError(twice, KEY_B)).toBe(SECOND);
    });

    it("AC-4b: should not mutate the failures it is given", () => {
      const before = recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST);
      const snapshot = JSON.stringify(before);

      recordCatalogFailure(before, KEY_B, SECOND);
      recordCatalogFailure(before, KEY_A, SECOND);

      expect(JSON.stringify(before)).toBe(snapshot);
      expect(currentCatalogError(before, KEY_B)).toBeNull();
    });

    it("AC-4b: should accept frozen failures without throwing and return the recorded message", () => {
      const input: CatalogFailures = frozen({ [KEY_A]: FIRST });

      const next = recordCatalogFailure(input, KEY_B, SECOND);

      expect(currentCatalogError(next, KEY_B)).toBe(SECOND);
      expect(currentCatalogError(next, KEY_A)).toBe(FIRST);
    });
  });

  describe("clearCatalogFailure", () => {
    it("AC-4b: should remove the message recorded for the key", () => {
      const failures = recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST);

      expect(currentCatalogError(clearCatalogFailure(failures, KEY_A), KEY_A)).toBeNull();
    });

    it("AC-4b: should keep the messages of the other keys", () => {
      const both = recordCatalogFailure(recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST), KEY_B, SECOND);

      const cleared = clearCatalogFailure(both, KEY_A);

      expect(currentCatalogError(cleared, KEY_B)).toBe(SECOND);
    });

    it("AC-4b: should leave an unknown key's failures equal to before", () => {
      const failures = recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST);

      expect(clearCatalogFailure(failures, KEY_B)).toEqual(failures);
    });

    it("AC-4b: should return an equal object when clearing from empty failures", () => {
      expect(clearCatalogFailure(emptyCatalogFailures(), KEY_A)).toEqual({});
    });

    it("AC-4b: should not mutate the failures it is given", () => {
      const failures = recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST);
      const snapshot = JSON.stringify(failures);

      clearCatalogFailure(failures, KEY_A);

      expect(JSON.stringify(failures)).toBe(snapshot);
      expect(currentCatalogError(failures, KEY_A)).toBe(FIRST);
    });

    it("AC-4b: should accept frozen failures without throwing", () => {
      const input: CatalogFailures = frozen({ [KEY_A]: FIRST, [KEY_B]: SECOND });

      const cleared = clearCatalogFailure(input, KEY_A);

      expect(currentCatalogError(cleared, KEY_A)).toBeNull();
      expect(currentCatalogError(cleared, KEY_B)).toBe(SECOND);
    });
  });

  describe("currentCatalogError", () => {
    it("AC-4b: should return null for a key with no failure", () => {
      expect(currentCatalogError(emptyCatalogFailures(), KEY_A)).toBeNull();
    });

    it("AC-4b: should return null for an empty key", () => {
      const failures = recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST);

      expect(currentCatalogError(failures, "")).toBeNull();
    });

    it("AC-4b: should return the message of the requested key only", () => {
      const failures = recordCatalogFailure(recordCatalogFailure(emptyCatalogFailures(), KEY_A, FIRST), KEY_B, SECOND);

      expect(currentCatalogError(failures, KEY_A)).toBe(FIRST);
      expect(currentCatalogError(failures, KEY_B)).toBe(SECOND);
    });
  });
});
