import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompletarUnidadTerritorialWizard } from "@/modules/routine-jobs/ui/CompletarUnidadTerritorialWizard";
import { getUnidadRunStore } from "@/modules/routine-jobs/ui/unidadTerritorialRunStore";
import type { ClientConnection, UnidadStartRequest } from "@/modules/routine-jobs/ui/clientTypes";

const CONNECTION: ClientConnection = { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: "pw" };
const DOTTED_SCHEMA = "mi.esquema";
const DOTTED_TABLE = "tabla.con.puntos";

/** Starting the stage 3 run publishes its plan before any network call; the fetch never settles. */
function seedStageThreePlan(targetSchema: string, targetTable: string): void {
  const request = {
    connection: CONNECTION,
    localitySchema: "stg",
    localityTable: "localidades",
    typeSchema: "carto",
    typeTable: "tipo_unidad",
    targetSchema,
    targetTable,
    options: { localityTypeName: "LOCALIDAD CATASTRAL", tolerance: 1, updateGeometries: true },
    dryRun: true,
    confirm: false,
  } as unknown as UnidadStartRequest;
  void getUnidadRunStore().start(request);
}

const renderWizard = (): string =>
  renderToStaticMarkup(React.createElement(CompletarUnidadTerritorialWizard, { connection: CONNECTION }));

/** The value attributes of the schema fields, in the order the table cards render them: unit first, then address master. */
const schemaValuesOf = (html: string): string[] => [...html.matchAll(/value="([^"]*)"/g)].map((match) => match[1]);

describe("CompletarUnidadTerritorialWizard unit table prefill (CU-1)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    getUnidadRunStore().reset();
  });

  afterEach(() => {
    getUnidadRunStore().reset();
    vi.unstubAllGlobals();
  });

  it("should prefill the unit table with carto.territorial_unit when no stage 3 run exists", () => {
    const values = schemaValuesOf(renderWizard());

    expect(values[0]).toBe("carto");
  });

  it("should prefill the unit schema from the stage 3 plan without splitting a schema that contains a dot", () => {
    seedStageThreePlan(DOTTED_SCHEMA, DOTTED_TABLE);

    const values = schemaValuesOf(renderWizard());

    expect(values[0]).toBe(DOTTED_SCHEMA);
    expect(values).not.toContain("mi");
  });

  it("should prefill the unit table name from the stage 3 plan when it contains dots", () => {
    seedStageThreePlan(DOTTED_SCHEMA, DOTTED_TABLE);

    expect(renderWizard()).toContain(DOTTED_TABLE);
  });

  it("should keep the address master table at carto.addresses_master whatever the stage 3 plan holds", () => {
    seedStageThreePlan(DOTTED_SCHEMA, DOTTED_TABLE);

    const html = renderWizard();
    const addressCard = html.slice(html.indexOf("Direcciones maestras"));

    expect(/value="([^"]*)"/.exec(addressCard)?.[1]).toBe("carto");
    expect(html).toContain("addresses_master");
  });
});
