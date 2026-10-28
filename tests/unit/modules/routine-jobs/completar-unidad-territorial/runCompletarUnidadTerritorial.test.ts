import { describe, expect, it } from "vitest";
import { runCompletarUnidadTerritorial } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/services/runCompletarUnidadTerritorial";
import { CONFIRM_REQUIRED_MESSAGE } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/services/preflight";
import { plannedCompletarStepLabels } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/domain/plannedSteps";
import { COMMIT_UNKNOWN_WARNING, DRY_RUN_WARNING } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/domain/warnings";
import type { RunProgress } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import {
  ADDRESS_MASTER_LABEL,
  COMMIT_SQL,
  completarParamsOf,
  completarRunOf,
  COMPLETAR_PASSWORD,
  linkedUnitOf,
  ROLLBACK_SQL,
  UNIT_LABEL,
  type CompletarScenario,
} from "./completarFixtures";

const BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ";
const APPLY_MARKER = '"linked_list"';
const REFRESH_PATTERN = /REFRESH/i;
const TRIGGER_MESSAGE = /tiene triggers \(trg_audit\)/;

const failureOf = async (work: Promise<unknown>): Promise<Error> => {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
};

const runWith = (scenario: CompletarScenario = {}, overrides: Parameters<typeof completarParamsOf>[0] = {}) => {
  const harness = completarRunOf(scenario);
  const run = () => runCompletarUnidadTerritorial(completarParamsOf(overrides), harness.deps);
  return { harness, run };
};

describe("runCompletarUnidadTerritorial happy path", () => {
  it("should run to COMMIT as the last statement and never ROLLBACK on a real run", async () => {
    const { harness, run } = runWith();

    const result = await run();

    expect(harness.log.indexOf(BEGIN_SQL)).toBeGreaterThan(-1);
    expect(harness.log[harness.log.length - 1]).toBe(COMMIT_SQL);
    expect(harness.log).not.toContain(ROLLBACK_SQL);
    expect(result.dryRun).toBe(false);
    expect(result.targetModified).toBe(true);
    expect(result.outcomeUnknown).toBe(false);
  });

  it("should report the counts of the classification and of the apply", async () => {
    const { run } = runWith();

    const result = await run();

    expect(result.counts).toEqual({ withoutAddressMaster: 2, created: 1, linked: 2, alreadyHadRecord: 1, ambiguous: 0 });
  });

  it("should report the table labels, the linked units and no warning when nothing is ambiguous", async () => {
    const { run } = runWith();

    const result = await run();

    expect(result.unitTable).toBe(UNIT_LABEL);
    expect(result.addressMasterTable).toBe(ADDRESS_MASTER_LABEL);
    expect(result.linkedList).toEqual([
      linkedUnitOf({ id: 101, name: "Unidad uno", provinceId: "02", addressMasterId: 501, created: true }),
      linkedUnitOf({ id: 102, name: "Unidad dos", provinceId: "02", addressMasterId: 17, created: false }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("should carry the ambiguous samples of the classification into the result", async () => {
    const sample = { id: 9, name: "Doble", provinceId: "09", records: 2 };
    const { run } = runWith({ ambiguous: 1, ambiguousSamples: [sample] });

    const result = await run();

    expect(result.ambiguousSamples).toEqual([sample]);
    expect(result.counts.ambiguous).toBe(1);
  });

  it("should close the session after a successful run", async () => {
    const { harness, run } = runWith();

    await run();

    expect(harness.closes()).toBe(1);
  });
});

describe("runCompletarUnidadTerritorial dry run (CU-10, CU-12)", () => {
  it("should end with ROLLBACK, never COMMIT, and report no target modification", async () => {
    const { harness, run } = runWith({}, { dryRun: true, confirm: false });

    const result = await run();

    expect(harness.log[harness.log.length - 1]).toBe(ROLLBACK_SQL);
    expect(harness.log).not.toContain(COMMIT_SQL);
    expect(result.dryRun).toBe(true);
    expect(result.targetModified).toBe(false);
    expect(result.warnings).toContain(DRY_RUN_WARNING);
  });

  it("should still run the insert and the update before rolling back", async () => {
    const { harness, run } = runWith({}, { dryRun: true, confirm: false });

    await run();

    const applyAt = harness.log.findIndex((sql) => sql.includes(APPLY_MARKER));
    expect(applyAt).toBeGreaterThan(-1);
    expect(applyAt).toBeLessThan(harness.log.indexOf(ROLLBACK_SQL));
  });

  it("should stay a dry run and never COMMIT when a dry run carries confirm true", async () => {
    const { harness, run } = runWith({}, { dryRun: true, confirm: true });

    const result = await run();

    expect(harness.log).not.toContain(COMMIT_SQL);
    expect(result.targetModified).toBe(false);
  });

  it("should never issue a REFRESH of the materialized view in a real run or in a dry run", async () => {
    const real = runWith();
    const dry = runWith({}, { dryRun: true, confirm: false });

    await real.run();
    await dry.run();

    expect(real.harness.log.some((sql) => REFRESH_PATTERN.test(sql))).toBe(false);
    expect(dry.harness.log.some((sql) => REFRESH_PATTERN.test(sql))).toBe(false);
  });
});

describe("runCompletarUnidadTerritorial refusals before any session (CU-13)", () => {
  it("should refuse a real run without confirm before opening a session and write nothing", async () => {
    const { harness, run } = runWith({}, { confirm: false });

    const failure = await failureOf(run());

    expect(failure.message).toBe(CONFIRM_REQUIRED_MESSAGE);
    expect(harness.openSession).not.toHaveBeenCalled();
    expect(harness.log).toEqual([]);
  });

  it("should refuse the same table used as unit and address master before opening a session", async () => {
    const { harness, run } = runWith({}, { addressMasterTable: "territorial_unit" });

    const failure = await failureOf(run());

    expect(failure.message).toMatch(/deben ser tablas distintas/);
    expect(harness.openSession).not.toHaveBeenCalled();
  });
});

describe("runCompletarUnidadTerritorial uncertain commit", () => {
  it("should report outcomeUnknown and not targetModified without throwing when COMMIT fails", async () => {
    const { harness, run } = runWith({ commitFails: true });

    const result = await run();

    expect(harness.log).toContain(COMMIT_SQL);
    expect(result.outcomeUnknown).toBe(true);
    expect(result.targetModified).toBe(false);
    expect(result.dryRun).toBe(false);
    expect(result.warnings).toContain(COMMIT_UNKNOWN_WARNING);
  });

  it("should keep the password out of the result when COMMIT fails with the password in its message", async () => {
    const { run } = runWith({ commitFails: true, commitMessage: `clave ${COMPLETAR_PASSWORD} rechazada` });

    const result = await run();

    expect(JSON.stringify(result)).not.toContain(COMPLETAR_PASSWORD);
  });
});

describe("runCompletarUnidadTerritorial preflight (CU-2, CU-14)", () => {
  it("should block the run with a Spanish message when a required unit column is missing, before any write", async () => {
    const { harness, run } = runWith({
      unitColumns: [
        { column_name: "id", data_type: "integer", is_nullable: false, column_default: "nextval('carto.territorial_unit_id_seq'::regclass)" },
        { column_name: "name", data_type: "text", is_nullable: true, column_default: null },
        { column_name: "id_province", data_type: "integer", is_nullable: true, column_default: null },
      ],
    });

    const failure = await failureOf(run());

    expect(failure.message).toMatch(/no tiene la columna requerida "id_address_master"/);
    expect(harness.log).not.toContain(BEGIN_SQL);
  });

  it("should block the run when a required column is ambiguous", async () => {
    const { run } = runWith({
      unitColumns: [
        { column_name: "id", data_type: "integer", is_nullable: false, column_default: null },
        { column_name: "Na_me", data_type: "text", is_nullable: true, column_default: null },
        { column_name: "NA-ME", data_type: "text", is_nullable: true, column_default: null },
        { column_name: "id_province", data_type: "integer", is_nullable: true, column_default: null },
        { column_name: "id_address_master", data_type: "integer", is_nullable: true, column_default: null },
      ],
    });

    const failure = await failureOf(run());

    expect(failure.message).toMatch(/columna requerida "name" .* es ambigua/);
  });

  it("should block the run when the unit table has a trigger", async () => {
    const { harness, run } = runWith({ unitTriggers: ["trg_audit"] });

    const failure = await failureOf(run());

    expect(failure.message).toMatch(TRIGGER_MESSAGE);
    expect(harness.log).not.toContain(BEGIN_SQL);
  });

  it("should block the run when the user has no UPDATE privilege on the unit table", async () => {
    const { run } = runWith({ deniedPrivileges: ["territorial_unit.UPDATE"] });

    const failure = await failureOf(run());

    expect(failure.message).toContain("No tiene privilegio UPDATE sobre la tabla carto.territorial_unit.");
  });

  it("should block the run when the user has no INSERT privilege on the address master table", async () => {
    const { run } = runWith({ deniedPrivileges: ["addresses_master.INSERT"] });

    const failure = await failureOf(run());

    expect(failure.message).toContain("No tiene privilegio INSERT sobre la tabla carto.addresses_master.");
  });

  it("should block the run when the user has no UPDATE privilege on the address master sequence", async () => {
    const { run } = runWith({ deniedPrivileges: ["sequence.UPDATE"] });

    const failure = await failureOf(run());

    expect(failure.message).toMatch(/No tiene privilegio UPDATE sobre la secuencia carto\.addresses_master_addresses_master_id_seq/);
  });

  it("should block the run when the address master id column has no sequence", async () => {
    const { run } = runWith({ unownedAddressSequence: true });

    const failure = await failureOf(run());

    expect(failure.message).toMatch(/no tiene secuencia/);
  });

  it("should block the run when the address master has another NOT NULL column without default", async () => {
    const { run } = runWith({
      addressMasterColumns: [
        { column_name: "addresses_master_id", data_type: "integer", is_nullable: false, column_default: "nextval('carto.addresses_master_addresses_master_id_seq'::regclass)" },
        { column_name: "urn", data_type: "text", is_nullable: true, column_default: null },
        { column_name: "latitud", data_type: "double precision", is_nullable: true, column_default: null },
        { column_name: "longitud", data_type: "double precision", is_nullable: true, column_default: null },
        { column_name: "tipo", data_type: "text", is_nullable: false, column_default: null },
      ],
    });

    const failure = await failureOf(run());

    expect(failure.message).toMatch(/"tipo" de carto\.addresses_master es NOT NULL sin valor por defecto/);
  });
});

describe("runCompletarUnidadTerritorial failures and progress", () => {
  it("should scrub the password from a failure to open the session", async () => {
    const { harness, run } = runWith();
    harness.openSession.mockRejectedValueOnce(new Error(`acceso denegado para ${COMPLETAR_PASSWORD}`));

    const failure = await failureOf(run());

    expect(failure.message).not.toContain(COMPLETAR_PASSWORD);
    expect(failure.message).toContain("***");
  });

  it("should report progress through exactly the planned steps of a real run, in order", async () => {
    const { harness } = runWith();
    const labels: string[] = [];
    await runCompletarUnidadTerritorial(completarParamsOf(), harness.deps, (progress: RunProgress) => labels.push(progress.label));

    expect(labels).toEqual(plannedCompletarStepLabels({ dryRun: false }));
  });

  it("should report progress through exactly the planned steps of a dry run, ending with the rollback", async () => {
    const { harness } = runWith();
    const labels: string[] = [];
    await runCompletarUnidadTerritorial(
      completarParamsOf({ dryRun: true, confirm: false }),
      harness.deps,
      (progress: RunProgress) => labels.push(progress.label),
    );

    expect(labels).toEqual(plannedCompletarStepLabels({ dryRun: true }));
  });
});
