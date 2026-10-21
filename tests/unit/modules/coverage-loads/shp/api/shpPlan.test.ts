import { describe, expect, it } from "vitest";
import { buildShpPlan } from "@/modules/coverage-loads/shp/services/shpPlan";
import { EXPECTED_MS_BY_TABLE } from "@/modules/coverage-loads/shp/job/constants.ts";
import type { ShpTable } from "@/modules/coverage-loads/shp/job/types.ts";
import type { ShpDbInspection } from "@/modules/coverage-loads/shp/types";
import type { TableLockView } from "@/modules/coverage-loads/shp/services/tableLock";
import { createTmpRoots, HEALTHY_INSPECTION, makeJob } from "../helpers/apiTestEnv";
import { afterEach } from "vitest";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

async function planFor(inspection: Partial<ShpDbInspection>, lock: TableLockView = "FREE", table: ShpTable = "lte") {
  const { status } = await makeJob(await roots.create(), { table });
  return buildShpPlan(status, { ...HEALTHY_INSPECTION, ...inspection }, lock);
}

describe("buildShpPlan", () => {
  it("should allow starting, defaulting to LOAD, when nothing is wrong", async () => {
    // Arrange & Act
    const plan = await planFor({});

    // Assert
    expect(plan).toMatchObject({
      target: { table: "lte" },
      defaultMode: "LOAD",
      availableModes: ["LOAD", "TEST"],
      currentRows: 42,
      leftovers: [],
      blockers: [],
      privilegeShortfalls: [],
      canStart: true,
    });
  });

  it("should block when the target table does not exist", async () => {
    // Arrange & Act
    const plan = await planFor({ tableExists: false });

    // Assert
    expect(plan.blockers).toEqual(["La tabla public.lte no existe en esta base de datos."]);
    expect(plan.canStart).toBe(false);
  });

  it("should block when PostGIS is missing", async () => {
    // Arrange & Act
    const plan = await planFor({ postgisAvailable: false });

    // Assert
    expect(plan.blockers).toEqual(["La extensión PostGIS no está instalada en esta base de datos."]);
    expect(plan.canStart).toBe(false);
  });

  it("should block when another session holds the advisory lock", async () => {
    // Arrange & Act
    const plan = await planFor({ advisoryLockHeld: true });

    // Assert
    expect(plan.blockers).toEqual(["Otra sesión tiene tomado el bloqueo de carga de esta tabla."]);
    expect(plan.canStart).toBe(false);
  });

  it("should block when another live job holds the folder lock", async () => {
    // Arrange & Act
    const plan = await planFor({}, "OTHER", "wcdma");

    // Assert
    expect(plan.blockers).toEqual(["Ya hay una carga de wcdma en curso."]);
    expect(plan.canStart).toBe(false);
  });

  it("should block when this very job already holds the lock (already started)", async () => {
    // Arrange & Act
    const plan = await planFor({}, "OWN");

    // Assert
    expect(plan.blockers).toEqual(["Esta carga ya fue iniciada."]);
    expect(plan.canStart).toBe(false);
  });

  it("should list every blocker at once, in a stable order", async () => {
    // Arrange & Act
    const plan = await planFor({ tableExists: false, postgisAvailable: false, advisoryLockHeld: true }, "OTHER");

    // Assert
    expect(plan.blockers).toHaveLength(4);
    expect(plan.blockers[0]).toContain("no existe");
    expect(plan.blockers[1]).toContain("PostGIS");
    expect(plan.blockers[3]).toContain("en curso");
  });

  it("should report table privilege shortfalls separately from blockers and refuse to start", async () => {
    // Arrange & Act
    const plan = await planFor({ missingTablePrivileges: ["DELETE", "INSERT"] });

    // Assert
    expect(plan.blockers).toEqual([]);
    expect(plan.privilegeShortfalls).toEqual(["Faltan privilegios sobre public.lte: DELETE, INSERT."]);
    expect(plan.canStart).toBe(false);
  });

  it("should report a missing CREATE on the schema as a shortfall", async () => {
    // Arrange & Act
    const plan = await planFor({ schemaCreateGranted: false });

    // Assert
    expect(plan.privilegeShortfalls).toHaveLength(1);
    expect(plan.privilegeShortfalls[0]).toContain("CREATE");
    expect(plan.canStart).toBe(false);
  });

  it("should treat leftovers as warnings that never block the start", async () => {
    // Arrange & Act
    const plan = await planFor({ leftovers: ["shp_stage_lte", "shp_work_lte"] });

    // Assert
    expect(plan.leftovers).toEqual(["shp_stage_lte", "shp_work_lte"]);
    expect(plan.blockers).toEqual([]);
    expect(plan.canStart).toBe(true);
  });

  it("should carry a null row count through when the table cannot be read", async () => {
    // Arrange & Act
    const plan = await planFor({ currentRows: null });

    // Assert
    expect(plan.currentRows).toBeNull();
  });

  it.each(Object.entries(EXPECTED_MS_BY_TABLE) as Array<[ShpTable, number]>)(
    "should expect the table duration for %s",
    async (table, expected) => {
      // Arrange & Act
      const plan = await planFor({}, "FREE", table);

      // Assert
      expect(plan.expectedMs).toBe(expected);
    }
  );
});
