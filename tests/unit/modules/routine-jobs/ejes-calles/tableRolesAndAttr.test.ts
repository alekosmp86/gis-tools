import { describe, expect, it } from "vitest";
import {
  EJES_DEFAULT_TABLES,
  EJES_READ_ROLES,
  EJES_REQUIRED_COLUMNS_BY_ROLE,
  EJES_ROLES,
  EJES_WRITE_ROLES,
  EJES_TABLE_ROLE,
} from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ejesAttrChangesOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/attrChanges";
import { plannedEjesStepLabels } from "@/modules/routine-jobs/jobs/ejes-calles/domain/plannedSteps";
import { assertDistinctEjesTables } from "@/modules/routine-jobs/jobs/ejes-calles/domain/tableRoles";
import type { EjesAttrRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesTables } from "./ejesFixtures";

describe("EJ-4 table roles", () => {
  it("should define eight roles with the spec default tables", () => {
    expect(EJES_ROLES).toHaveLength(8);
    expect(EJES_DEFAULT_TABLES[EJES_TABLE_ROLE.STAGING]).toEqual({
      schema: "bdj_carto",
      table: "ide_ejesviacirculacion",
    });
    expect(EJES_DEFAULT_TABLES[EJES_TABLE_ROLE.ROAD_SECTION]).toEqual({ schema: "carto", table: "road_section" });
    expect(EJES_DEFAULT_TABLES[EJES_TABLE_ROLE.LOCALITIES]).toEqual({
      schema: "bdj_carto",
      table: "ine_localidades_pg",
    });
    expect(EJES_DEFAULT_TABLES[EJES_TABLE_ROLE.DEPARTMENTS]).toEqual({
      schema: "carto",
      table: "mv_country_province",
    });
  });

  it("should treat staging, localities and departments as read roles and the five carto tables as write roles", () => {
    expect([...EJES_READ_ROLES].sort()).toEqual(
      [EJES_TABLE_ROLE.STAGING, EJES_TABLE_ROLE.LOCALITIES, EJES_TABLE_ROLE.DEPARTMENTS].sort()
    );
    expect(EJES_WRITE_ROLES).toHaveLength(5);
  });

  it("should require the spec logical columns per role", () => {
    expect(EJES_REQUIRED_COLUMNS_BY_ROLE[EJES_TABLE_ROLE.STAGING]).toEqual([
      "reftramo",
      "idcalle",
      "nombre",
      "tipo_vialidad",
      "fuente",
      "localidad",
      "departamento",
      "geom",
    ]);
    expect(EJES_REQUIRED_COLUMNS_BY_ROLE[EJES_TABLE_ROLE.ROAD_SECTION]).toEqual([
      "id",
      "reftramo_ideuy",
      "id_circulation_way",
      "id_road_section_type",
      "id_font",
      "id_address_master",
      "source",
      "target",
      "distance",
      "geometry",
    ]);
    expect(EJES_REQUIRED_COLUMNS_BY_ROLE[EJES_TABLE_ROLE.ADDRESS_MASTER]).toEqual([
      "addresses_master_id",
      "urn",
      "latitud",
      "longitud",
    ]);
    expect(EJES_REQUIRED_COLUMNS_BY_ROLE[EJES_TABLE_ROLE.ACCESS_POINT]).toEqual(["id", "id_road_section"]);
    expect(EJES_REQUIRED_COLUMNS_BY_ROLE[EJES_TABLE_ROLE.DEPARTMENTS]).toEqual(["iso_code_dpto", "name_dpto"]);
  });
});

describe("EJ-5 assertDistinctEjesTables", () => {
  it("should accept the default distinct tables", () => {
    expect(() => assertDistinctEjesTables({ tables: ejesTables() })).not.toThrow();
  });

  it("should throw when two roles are the same table", () => {
    const tables = ejesTables();
    tables["ejes-vias"] = { ...tables["ejes-tramos"] };

    expect(() => assertDistinctEjesTables({ tables })).toThrow(/distinta/);
  });

  it("should accept the same table name in different schemas", () => {
    const tables = ejesTables();
    tables["ejes-vias"] = { schema: "otro", table: "road_section" };

    expect(() => assertDistinctEjesTables({ tables })).not.toThrow();
  });
});

describe("ejesAttrChangesOf", () => {
  const base: EjesAttrRow = {
    ref: "1",
    name: "A",
    currentName: "A",
    idcalle: "1",
    currentIdcalle: "1",
    typeId: 4,
    currentTypeId: 4,
    fontId: 1,
    currentFontId: 1,
  };

  it("should return no change for an identical row", () => {
    expect(ejesAttrChangesOf(base)).toEqual([]);
  });

  it("should list every changed field", () => {
    expect(ejesAttrChangesOf({ ...base, name: "B", idcalle: "2", typeId: 10, fontId: 3 })).toEqual([
      "nombre",
      "idcalle",
      "tipo de vialidad",
      "fuente",
    ]);
  });

  it("should list only the changed field", () => {
    expect(ejesAttrChangesOf({ ...base, fontId: null })).toEqual(["fuente"]);
  });
});

describe("plannedEjesStepLabels", () => {
  it("should list the four analysis steps in order", () => {
    expect(plannedEjesStepLabels()).toEqual([
      "Validar tablas y columnas",
      "Comprobar privilegios",
      "Revisar los ejes de origen",
      "Clasificar los tramos y calcular cloc_iso",
    ]);
  });
});
