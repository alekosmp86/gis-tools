import { describe, expect, it } from "vitest";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { runCompletarWriteTransaction } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/services/writeSteps";
import type { CompletarLayouts } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/types";
import {
  ADDRESS_MASTER_LABEL,
  COMMIT_SQL,
  completarLayoutsOf,
  completarParamsOf,
  completarRunOf,
  COMPLETAR_PASSWORD,
  indexOfSql,
  ROLLBACK_SQL,
  type CompletarScenario,
} from "./completarFixtures";

const CLASSIFY_MARKER = '"without_address_master"';
const APPLY_MARKER = '"linked_list"';
const REMAINING_MARKER = '"remaining"';
const SEQUENCE_MARKER = "setval(";
const ANALYZE_UNIT = `ANALYZE "carto"."territorial_unit";`;
const ANALYZE_ADDRESS_MASTER = `ANALYZE "carto"."addresses_master";`;

const runWrite = async (scenario: CompletarScenario = {}, options: { dryRun?: boolean } = {}) => {
  const harness = completarRunOf(scenario);
  const params = completarParamsOf({ dryRun: options.dryRun ?? false, confirm: options.dryRun !== true });
  const timer = createStepTimer({ now: () => 0, total: 9 });
  const outcome = await runCompletarWriteTransaction(harness.session, params, completarLayoutsOf(), timer);
  return { outcome, log: harness.log };
};

const failureOf = async (work: Promise<unknown>): Promise<Error> => {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
};

const failureOfRun = (scenario: CompletarScenario, options: { dryRun?: boolean } = {}): Promise<Error> => {
  const harness = completarRunOf(scenario);
  const params = completarParamsOf({ dryRun: options.dryRun ?? false, confirm: true });
  const timer = createStepTimer({ now: () => 0, total: 9 });
  return failureOf(runCompletarWriteTransaction(harness.session, params, completarLayoutsOf(), timer));
};

describe("runCompletarWriteTransaction count checks roll back the whole transaction (CU-11)", () => {
  it("should ROLLBACK, never COMMIT, and reject when the created records differ from the candidates without a row", async () => {
    const scenario: CompletarScenario = { toCreate: 2, alreadyHadRecord: 0, appliedCreated: 1, appliedLinked: 2 };
    const harness = completarRunOf(scenario);
    const timer = createStepTimer({ now: () => 0, total: 9 });

    const failure = await failureOf(
      runCompletarWriteTransaction(harness.session, completarParamsOf(), completarLayoutsOf(), timer),
    );

    expect(failure.message).toMatch(/creados \(1\) no coinciden con los esperados \(2\)/);
    expect(harness.log).toContain(ROLLBACK_SQL);
    expect(harness.log).not.toContain(COMMIT_SQL);
  });

  it("should ROLLBACK, never COMMIT, and reject when the linked units differ from the candidates minus the ambiguous", async () => {
    const scenario: CompletarScenario = { toCreate: 1, alreadyHadRecord: 2, ambiguous: 1, appliedLinked: 2 };
    const harness = completarRunOf(scenario);
    const timer = createStepTimer({ now: () => 0, total: 9 });

    const failure = await failureOf(
      runCompletarWriteTransaction(harness.session, completarParamsOf(), completarLayoutsOf(), timer),
    );

    expect(failure.message).toMatch(/enlazadas \(2\) no coinciden con las esperadas \(3\)/);
    expect(harness.log).toContain(ROLLBACK_SQL);
    expect(harness.log).not.toContain(COMMIT_SQL);
  });

  it("should ROLLBACK, never COMMIT, and reject when units still lack an address master and differ from the ambiguous count", async () => {
    const scenario: CompletarScenario = { toCreate: 1, alreadyHadRecord: 1, ambiguous: 0, remaining: 1 };
    const harness = completarRunOf(scenario);
    const timer = createStepTimer({ now: () => 0, total: 9 });

    const failure = await failureOf(
      runCompletarWriteTransaction(harness.session, completarParamsOf(), completarLayoutsOf(), timer),
    );

    expect(failure.message).toMatch(/después del enlace \(1\) no coinciden con las ambiguas \(0\)/);
    expect(harness.log).toContain(ROLLBACK_SQL);
    expect(harness.log).not.toContain(COMMIT_SQL);
  });

  it("should accept the remaining units when they equal the ambiguous count, the boundary of a legitimate run", async () => {
    const { outcome, log } = await runWrite({ toCreate: 1, alreadyHadRecord: 1, ambiguous: 1, remaining: 1, appliedLinked: 2 });

    expect(outcome.targetModified).toBe(true);
    expect(log[log.length - 1]).toBe(COMMIT_SQL);
  });

  it("should accept an apply that matches the expected totals exactly with zero candidates", async () => {
    const { outcome } = await runWrite({ toCreate: 0, alreadyHadRecord: 0, ambiguous: 0, appliedCreated: 0, appliedLinked: 0, linkedList: [], remaining: 0 });

    expect(outcome.counts).toEqual({ withoutAddressMaster: 0, created: 0, linked: 0, alreadyHadRecord: 0, ambiguous: 0 });
    expect(outcome.linkedList).toEqual([]);
  });
});

describe("runCompletarWriteTransaction ambiguous units (CU-7)", () => {
  it("should count ambiguous units as neither created nor linked and report them as samples", async () => {
    const sample = { id: 9, name: "Doble", provinceId: "09", records: 2 };
    const { outcome } = await runWrite({
      toCreate: 1,
      alreadyHadRecord: 1,
      ambiguous: 1,
      ambiguousSamples: [sample],
      appliedLinked: 2,
      remaining: 1,
    });

    expect(outcome.counts).toEqual({ withoutAddressMaster: 3, created: 1, linked: 2, alreadyHadRecord: 1, ambiguous: 1 });
    expect(outcome.ambiguousSamples).toEqual([sample]);
  });
});

describe("runCompletarWriteTransaction dry run (CU-10, CU-12)", () => {
  it("should end with ROLLBACK, never COMMIT, and report no target modification", async () => {
    const { outcome, log } = await runWrite({}, { dryRun: true });

    expect(log[log.length - 1]).toBe(ROLLBACK_SQL);
    expect(log).not.toContain(COMMIT_SQL);
    expect(outcome.targetModified).toBe(false);
    expect(outcome.outcomeUnknown).toBe(false);
  });

  it("should still run the insert and the update before rolling back", async () => {
    const { log } = await runWrite({}, { dryRun: true });

    expect(indexOfSql(log, (sql) => sql.includes(APPLY_MARKER))).toBeGreaterThan(-1);
    expect(indexOfSql(log, (sql) => sql.includes(APPLY_MARKER))).toBeLessThan(log.indexOf(ROLLBACK_SQL));
  });

  it.each([false, true])("should never issue a REFRESH of the materialized view (dryRun %s)", async (dryRun) => {
    const { log } = await runWrite({}, { dryRun });

    expect(log.some((sql) => /REFRESH/i.test(sql))).toBe(false);
  });
});

describe("runCompletarWriteTransaction order inside the transaction (CU-10)", () => {
  it("should repair the address master sequence once, before the first classification and the first apply", async () => {
    const { log } = await runWrite();

    const sequenceAt = indexOfSql(log, (sql) => sql.includes(SEQUENCE_MARKER));
    const classifyAt = indexOfSql(log, (sql) => sql.includes(CLASSIFY_MARKER));
    const applyAt = indexOfSql(log, (sql) => sql.includes(APPLY_MARKER));

    expect(sequenceAt).toBeGreaterThan(-1);
    expect(log.filter((sql) => sql.includes(SEQUENCE_MARKER))).toHaveLength(1);
    expect(classifyAt).toBeGreaterThan(sequenceAt);
    expect(applyAt).toBeGreaterThan(sequenceAt);
  });

  it("should repair the sequence named by the address master layout", async () => {
    const { log } = await runWrite();

    expect(log.find((sql) => sql.includes(SEQUENCE_MARKER))).toContain(
      `'"carto"."addresses_master_addresses_master_id_seq"'::regclass`,
    );
  });

  it("should analyze both target tables before the COMMIT", async () => {
    const { log } = await runWrite();

    const commitAt = log.indexOf(COMMIT_SQL);
    expect(log.indexOf(ANALYZE_UNIT)).toBeGreaterThan(-1);
    expect(log.indexOf(ANALYZE_UNIT)).toBeLessThan(commitAt);
    expect(log.indexOf(ANALYZE_ADDRESS_MASTER)).toBeLessThan(commitAt);
  });

  it("should verify the remaining units after the apply", async () => {
    const { log } = await runWrite();

    expect(indexOfSql(log, (sql) => sql.includes(REMAINING_MARKER))).toBeGreaterThan(indexOfSql(log, (sql) => sql.includes(APPLY_MARKER)));
  });

  it("should open the transaction with REPEATABLE READ and close it with COMMIT on a real run", async () => {
    const { log } = await runWrite();

    expect(log[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ");
    expect(log[log.length - 1]).toBe(COMMIT_SQL);
  });
});

describe("runCompletarWriteTransaction failures", () => {
  it("should refuse the sequence repair with a Spanish error and roll back when the address master has no sequence", async () => {
    const layouts = completarLayoutsOf();
    const withoutSequence: CompletarLayouts = { ...layouts, addressMaster: { ...layouts.addressMaster, idSequence: null } };
    const harness = completarRunOf();
    const timer = createStepTimer({ now: () => 0, total: 9 });

    const failure = await failureOf(
      runCompletarWriteTransaction(harness.session, completarParamsOf(), withoutSequence, timer),
    );

    expect(failure.message).toMatch(/no tiene secuencia/);
    expect(harness.log).toContain(ROLLBACK_SQL);
    expect(harness.log).not.toContain(COMMIT_SQL);
  });

  it("should name the job and say the tables were not modified when the apply fails", async () => {
    const failure = await failureOfRun({ failOn: APPLY_MARKER, failMessage: "violación de restricción" });

    expect(failure.message).toMatch(/^No se pudo completar la creación y enlace de direcciones maestras: violación de restricción\. /);
    expect(failure.message).toContain("Las tablas de unidades territoriales y de direcciones maestras no fueron modificadas.");
  });

  it("should report that the tables could not be verified when the rollback after a failure also fails", async () => {
    const harness = completarRunOf({ failOn: APPLY_MARKER, failMessage: "fallo de apply" });
    const originalQuery = harness.session.query.bind(harness.session);
    harness.session.query = async (sql: string, values?: unknown[]) => {
      if (sql === ROLLBACK_SQL) throw new Error("rollback caído");
      return originalQuery(sql, values);
    };
    const timer = createStepTimer({ now: () => 0, total: 9 });

    const failure = await failureOf(
      runCompletarWriteTransaction(harness.session, completarParamsOf(), completarLayoutsOf(), timer),
    );

    expect(failure.message).toContain("No se pudo revertir la transacción");
  });

  it("should report outcomeUnknown and not targetModified when the COMMIT fails", async () => {
    const { outcome } = await runWrite({ commitFails: true, commitMessage: "conexión cortada" });

    expect(outcome.outcomeUnknown).toBe(true);
    expect(outcome.targetModified).toBe(false);
    expect(outcome.commitError).toBe("conexión cortada");
  });

  it("should scrub the password from a COMMIT error", async () => {
    const { outcome } = await runWrite({ commitFails: true, commitMessage: `clave ${COMPLETAR_PASSWORD} rechazada` });

    expect(outcome.commitError).not.toContain(COMPLETAR_PASSWORD);
    expect(outcome.commitError).toContain("***");
  });

  it("should report the target modified on a successful real run", async () => {
    const { outcome } = await runWrite();

    expect(outcome.targetModified).toBe(true);
    expect(outcome.outcomeUnknown).toBe(false);
    expect(outcome.commitError).toBeUndefined();
  });

  it("should label the address master table with its qualified name in the count message", async () => {
    const failure = await failureOfRun({ toCreate: 2, alreadyHadRecord: 0, appliedCreated: 1, appliedLinked: 2 });

    expect(failure.message).toContain(ADDRESS_MASTER_LABEL);
  });
});
