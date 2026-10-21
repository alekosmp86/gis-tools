import { describe, expect, it } from "vitest";
import {
  REQUIRED_LAYER_IDS,
  SOURCE_LABEL,
  SOURCE_SRID,
  SigraLayerId,
  VALIDATION_MIN_RATIO,
  WFS_BASE_URL,
  WFS_MAX_RETRIES,
  WFS_REQUEST_TIMEOUT_MS,
} from "@/modules/coverage-loads/sigra-layers/constants";
import {
  SIGRA_LAYERS,
  getSigraLayer,
  isSigraLayerId,
} from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";

interface ExpectedLayer {
  id: string;
  etlName: string;
  finalTable: string;
  typeName: string;
  cql: string | null;
  pageSize: number;
  sortBy: string;
  keyColumn: string;
  geomColumn: "geom" | "geometry";
  extraStagingColumns: string[];
  required: boolean;
}

const EXPECTED_LAYERS: ExpectedLayer[] = [
  { id: "zonas-ftth", etlName: "Area_Zonas_FTTH", finalTable: "public.area_zonas_ftth_f", typeName: "WFS_SI:AREA_ZONA_FTTH_F", cql: null, pageSize: 2000, sortBy: "ID_AREA", keyColumn: "id_distrito", geomColumn: "geom", extraStagingColumns: [], required: true },
  { id: "limite-central-ftth", etlName: "Area_Centrales_FTTH", finalTable: "public.limite_central_ftth", typeName: "WFS_SI:LIMITES_CENTRALES_F", cql: "CR_SITE_TYPE_ID=9 AND CENTRAL_NOMBRE LIKE '%FTTH'", pageSize: 2000, sortBy: "ID_AREA", keyColumn: "id_area", geomColumn: "geom", extraStagingColumns: [], required: true },
  { id: "area-cd-sr", etlName: "Area_CDSR", finalTable: "public.area_cd_sr", typeName: "AREA_CD_SR_F", cql: null, pageSize: 2000, sortBy: "ID", keyColumn: "id_area_sgra", geomColumn: "geom", extraStagingColumns: [], required: false },
  { id: "area-cable-cobre", etlName: "Area_Cable_Cobre", finalTable: "public.area_cable_cobre_f", typeName: "AREA_CABLE_COBRE_F", cql: null, pageSize: 1000, sortBy: "ID_AREA_SGRA", keyColumn: "id", geomColumn: "geometry", extraStagingColumns: [], required: false },
  { id: "area-cable-ftth", etlName: "Area_Cable_FTTH", finalTable: "public.area_cable_ftth_f", typeName: "AREA_CABLE_FTTH_F", cql: null, pageSize: 1000, sortBy: "ID_AREA", keyColumn: "id_area", geomColumn: "geom", extraStagingColumns: [], required: false },
  { id: "area-cajitas-cobre", etlName: "Area_Cajitas_Cobre", finalTable: "public.area_cajitas_f", typeName: "AREA_CAJITAS_F", cql: null, pageSize: 5000, sortBy: "ID_AREA", keyColumn: "id_area", geomColumn: "geometry", extraStagingColumns: [], required: false },
  { id: "area-tfo", etlName: "Area_Cajitas_FTTH", finalTable: "public.area_tfo_f", typeName: "AREA_NAPS_F", cql: null, pageSize: 5000, sortBy: "ID", keyColumn: "id_area_tfo", geomColumn: "geom", extraStagingColumns: [], required: false },
  { id: "limite-central-cobre", etlName: "Area_Centrales_Cobre", finalTable: "public.limite_central_cobre", typeName: "WFS_SI:LIMITES_CENTRALES_F", cql: "CR_SITE_TYPE_ID=5", pageSize: 2000, sortBy: "ID_AREA", keyColumn: "id_area", geomColumn: "geom", extraStagingColumns: [], required: false },
  { id: "limite-economico-cobre", etlName: "Area_Limite_Eco_Cobre", finalTable: "public.limite_economico_cobre", typeName: "WFS_SI:AREAS_ADMINISTRATIVAS_F", cql: "AREA_TIPO='LIMITE_ECONOMICO_COBRE'", pageSize: 2000, sortBy: "ID_AREA", keyColumn: "id_area", geomColumn: "geom", extraStagingColumns: [], required: false },
  { id: "limite-mixto-cobre", etlName: "Area_Limite_Mixto_Cobre", finalTable: "public.limite_mixto_cobre", typeName: "WFS_SI:AREAS_ADMINISTRATIVAS_F", cql: "AREA_TIPO='LIMTE_MIXTO'", pageSize: 2000, sortBy: "ID_AREA", keyColumn: "id_area", geomColumn: "geom", extraStagingColumns: [], required: false },
  { id: "caja-distribucion", etlName: "Cajas_Distribucion", finalTable: "public.caja_distribucion_f", typeName: "WFS_SI:CAJA_DISTRIBUCION_F", cql: null, pageSize: 2000, sortBy: "ID", keyColumn: "id", geomColumn: "geom", extraStagingColumns: [], required: false },
  { id: "cajitas-cobre", etlName: "Cajas_Cobre", finalTable: "public.cajitas_f", typeName: "WFS_SI:CAJITAS_LOGICAS_F", cql: null, pageSize: 5000, sortBy: "CAJITA_ID", keyColumn: "cajita_id", geomColumn: "geometry", extraStagingColumns: [], required: false },
  { id: "tfo-divisores", etlName: "Cajas_FTTH", finalTable: "public.tfo_divisores", typeName: "WFS_SI:DO_ACCESO", cql: null, pageSize: 5000, sortBy: "SPID", keyColumn: "spid", geomColumn: "geom", extraStagingColumns: ["spid"], required: false },
  { id: "camaras", etlName: "Camaras", finalTable: "public.camaras_f", typeName: "WFS_SI:CAMARAS_F", cql: null, pageSize: 5000, sortBy: "ID_SGRA", keyColumn: "id_sgra", geomColumn: "geometry", extraStagingColumns: [], required: false },
  { id: "centrales-cobre", etlName: "Centrales_Cobre", finalTable: "public.centrales_cobre", typeName: "WFS_SI:CENTRALES_F", cql: "TIPO_DE_CENTRAL='CENTRAL COBRE'", pageSize: 5000, sortBy: "ID", keyColumn: "id_sitio", geomColumn: "geom", extraStagingColumns: [], required: false },
  { id: "centrales-ftth", etlName: "Centrales_FTTH", finalTable: "public.centrales_ftth", typeName: "WFS_SI:CENTRALES_F", cql: "TIPO_DE_CENTRAL='CENTRAL FTTH' AND NOMBRE LIKE '%FTTH'", pageSize: 5000, sortBy: "ID", keyColumn: "id_sitio", geomColumn: "geom", extraStagingColumns: [], required: false },
  { id: "postes", etlName: "Postes", finalTable: "public.postes", typeName: "WFS_SI:POSTES_F", cql: null, pageSize: 5000, sortBy: "ID", keyColumn: "id_sgra", geomColumn: "geom", extraStagingColumns: [], required: false },
  { id: "zonas-inseguridad", etlName: "Zonas_Inseguridad", finalTable: "public.limite_de_inseguridad", typeName: "AREAS_ADMINISTRATIVAS_F", cql: "AREA_TIPO='ZONA_DE_INSEGURIDAD'", pageSize: 1000, sortBy: "ID_AREA", keyColumn: "id_area", geomColumn: "geom", extraStagingColumns: [], required: false },
];

const EXPECTED_IDS = [
  "zonas-ftth",
  "limite-central-ftth",
  "area-cd-sr",
  "area-cable-cobre",
  "area-cable-ftth",
  "area-cajitas-cobre",
  "area-tfo",
  "limite-central-cobre",
  "limite-economico-cobre",
  "limite-mixto-cobre",
  "caja-distribucion",
  "cajitas-cobre",
  "tfo-divisores",
  "camaras",
  "centrales-cobre",
  "centrales-ftth",
  "postes",
  "zonas-inseguridad",
];

const LAYER_FIELDS = [
  "cql",
  "etlName",
  "extraStagingColumns",
  "finalTable",
  "geomColumn",
  "id",
  "keyColumn",
  "label",
  "pageSize",
  "required",
  "sortBy",
  "typeName",
];

describe("SIGRA constants", () => {
  it("should expose exactly the 18 layer ids from the spec", () => {
    // Arrange / Act
    const values = Object.values(SigraLayerId);

    // Assert
    expect([...values].sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("should expose kebab-case string values for every SigraLayerId key", () => {
    for (const [key, value] of Object.entries(SigraLayerId)) {
      expect(key).toMatch(/^[A-Z0-9_]+$/);
      expect(value).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("should list zonas-ftth and limite-central-ftth as the only required layer ids", () => {
    expect([...REQUIRED_LAYER_IDS]).toEqual(["zonas-ftth", "limite-central-ftth"]);
  });

  it("should expose the fixed WFS and validation constants", () => {
    expect(WFS_BASE_URL).toBe(
      "http://vmlx-sgrabal-prod/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json",
    );
    expect(VALIDATION_MIN_RATIO).toBe(0.97);
    expect(SOURCE_LABEL).toBe("SIGRA/WFS");
    expect(SOURCE_SRID).toBe(31981);
    expect(WFS_MAX_RETRIES).toBe(2);
    expect(WFS_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(WFS_REQUEST_TIMEOUT_MS).toBe(60000);
  });
});

describe("SIGRA_LAYERS registry", () => {
  it("should contain exactly 18 layers", () => {
    expect(SIGRA_LAYERS).toHaveLength(18);
  });

  it("should have unique ids equal to the SigraLayerId values", () => {
    const ids = SIGRA_LAYERS.map((layer) => layer.id);

    expect(new Set(ids).size).toBe(18);
    expect([...ids].sort()).toEqual([...Object.values(SigraLayerId)].sort());
  });

  it("should mark only the two Avance layers as required, matching REQUIRED_LAYER_IDS", () => {
    const requiredIds = SIGRA_LAYERS.filter((layer) => layer.required).map((layer) => layer.id);

    expect([...requiredIds].sort()).toEqual([...REQUIRED_LAYER_IDS].sort());
    expect(requiredIds).toHaveLength(2);
  });

  it("should give every layer exactly the documented definition fields", () => {
    for (const layer of SIGRA_LAYERS) {
      expect(Object.keys(layer).sort()).toEqual(LAYER_FIELDS);
    }
  });

  it("should give every layer a non-empty label", () => {
    for (const layer of SIGRA_LAYERS) {
      expect(layer.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("should not include infra-canalizada", () => {
    expect(SIGRA_LAYERS.map((layer) => layer.id)).not.toContain("infra-canalizada");
  });

  it.each(EXPECTED_LAYERS)("should match the spec table for $id", (expected) => {
    // Act
    const layer = SIGRA_LAYERS.find((candidate) => candidate.id === expected.id);

    // Assert
    expect(layer).toBeDefined();
    expect(layer?.etlName).toBe(expected.etlName);
    expect(layer?.finalTable).toBe(expected.finalTable);
    expect(layer?.typeName).toBe(expected.typeName);
    expect(layer?.cql).toBe(expected.cql);
    expect(layer?.pageSize).toBe(expected.pageSize);
    expect(layer?.sortBy).toBe(expected.sortBy);
    expect(layer?.keyColumn).toBe(expected.keyColumn);
    expect(layer?.geomColumn).toBe(expected.geomColumn);
    expect([...(layer?.extraStagingColumns ?? [])]).toEqual(expected.extraStagingColumns);
    expect(layer?.required).toBe(expected.required);
  });
});

describe("getSigraLayer", () => {
  it.each(EXPECTED_IDS)("should return the definition whose id is %s", (id) => {
    const layer = getSigraLayer(id as SigraLayerId);

    expect(layer.id).toBe(id);
  });

  it("should return the same object held by SIGRA_LAYERS", () => {
    const layer = getSigraLayer(SigraLayerId.POSTES);

    expect(SIGRA_LAYERS).toContain(layer);
  });
});

describe("isSigraLayerId", () => {
  it.each(EXPECTED_IDS)("should accept the registry id %s", (id) => {
    expect(isSigraLayerId(id)).toBe(true);
  });

  it.each(["", "unknown", "infra-canalizada", "ZONAS-FTTH", " zonas-ftth", "postes "])(
    "should reject the unknown string %j",
    (value) => {
      expect(isSigraLayerId(value)).toBe(false);
    },
  );

  it.each([null, undefined, 0, 1, true, {}, [], ["postes"], { id: "postes" }])(
    "should reject the non-string value %j",
    (value) => {
      expect(isSigraLayerId(value)).toBe(false);
    },
  );

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "prototype"])(
    "should reject the prototype key %s",
    (value) => {
      expect(isSigraLayerId(value)).toBe(false);
    },
  );
});
