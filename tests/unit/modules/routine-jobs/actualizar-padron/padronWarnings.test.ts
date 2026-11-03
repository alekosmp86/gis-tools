import { describe, expect, it } from "vitest";
import { buildRunWarnings, type WarningInput } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/warnings";
import type { ActualizarTargetReport, RemovalSkippedReport } from "@/modules/routine-jobs/jobs/actualizar-padron/types";

const TABLE = "carto.padron_tmp_actualizacion";
const LOOSE_ONE_WARNING = "1 padrón se actualiza por coincidencia parcial (superposición 85-98%); revisarlo en el listado de pares.";
const LOOSE_TWO_WARNING = "2 padrones se actualizan por coincidencia parcial (superposición 85-98%); revisarlos en el listado de pares.";
const CHOICE_ONE_WARNING = "1 elección de par no se aplicó (el padrón elegido ya no es candidato o sigue siendo ambiguo).";
const CHOICE_TWO_WARNING = "2 elecciones de par no se aplicaron (el padrón elegido ya no es candidato o sigue siendo ambiguo).";

const targetOf = (pairsLoose: number): ActualizarTargetReport => ({
  table: TABLE,
  schema: "carto",
  inserted: 0,
  insertedList: [],
  updated: pairsLoose,
  updateApplied: true,
  unchanged: 0,
  unchangedWithinTolerance: 0,
  changed: 0,
  missing: 0,
  missingSamples: [],
  missingByClass: { REPLACED_ONE: 0, SUBDIVIDED: 0, PARTIAL: 0, ORPHAN: 0 },
  missingReview: [],
  ambiguous: 0,
  ambiguousSamples: [],
  geometryChanges: [],
  geometryPending: 0,
  pairs: [],
  pairsTotal: pairsLoose,
  pairsApplied: pairsLoose,
  pairsLoose,
  pairsPending: 0,
  pairsNotApplied: 0,
  choicesUnapplied: 0,
});

const inputOf = (pairsLoose: number): WarningInput => ({
  dryRun: false,
  options: { tolerance: 1, geometryAreaThreshold: 0.05, updateGeometries: true, linkAddressMaster: false, pairChoices: [] },
  totals: { rowsRead: 0, candidates: 0, repaired: 0, skipped: 0 },
  target: targetOf(pairsLoose),
  collidingKeyCount: 0,
  localityWarnings: [],
  commitError: undefined,
});

const warningsOf = (pairsLoose: number): string[] => buildRunWarnings(inputOf(pairsLoose));

const choicesInputOf = (choicesUnapplied: number): WarningInput => {
  const input = inputOf(0);
  return { ...input, target: { ...input.target, choicesUnapplied } };
};

const GEOMETRY_ACCEPT_ONE_WARNING =
  "1 geometría aceptada no se aplicó (el padrón ya no tiene un cambio de geometría o Actualizar geometrías está desactivado).";
const GEOMETRY_ACCEPT_TWO_WARNING =
  "2 geometrías aceptadas no se aplicaron (el padrón ya no tiene un cambio de geometría o Actualizar geometrías está desactivado).";

const acceptsInputOf = (geometryAcceptsUnapplied: number | undefined): WarningInput => {
  const input = inputOf(0);
  return { ...input, target: { ...input.target, geometryAcceptsUnapplied } };
};

describe("buildRunWarnings accepted geometry warning (AP-100)", () => {
  it("should warn in Spanish with the singular form when one accepted geometry was not applied", () => {
    expect(buildRunWarnings(acceptsInputOf(1))).toEqual([GEOMETRY_ACCEPT_ONE_WARNING]);
  });

  it("should warn in Spanish with the plural form when several accepted geometries were not applied", () => {
    expect(buildRunWarnings(acceptsInputOf(2))).toEqual([GEOMETRY_ACCEPT_TWO_WARNING]);
  });

  it("should produce no accepted geometry warning when the count is zero or the result is older and lacks it", () => {
    expect(buildRunWarnings(acceptsInputOf(0))).toEqual([]);
    expect(buildRunWarnings(acceptsInputOf(undefined))).toEqual([]);
  });
});

const removalsSkippedOf = (stillPairable: number, nowReferenced: number, unverified = 0, notReassignable = 0): RemovalSkippedReport => ({
  total: stillPairable + nowReferenced + notReassignable + unverified,
  byReason: { STILL_PAIRABLE: stillPairable, NOW_REFERENCED: nowReferenced, NOT_REASSIGNABLE: notReassignable, UNVERIFIED: unverified },
});

const removalInputOf = (
  removed: number | undefined,
  removalsSkipped: RemovalSkippedReport | undefined,
  overrides: { dryRun?: boolean; missing?: number; removalBlockedReason?: string } = {}
): WarningInput => {
  const input = inputOf(0);
  const { dryRun = false, missing = 0, removalBlockedReason } = overrides;
  return { ...input, dryRun, target: { ...input.target, missing, removed, removalsSkipped, removalBlockedReason } };
};

const SKIPPED_WARNING = /no se elimina/;

describe("buildRunWarnings automatic removal warnings (AP-105)", () => {
  it("should warn in Spanish with the plural past form naming the table when a real run deleted several padrones", () => {
    const warnings = buildRunWarnings(removalInputOf(3, removalsSkippedOf(0, 0), { missing: 3 }));

    expect(warnings).toContain(`3 padrones sin fila de origen eliminados de ${TABLE} (sin direcciones asociadas o con direcciones reasignadas a sus partes).`);
  });

  it("should warn with the singular past form when a real run deleted exactly one padron", () => {
    const warnings = buildRunWarnings(removalInputOf(1, removalsSkippedOf(0, 0), { missing: 1 }));

    expect(warnings).toContain(`1 padrón sin fila de origen eliminado de ${TABLE} (sin direcciones asociadas o con direcciones reasignadas a sus partes).`);
  });

  it("should warn with the future form when an analysis will delete padrones", () => {
    const many = buildRunWarnings(removalInputOf(2, removalsSkippedOf(0, 0), { dryRun: true, missing: 2 }));
    const one = buildRunWarnings(removalInputOf(1, removalsSkippedOf(0, 0), { dryRun: true, missing: 1 }));

    expect(many).toContain(`2 padrones sin fila de origen se eliminarán de ${TABLE} (sin direcciones asociadas o con direcciones reasignadas a sus partes).`);
    expect(one).toContain(`1 padrón sin fila de origen se eliminará de ${TABLE} (sin direcciones asociadas o con direcciones reasignadas a sus partes).`);
  });

  it("should warn naming both counts, grouped by the two held-back reasons, when padrones are not deleted", () => {
    const warnings = buildRunWarnings(removalInputOf(1, removalsSkippedOf(2, 1), { missing: 4 }));

    expect(warnings).toContain(
      "3 padrones sin fila de origen no se eliminan: 2 porque tienen un par sin resolver, 1 porque tienen direcciones asociadas."
    );
  });

  it("should use the singular form and leave out the zero reason when exactly one padron is not deleted", () => {
    const pairable = buildRunWarnings(removalInputOf(0, removalsSkippedOf(1, 0), { missing: 1 }));
    const referenced = buildRunWarnings(removalInputOf(0, removalsSkippedOf(0, 1), { missing: 1 }));

    expect(pairable).toContain("1 padrón sin fila de origen no se elimina: 1 porque tienen un par sin resolver.");
    expect(referenced).toContain("1 padrón sin fila de origen no se elimina: 1 porque tienen direcciones asociadas.");
  });

  it("should produce no deletion warning when nothing is deleted and nothing is held back", () => {
    const warnings = buildRunWarnings(removalInputOf(0, removalsSkippedOf(0, 0)));

    expect(warnings.some((warning) => /eliminad|eliminar|no se elimina/.test(warning))).toBe(false);
  });

  it("should produce no deletion warning when the removal fields are absent (an older result shape)", () => {
    const warnings = buildRunWarnings(removalInputOf(undefined, undefined));

    expect(warnings).toEqual([]);
  });

  it("should count only the kept missing padrones in the listed-not-modified warning", () => {
    const warnings = buildRunWarnings(removalInputOf(2, removalsSkippedOf(1, 2), { missing: 5 }));

    expect(warnings).toContain(`3 padrones de ${TABLE} sin fila de origen: se listan, no se modifican.`);
  });

  it("should leave out the listed-not-modified warning when every missing padron is deleted", () => {
    const warnings = buildRunWarnings(removalInputOf(4, removalsSkippedOf(0, 0), { missing: 4 }));

    expect(warnings.some((warning) => warning.includes("se listan, no se modifican"))).toBe(false);
  });

  it("should carry the blocked reason as a run warning and report nothing deleted when the reference scan was blocked", () => {
    const reason = "No se encontraron tablas que referencien padrones: no se eliminan padrones faltantes.";

    const warnings = buildRunWarnings(removalInputOf(0, removalsSkippedOf(0, 0, 3), { missing: 3, removalBlockedReason: reason }));

    expect(warnings).toContain(reason);
    expect(warnings.some((warning) => warning.includes("sin fila de origen se eliminar") || warning.includes("sin fila de origen eliminad"))).toBe(false);
  });

  it("should not repeat the unverified padrones in the skipped warning, as the blocked reason already explains them", () => {
    const warnings = buildRunWarnings(removalInputOf(0, removalsSkippedOf(0, 0, 3), { missing: 3, removalBlockedReason: "bloqueado" }));

    expect(warnings.some((warning) => SKIPPED_WARNING.test(warning))).toBe(false);
  });
});

describe("buildRunWarnings reassignment warnings (AP-113, AP-115)", () => {
  const withReassigned = (reassigned: number | undefined, dryRun: boolean): WarningInput => {
    const input = removalInputOf(0, removalsSkippedOf(0, 0), { dryRun });
    return { ...input, target: { ...input.target, reassigned } };
  };

  it("should warn in the past, plural, when a real run moved several addresses to the nearest part", () => {
    expect(buildRunWarnings(withReassigned(3, false))).toContain("3 direcciones de padrones subdivididos pasaron a la parte más cercana.");
  });

  it("should warn in the past, singular, when a real run moved exactly one address", () => {
    expect(buildRunWarnings(withReassigned(1, false))).toContain("1 dirección de un padrón subdividido pasó a la parte más cercana.");
  });

  it("should warn in the future when an analysis will move addresses", () => {
    expect(buildRunWarnings(withReassigned(2, true))).toContain("2 direcciones de padrones subdivididos pasarán a la parte más cercana.");
    expect(buildRunWarnings(withReassigned(1, true))).toContain("1 dirección de un padrón subdividido pasará a la parte más cercana.");
  });

  it("should produce no reassignment warning when zero or absent", () => {
    expect(buildRunWarnings(withReassigned(0, false)).some((warning) => warning.includes("parte más cercana"))).toBe(false);
    expect(buildRunWarnings(withReassigned(undefined, false)).some((warning) => warning.includes("parte más cercana"))).toBe(false);
  });

  it("should list the not-reassignable reason in the held-back warning and count it in the total", () => {
    const warnings = buildRunWarnings(removalInputOf(0, removalsSkippedOf(1, 1, 0, 2), { missing: 4 }));

    expect(warnings).toContain(
      "4 padrones sin fila de origen no se eliminan: 1 porque tienen un par sin resolver, 1 porque tienen direcciones asociadas, 2 porque no se pueden reasignar sus direcciones."
    );
  });

  it("should warn singular when exactly one padron is not reassignable", () => {
    const warnings = buildRunWarnings(removalInputOf(0, removalsSkippedOf(0, 0, 0, 1), { missing: 1 }));

    expect(warnings).toContain("1 padrón sin fila de origen no se elimina: 1 porque no se pueden reasignar sus direcciones.");
  });
});

describe("buildRunWarnings loose pair warning", () => {
  it("should warn in Spanish with the singular form when exactly one padron was applied by partial match", () => {
    expect(warningsOf(1)).toContain(LOOSE_ONE_WARNING);
  });

  it("should warn in Spanish with the plural form when several padrones were applied by partial match", () => {
    expect(warningsOf(2)).toContain(LOOSE_TWO_WARNING);
  });

  it("should produce no partial-match warning when no pair was applied loosely", () => {
    expect(warningsOf(0).some((warning) => warning.includes("coincidencia parcial"))).toBe(false);
  });

  it("should produce no warnings at all when the target has no pairs, ambiguous, missing or changed padrones", () => {
    expect(warningsOf(0)).toEqual([]);
  });

  it("should warn in Spanish with the singular or plural form when pair choices were not applied and none when zero", () => {
    expect(buildRunWarnings(choicesInputOf(1))).toContain(CHOICE_ONE_WARNING);
    expect(buildRunWarnings(choicesInputOf(2))).toContain(CHOICE_TWO_WARNING);
    expect(buildRunWarnings(choicesInputOf(0))).toEqual([]);
  });
});
