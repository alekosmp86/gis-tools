import { describe, expect, it } from "vitest";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import {
  buildConca,
  mapFeature,
  type WfsFeature,
} from "@/modules/coverage-loads/sigra-layers/domain/featureMapping";
import { SIGRA_LAYERS, getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";

const SQL_COMPUTED_COLUMNS = ["fechaact", "fechacarga", "fuente", "area_m2", "latitud", "longitud", "geom", "geometry"];

const POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [570000, 6140000],
      [570100, 6140000],
      [570100, 6140100],
      [570000, 6140000],
    ],
  ],
};

const AGUADA_PROPERTIES = {
  CENTRAL_NOMBRE: "AGUADA FTTH",
  EDIFICIO: "MVDAGUAM01O1",
  ID_AREA: 189713,
  CODIGO_AREA: "C009Z04",
  SITUACION: "Existente",
  ID_EMPALME: 520,
  CODIGO_EMPALME: "Z04/#01",
  SITUACION_GEOM: "Existente",
  OT_DE_CREACION_ID: 18059,
  OT_DE_CREACION_CODIGO: "MVD9999/16",
  OT_ACTUAL_ID: null,
  OT_ACTUAL_CODIGO: null,
};

function zonasFtth() {
  return getSigraLayer(SigraLayerId.ZONAS_FTTH);
}

describe("buildConca", () => {
  it("should build AGUADAC09ZONA 04 for the spec example", () => {
    expect(buildConca("AGUADA FTTH", "009", "04")).toBe("AGUADAC09ZONA 04");
  });

  it("should treat every null as an empty string", () => {
    expect(buildConca(null, null, null)).toBe("ZONA ");
  });

  it("should treat a null central name as empty", () => {
    expect(buildConca(null, "009", "04")).toBe("09ZONA 04");
  });

  it("should treat a null cable as empty", () => {
    expect(buildConca("AGUADA FTTH", null, "04")).toBe("AGUADACZONA 04");
  });

  it("should treat a null zona as empty", () => {
    expect(buildConca("AGUADA FTTH", "009", null)).toBe("AGUADAC09ZONA ");
  });

  it("should replace only the first FTTH occurrence in the central name", () => {
    expect(buildConca("A FTTH B FTTH", "009", "04")).toBe("AC B FTTH09ZONA 04");
  });

  it("should leave a central name without FTTH untouched", () => {
    expect(buildConca("AGUADA", "009", "04")).toBe("AGUADA09ZONA 04");
  });

  it("should take two characters of the cable starting at index 1", () => {
    expect(buildConca("X FTTH", "A12", "99")).toBe("XC12ZONA 99");
  });

  it("should yield an empty cable part when the cable has a single character", () => {
    expect(buildConca("X FTTH", "9", "01")).toBe("XCZONA 01");
  });
});

describe("mapFeature - zonas-ftth", () => {
  it("should map the live AGUADA sample to the documented values", () => {
    const feature: WfsFeature = { geometry: POLYGON, properties: AGUADA_PROPERTIES };

    const mapped = mapFeature(zonasFtth(), feature);

    expect(mapped.values).toEqual({
      id_distrito: 189713,
      edificio: "MVDAGUAM01",
      identificacion_de_la_central: "MVDAGUAM01O1",
      codigo_distrito: "C009Z04",
      nombre_central: "AGUADA FTTH",
      cable: "009",
      zona: "04",
      conca: "AGUADAC09ZONA 04",
      situacion_distrito: "Existente",
      id_terminalfibraoptica: 520,
      codigo_terminalfibraoptica: "Z04/#01",
      situacion_geom: "Existente",
    });
  });

  it("should expose exactly the documented value keys and no OT_ columns", () => {
    const mapped = mapFeature(zonasFtth(), { geometry: POLYGON, properties: AGUADA_PROPERTIES });

    expect(Object.keys(mapped.values).sort()).toEqual(
      [
        "id_distrito",
        "edificio",
        "identificacion_de_la_central",
        "codigo_distrito",
        "nombre_central",
        "cable",
        "zona",
        "conca",
        "situacion_distrito",
        "id_terminalfibraoptica",
        "codigo_terminalfibraoptica",
        "situacion_geom",
      ].sort(),
    );
  });

  it("should set cable and zona to null but still build conca when CODIGO_AREA is null", () => {
    const mapped = mapFeature(zonasFtth(), {
      geometry: POLYGON,
      properties: { ...AGUADA_PROPERTIES, CODIGO_AREA: null },
    });

    expect(mapped.values.codigo_distrito).toBeNull();
    expect(mapped.values.cable).toBeNull();
    expect(mapped.values.zona).toBeNull();
    expect(mapped.values.conca).toBe("AGUADACZONA ");
  });

  it("should cut edificio to 10 characters but keep identificacion_de_la_central whole", () => {
    const mapped = mapFeature(zonasFtth(), {
      geometry: POLYGON,
      properties: { ...AGUADA_PROPERTIES, EDIFICIO: "MVDAGUAM01O1" },
    });

    expect(mapped.values.edificio).toBe("MVDAGUAM01");
    expect(mapped.values.identificacion_de_la_central).toBe("MVDAGUAM01O1");
  });

  it("should keep a short EDIFICIO as is", () => {
    const mapped = mapFeature(zonasFtth(), {
      geometry: POLYGON,
      properties: { ...AGUADA_PROPERTIES, EDIFICIO: "MVD01" },
    });

    expect(mapped.values.edificio).toBe("MVD01");
    expect(mapped.values.identificacion_de_la_central).toBe("MVD01");
  });

  it("should keep an EDIFICIO of exactly 10 characters whole", () => {
    const mapped = mapFeature(zonasFtth(), {
      geometry: POLYGON,
      properties: { ...AGUADA_PROPERTIES, EDIFICIO: "ABCDEFGHIJ" },
    });

    expect(mapped.values.edificio).toBe("ABCDEFGHIJ");
  });

  it("should map every column to null when properties are missing", () => {
    const mapped = mapFeature(zonasFtth(), { geometry: POLYGON, properties: {} });

    expect(mapped.values).toEqual({
      id_distrito: null,
      edificio: null,
      identificacion_de_la_central: null,
      codigo_distrito: null,
      nombre_central: null,
      cable: null,
      zona: null,
      conca: "ZONA ",
      situacion_distrito: null,
      id_terminalfibraoptica: null,
      codigo_terminalfibraoptica: null,
      situacion_geom: null,
    });
  });

  it("should map explicitly undefined properties to null", () => {
    const mapped = mapFeature(zonasFtth(), {
      geometry: POLYGON,
      properties: { ...AGUADA_PROPERTIES, SITUACION: undefined, ID_AREA: undefined },
    });

    expect(mapped.values.situacion_distrito).toBeNull();
    expect(mapped.values.id_distrito).toBeNull();
  });

  it("should pass strings through without trimming", () => {
    const mapped = mapFeature(zonasFtth(), {
      geometry: POLYGON,
      properties: { ...AGUADA_PROPERTIES, SITUACION: "  Existente  " },
    });

    expect(mapped.values.situacion_distrito).toBe("  Existente  ");
  });
});

describe("mapFeature - geometry", () => {
  it("should serialise the geometry as JSON", () => {
    const mapped = mapFeature(zonasFtth(), { geometry: POLYGON, properties: AGUADA_PROPERTIES });

    expect(mapped.geometryJson).toBe(JSON.stringify(POLYGON));
  });

  it("should return null geometryJson when the geometry is null", () => {
    const mapped = mapFeature(zonasFtth(), { geometry: null, properties: AGUADA_PROPERTIES });

    expect(mapped.geometryJson).toBeNull();
  });

  it("should return null geometryJson when the geometry is undefined", () => {
    const mapped = mapFeature(zonasFtth(), {
      geometry: undefined,
      properties: AGUADA_PROPERTIES,
    });

    expect(mapped.geometryJson).toBeNull();
  });
});

type Triple = [column: string, property: string, value: string | number];

interface LayerCase {
  layerId: SigraLayerId;
  triples: Triple[];
  absentColumns?: string[];
}

const LAYER_CASES: LayerCase[] = [
  {
    layerId: SigraLayerId.LIMITE_CENTRAL_FTTH,
    triples: [
      ["id_area", "ID_AREA", 101],
      ["edificio", "EDIFICIO", "MVDCENT01"],
      ["id_sitio", "ID_SITIO", 202],
      ["codigo_sitio", "EDIFICIO", "MVDCENT01"],
      ["nombre_central_ftth", "CENTRAL_NOMBRE", "CENTRO FTTH"],
      ["cr_site_ty", "CR_SITE_TYPE_ID", 9],
    ],
    absentColumns: ["nombre_central_cobre"],
  },
  {
    layerId: SigraLayerId.LIMITE_CENTRAL_COBRE,
    triples: [
      ["id_area", "ID_AREA", 111],
      ["edificio", "EDIFICIO", "MVDCOBRE1"],
      ["id_sitio", "ID_SITIO", 212],
      ["codigo_sitio", "EDIFICIO", "MVDCOBRE1"],
      ["nombre_central_cobre", "CENTRAL_NOMBRE", "CENTRO COBRE"],
      ["cr_site_ty", "CR_SITE_TYPE_ID", 5],
    ],
    absentColumns: ["nombre_central_ftth"],
  },
  {
    layerId: SigraLayerId.AREA_CD_SR,
    triples: [
      ["id_area_sgra", "ID", 301],
      ["codigo", "CODIGO", "CDSR-01"],
      ["edificio", "EDIFICIO", "MVDCDSR"],
      ["situacion", "SITUACION", "Proyectado"],
    ],
    absentColumns: ["id"],
  },
  {
    layerId: SigraLayerId.AREA_CABLE_COBRE,
    triples: [
      ["edificio", "EDIFICIO", "MVDCOB"],
      ["codigo", "CODIGO", "C001"],
      ["tipo_area", "TIPO_AREA", "PRIMARIA"],
      ["id", "ID_AREA_SGRA", 401],
      ["situacion", "SITUACION", "Existente"],
    ],
    absentColumns: ["id_area_sgra", "id_area"],
  },
  {
    layerId: SigraLayerId.AREA_CABLE_FTTH,
    triples: [
      ["id_area", "ID_AREA", 501],
      ["edificio", "EDIFICIO", "MVDFTH"],
      ["identificacion_central", "IDENTIFICACION_CENTRAL", "MVDFTHO1"],
      ["nombre_central", "NOMBRE_CENTRAL", "FTTH CENTRO"],
      ["codigo", "CODIGO", "C010"],
      ["situacion", "SITUACION", "Existente"],
      ["tipo_area", "TIPO_AREA", "CABLE"],
    ],
    absentColumns: ["area_m2"],
  },
  {
    layerId: SigraLayerId.AREA_CAJITAS_COBRE,
    triples: [
      ["id_area", "ID_AREA", 601],
      ["codigo_area", "CODIGO_AREA", "C020"],
      ["central_nombre", "CENTRAL_NOMBRE", "CENTRO"],
      ["edificio", "EDIFICIO", "MVDCAJ"],
      ["situacion", "SITUACION", "Existente"],
      ["id_cajita", "ID_CAJITA", 602],
      ["codigo_cajita", "CODIGO_CAJITA", "CJ-9"],
      ["caja_de_distribucion", "CAJA_DE_DISTRIBUCION", "CD-77"],
    ],
  },
  {
    layerId: SigraLayerId.AREA_TFO,
    triples: [
      ["id_area_tfo", "ID", 701],
      ["edificio", "EDIFICIO", "MVDTFO"],
      ["cable", "CABLE", "003"],
      ["zona", "ZONA", "05"],
      ["codigo_area", "CODIGO", "C003Z05"],
      ["situacion_area", "SITUACION", "Existente"],
    ],
  },
  {
    layerId: SigraLayerId.LIMITE_ECONOMICO_COBRE,
    triples: [
      ["id_area", "ID_AREA", 801],
      ["codigo", "CODIGO", "ECO-1"],
      ["edificio", "EDIFICIO", "MVDECO"],
      ["area_tipo", "AREA_TIPO", "LIMITE_ECONOMICO_COBRE"],
      ["clasificacion", "CLASIFICACION", "Urbana"],
      ["observacion", "OBSERVACION", "sin obs"],
    ],
  },
  {
    layerId: SigraLayerId.LIMITE_MIXTO_COBRE,
    triples: [
      ["id_area", "ID_AREA", 811],
      ["codigo", "CODIGO", "MIX-1"],
      ["edificio", "EDIFICIO", "MVDMIX"],
      ["area_tipo", "AREA_TIPO", "LIMTE_MIXTO"],
      ["clasificacion", "CLASIFICACION", "Mixta"],
      ["observacion", "OBSERVACION", "obs mixta"],
    ],
  },
  {
    layerId: SigraLayerId.ZONAS_INSEGURIDAD,
    triples: [
      ["id_area", "ID_AREA", 821],
      ["codigo", "CODIGO", "INS-1"],
      ["edificio", "EDIFICIO", "MVDINS"],
      ["area_tipo", "AREA_TIPO", "ZONA_DE_INSEGURIDAD"],
      ["clasificacion", "CLASIFICACION", "Roja"],
      ["observacion", "OBSERVACION", "obs insegura"],
    ],
  },
  {
    layerId: SigraLayerId.CAJA_DISTRIBUCION,
    triples: [
      ["id", "ID", 901],
      ["central", "CENTRAL", "CENTRO"],
      ["code", "CODE", "CD-1"],
      ["status", "STATUS", "Activa"],
    ],
  },
  {
    layerId: SigraLayerId.CAJITAS_COBRE,
    triples: [
      ["cd", "CD", "CD-5"],
      ["activa", "ACTIVA", "S"],
      ["cajita_id", "CAJITA_ID", 1001],
      ["edificio", "EDIFICIO", "MVDCJT"],
      ["nro", "NRO", 12],
    ],
  },
  {
    layerId: SigraLayerId.TFO_DIVISORES,
    triples: [
      ["id_terminalfibra", "TFOID", 1101],
      ["edificio_terminalfibra", "TFOEDIFICIO", "MVDTFO"],
      ["cable_terminalfibra", "TFOCABLE", "004"],
      ["zona_terminalfibra", "TFOZONA", "06"],
      ["codigo_terminalfibra", "TFOCODIGO", "TFO-4"],
      ["situacion_terminalfibra", "TFOSTATUS", "Existente"],
      ["observacion", "TFOOBS", "obs tfo"],
      ["codigo_divisoroptico", "DIVISOR", "DIV-1"],
      ["situacion_divisoroptico", "DIVISORSTATUS", "Libre"],
      ["spid", "SPID", 1102],
    ],
    absentColumns: ["fechacarga", "fechaact"],
  },
  {
    layerId: SigraLayerId.CAMARAS,
    triples: [
      ["id_sgra", "ID_SGRA", 1201],
      ["edificio", "EDIFICIO", "MVDCAM"],
      ["codigo", "CODIGO", "CAM-3"],
      ["tipo", "TIPO", "Registro"],
      ["situacion", "SITUACION", "Existente"],
    ],
  },
  {
    layerId: SigraLayerId.CENTRALES_COBRE,
    triples: [
      ["id_sitio", "ID", 1301],
      ["codigo_sitio", "EDIFICIO", "MVDCCOB"],
      ["nombre_central_cobre", "NOMBRE", "CENTRAL COBRE UNO"],
      ["rotation", "ROTATION", 45],
      ["tipo_de_central", "TIPO_DE_CENTRAL", "CENTRAL COBRE"],
    ],
    absentColumns: ["edificio", "nombre_central_ftth"],
  },
  {
    layerId: SigraLayerId.CENTRALES_FTTH,
    triples: [
      ["id_sitio", "ID", 1311],
      ["codigo_sitio", "EDIFICIO", "MVDCFTH"],
      ["nombre_central_ftth", "NOMBRE", "CENTRAL UNO FTTH"],
      ["rotation", "ROTATION", 90],
      ["tipo_de_central", "TIPO_DE_CENTRAL", "CENTRAL FTTH"],
    ],
    absentColumns: ["edificio", "nombre_central_cobre"],
  },
  {
    layerId: SigraLayerId.POSTES,
    triples: [
      ["id_sgra", "ID", 1401],
      ["tipo", "TIPO", "Hormigon"],
      ["codigo_sga", "CODIGO_SGA", "P-77"],
      ["altura", "ALTURA", 12],
      ["material", "MATERIAL", "Hormigon"],
      ["situacion", "SITUACION", "Existente"],
      ["perforada", "PERFORADA", "N"],
      ["base_hormigonada", "BASE_HORMIGONADA", "S"],
      ["rotation", "ROTATION", 30],
    ],
    absentColumns: ["latitud", "longitud"],
  },
];

function propertiesFrom(triples: Triple[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [, property, value] of triples) properties[property] = value;
  return properties;
}

function expectedValuesFrom(triples: Triple[]): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [column, , value] of triples) values[column] = value;
  return values;
}

describe("mapFeature - remaining layers", () => {
  it("should cover the 17 non-zonas-ftth layers exactly once", () => {
    const covered = LAYER_CASES.map((layerCase) => layerCase.layerId).sort();
    const expected = SIGRA_LAYERS.map((layer) => layer.id)
      .filter((id) => id !== SigraLayerId.ZONAS_FTTH)
      .sort();

    expect(covered).toEqual(expected);
  });

  it.each(LAYER_CASES)("should map every WFS property of $layerId to its target column", (layerCase) => {
    const properties = { ...propertiesFrom(layerCase.triples), UNMAPPED_NOISE: "x", GID: 99, X: 1.5, Y: 2.5 };

    const mapped = mapFeature(getSigraLayer(layerCase.layerId), { geometry: POLYGON, properties });

    expect(mapped.values).toEqual(expectedValuesFrom(layerCase.triples));
    expect(mapped.geometryJson).toBe(JSON.stringify(POLYGON));
  });

  it.each(LAYER_CASES)("should omit the columns that must not be loaded for $layerId", (layerCase) => {
    const mapped = mapFeature(getSigraLayer(layerCase.layerId), {
      geometry: POLYGON,
      properties: propertiesFrom(layerCase.triples),
    });

    for (const column of layerCase.absentColumns ?? []) {
      expect(Object.keys(mapped.values)).not.toContain(column);
    }
  });

  it.each(LAYER_CASES)("should map every column to null and geometryJson to null for $layerId with an empty feature", (layerCase) => {
    const mapped = mapFeature(getSigraLayer(layerCase.layerId), { geometry: null, properties: {} });

    expect(Object.keys(mapped.values).sort()).toEqual(layerCase.triples.map(([column]) => column).sort());
    expect(Object.values(mapped.values).every((value) => value === null)).toBe(true);
    expect(mapped.geometryJson).toBeNull();
  });
});

describe("mapFeature - tfo-divisores specifics", () => {
  it("should include spid from SPID and no fechacarga", () => {
    const mapped = mapFeature(getSigraLayer(SigraLayerId.TFO_DIVISORES), {
      geometry: null,
      properties: { SPID: 5555, TFOID: 1 },
    });

    expect(mapped.values.spid).toBe(5555);
    expect(mapped.values).not.toHaveProperty("fechacarga");
  });
});

describe("mapFeature - SQL computed columns", () => {
  it.each(SIGRA_LAYERS.map((layer) => layer.id))("should never put SQL-computed columns in values for %s", (layerId) => {
    const noisyProperties: Record<string, unknown> = {};
    for (const name of ["FECHAACT", "FECHACARGA", "FUENTE", "AREA_M2", "LATITUD", "LONGITUD", "GEOM", "GEOMETRY"]) {
      noisyProperties[name] = "valor";
    }

    const mapped = mapFeature(getSigraLayer(layerId), { geometry: POLYGON, properties: noisyProperties });

    for (const column of SQL_COMPUTED_COLUMNS) {
      expect(Object.keys(mapped.values)).not.toContain(column);
    }
  });

  it.each(SIGRA_LAYERS.map((layer) => layer.id))("should return only string, number or null values for %s", (layerId) => {
    const mapped = mapFeature(getSigraLayer(layerId), { geometry: null, properties: {} });

    for (const value of Object.values(mapped.values)) {
      expect(value === null || typeof value === "string" || typeof value === "number").toBe(true);
    }
  });
});
