import { describe, expect, it } from "vitest";
import * as cargarPadronesState from "@/modules/routine-jobs/ui/cargarPadronesWizardState";
import * as cargarLocalidadesState from "@/modules/routine-jobs/ui/cargarLocalidadesWizardState";
import * as unidadTerritorialState from "@/modules/routine-jobs/ui/unidadTerritorialWizardState";
import * as actualizarPadronState from "@/modules/routine-jobs/ui/actualizarPadronWizardState";
import { LocalidadesDestination } from "@/modules/routine-jobs/ui/localidadesDestination";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";

const CONNECTION = { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: "pw" };
const IDLE_SNAPSHOT = { phase: RunPhase.IDLE };

const filled = (values: readonly string[]): boolean => values.every((value) => value.trim() !== "");

describe("monthly table defaults", () => {
  it("prefill the required schema and tables of stages 1 to 4", () => {
    const stage1 = cargarPadronesState.initialWizardState();
    const stage2 = cargarLocalidadesState.initialWizardStateFor(IDLE_SNAPSHOT, { connection: CONNECTION });
    const stage3 = unidadTerritorialState.initialUnidadWizardStateFor(IDLE_SNAPSHOT, { connection: CONNECTION });
    const stage4 = actualizarPadronState.initialWizardStateFor(IDLE_SNAPSHOT);
    const bdjTarget = stage2.targets[LocalidadesDestination.BDJ_CARTO];

    expect(filled([stage1.schema, stage1.tables.rural, stage1.tables.urbano, stage1.tables.target])).toBe(true);
    expect(filled([stage2.stagingSchema, stage2.provinceSchema, stage2.tables.padron, stage2.tables.locality, stage2.tables.province])).toBe(true);
    expect(filled([bdjTarget.schema, bdjTarget.table])).toBe(true);
    expect(filled(Object.values(stage3.slots).flatMap((slot) => [slot.schema, slot.table]))).toBe(true);
    expect(
      filled([
        stage4.stagingSchema,
        stage4.cartoSchema,
        stage4.tables.staging,
        stage4.tables.target,
        stage4.tables.province,
        stage4.tables.locality,
        stage4.tables.type,
      ]),
    ).toBe(true);
  });

  it("keeps the table seeded by an earlier stage over the default", () => {
    const stage2 = cargarLocalidadesState.initialWizardStateFor(IDLE_SNAPSHOT, {
      connection: CONNECTION,
      staging: { schema: "stg", table: "padron_stg" },
    });
    const stage3 = unidadTerritorialState.initialUnidadWizardStateFor(IDLE_SNAPSHOT, {
      connection: CONNECTION,
      locality: { schema: "carto", table: "mi_localidad" },
    });
    const stage4 = actualizarPadronState.initialWizardStateFor(IDLE_SNAPSHOT, { staging: { schema: "stg", table: "padron_stg" } });

    expect([stage2.stagingSchema, stage2.tables.padron]).toEqual(["stg", "padron_stg"]);
    expect(stage3.slots[unidadTerritorialState.UnitSlot.LOCALITY].table).toBe("mi_localidad");
    expect([stage4.stagingSchema, stage4.tables.staging]).toEqual(["stg", "padron_stg"]);
  });
});
